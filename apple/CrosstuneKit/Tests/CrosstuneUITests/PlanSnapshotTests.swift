#if os(macOS)
    import CrosstuneAnalytics
    import CrosstuneBilling
    import CrosstuneStore
    import CrosstuneTestSupport
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    /// Renders what a plan changes on the Mac to PNG for review: the recordings line and dimmed
    /// rows, a tune page with locked scans, the Plan sheet, each notice, and the Account tab's
    /// Plan group. See ``snapshot(_:width:size:_:)``.
    @MainActor
    @Suite struct PlanSnapshotTests {
        /// Every plan is judged at the sample catalog's own instant, so the renders never drift.
        private let now = SampleCatalog.now.date

        /// The line collapsed, then open over the dimmed rows a free plan shows.
        @Test func recordingsLine() {
            let rows = SampleCatalog.recordings.map {
                RecordingRowContent(
                    recording: $0.recording, file: $0.file, tuneTitle: $0.tuneTitle, recordingsPlay: false,
                    locale: SampleCatalog.locale, timeZone: SampleCatalog.timeZone)
            }
            snapshot("mac-plan-recordings-line", width: 420) {
                VStack(alignment: .leading, spacing: 4) {
                    RecordingsLine(count: rows.count, isExpanded: .constant(false))
                    Divider()
                    RecordingsLine(count: rows.count, isExpanded: .constant(true))
                    ForEach(rows, id: \.self) { row in
                        MediaRow(recording: row, perform: { _ in }, onRetry: { _ in }).padding(.vertical, 4)
                    }
                }
                .tint(MacStyle.accent)
            }
        }

        /// A free account's second sample tune, whose scan is locked, holding recordings behind
        /// the line.
        @Test func lockedScansPage() async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            try await SampleScans.add(to: store)
            try await SamplePlan.free.store(in: store, now: now)
            let plan = PlanModel(store: store, now: { [now] in now })
            #expect(try await poll { plan.plan.kind == .free })
            let entry = SampleCatalog.entries[1]
            let model = TuneModel(store: store, tuneID: entry.tune.id, plan: plan)
            #expect(try await poll { model.shown != nil && model.scans.scans.count == 1 })
            let detail = TuneDetail(
                tune: entry.tune, userTune: entry.userTune,
                recordings: [0, 1].map {
                    let sample = SampleCatalog.recordings[$0]
                    return TuneRecording(recording: sample.recording, file: sample.file)
                })
            snapshot("mac-plan-tune-page-free", width: 780) {
                TunePageColumn(
                    model: model, detail: detail, editing: .constant(nil), deleting: .constant(nil),
                    addingScans: .constant(nil), deletingScan: .constant(nil)
                )
                .environment(\.plan, plan)
                .frame(maxWidth: PageStyle.pageMaxWidth, alignment: .leading)
                .padding(PageStyle.pageMargin)
                .frame(maxWidth: .infinity)
                .tint(MacStyle.accent)
                .environment(\.sidebarSelection, ShellValue.constant(.catalog))
            }
        }

        /// A purchase model whose store sells at US prices, or fails to answer when `offline`.
        private func purchase(offline: Bool = false) async -> PurchaseModel {
            let client = FakePurchaseClient()
            client.offersResult =
                offline
                ? .failure(URLError(.notConnectedToInternet))
                : .success([
                    PurchaseOffer(period: .annual, price: "$49.99", amount: 49.99),
                    PurchaseOffer(period: .monthly, price: "$4.99", amount: 4.99),
                ])
            let purchase = PurchaseModel(
                client: client, refresh: {}, sync: {}, analytics: RecordingAnalyticsSink().client)
            await purchase.loadOffers()
            return purchase
        }

        /// The Plan sheet for `sample`, opened for `reason`, over a store that can sell or not.
        private func planSheet(
            _ name: String, sample: SamplePlan, reason: PremiumReason, offline: Bool = false
        ) async throws {
            try await planSheet(name, row: sample.entitlement(now: now), reason: reason, offline: offline)
        }

        /// The Plan sheet over a store holding `row`.
        private func planSheet(
            _ name: String, row: Entitlement, reason: PremiumReason, offline: Bool = false
        ) async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            try await store.write { writer in try row.upsert(writer.db) }
            let plan = PlanModel(store: store, now: { [now] in now })
            #expect(try await poll { plan.plan.kind != .unknown })
            let purchase = await purchase(offline: offline)
            await sheetSnapshot(name) {
                PlanSheet(reason: reason, entry: .record, purchase: purchase, now: now)
                    .environment(\.plan, plan)
                    .environment(\.store, store)
                    .tint(MacStyle.accent)
            }
        }

        /// A free account's Plan sheet from Settings: the pitch, the comparison, and the choice.
        @Test func planSheetFree() async throws {
            try await planSheet("mac-plan-sheet-free", sample: .free, reason: .plan)
        }

        /// A trial's Plan sheet: the trial card above the comparison.
        @Test func planSheetTrial() async throws {
            try await planSheet("mac-plan-sheet-trial", sample: .trial, reason: .plan)
        }

        /// The Plan sheet from a locked recording, naming what was tapped.
        @Test func planSheetLockedRecordings() async throws {
            try await planSheet("mac-plan-sheet-locked-recordings", sample: .free, reason: .recordings)
        }

        /// The Plan sheet when the store could not be reached: the comparison, the offline line,
        /// and no choice or Subscribe.
        @Test func planSheetOffline() async throws {
            try await planSheet("mac-plan-sheet-offline", sample: .free, reason: .plan, offline: true)
        }

        /// An App Store subscriber's Plan sheet: the badge, the renewal date, the manage button,
        /// what Premium includes, and Restore.
        @Test func planSheetMemberApple() async throws {
            let row = Entitlement(
                id: "sample-entitlement", premiumSource: "apple",
                premiumExpiresAt: Timestamp(now.addingTimeInterval(30 * 86_400)), autoRenews: true,
                premiumQuotaBytes: 10_000_000_000)
            try await planSheet("mac-plan-sheet-member-apple", row: row, reason: .plan)
        }

        /// A comped account's Plan sheet: one row naming the grant, and nothing to manage.
        @Test func planSheetMemberComp() async throws {
            let row = Entitlement(
                id: "sample-entitlement", premiumSource: "comp", premiumQuotaBytes: 10_000_000_000)
            try await planSheet("mac-plan-sheet-member-comp", row: row, reason: .plan)
        }

        /// One Plan sheet left up while its plan turns from a trial to an App Store subscription
        /// and then lapses to free: it sells with the trial card, confirms the plan, then sells
        /// without the card.
        @Test func planSheetFollowsThePlanWhileOpen() async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            let ends = Timestamp(now.addingTimeInterval(10 * 86_400))
            func write(_ source: String?) async throws {
                let row = Entitlement(
                    id: "sample-entitlement", premiumSource: source, premiumExpiresAt: source == nil ? nil : ends,
                    autoRenews: source == "apple", trialStartsAt: Timestamp(now.addingTimeInterval(-20 * 86_400)),
                    trialEndsAt: ends, premiumQuotaBytes: 10_000_000_000)
                try await store.write { writer in try row.upsert(writer.db) }
            }
            try await write("trial")
            let plan = PlanModel(store: store, now: { [now] in now })
            #expect(try await poll { plan.plan.isTrial })
            let purchase = await purchase()
            let steps: [LiveStep] = [
                LiveStep(name: "mac-plan-sheet-live-trial") {
                    try await write("trial")
                    #expect(try await poll { plan.plan.isTrial })
                },
                LiveStep(name: "mac-plan-sheet-live-apple") {
                    try await write("apple")
                    #expect(try await poll { plan.plan.source == .apple })
                },
                LiveStep(name: "mac-plan-sheet-live-free") {
                    try await write(nil)
                    #expect(try await poll { plan.plan.kind == .free })
                },
            ]
            let renders = try await liveSheetSnapshots(steps) {
                PlanSheet(reason: .plan, entry: .planGroup, purchase: purchase, now: now)
                    .environment(\.plan, plan)
                    .environment(\.store, store)
                    .tint(MacStyle.accent)
            }
            // A machine with no display draws nothing; the renders above are the record of each mode.
            let drawn = renders.compactMap { $0 }
            guard drawn.count == steps.count else { return }
            // The sheet stays up through every change and redraws for each plan.
            #expect(drawn[0] != drawn[1])
            #expect(drawn[1] != drawn[2])
            #expect(drawn[0] != drawn[2])
        }

        /// Each notice as the Mac presents it in a build that offers no purchase: the trial
        /// notices offer the comparison alone.
        @Test func notices() async {
            // Noon UTC, so the day it names is the same in every nearby time zone.
            let endsAt = Timestamp(iso: "2026-09-28T12:00:00.000Z")!.date
            for notice in PlanNotice.allCases {
                await sheetSnapshot("mac-plan-notice-\(notice.rawValue)") {
                    NoticeSheet(
                        notice: notice, endsAt: endsAt, plan: Plan(kind: .premium, source: .trial), purchase: nil,
                        now: now, onClose: {}, onSeePlan: {}, onComparePlans: {}
                    )
                    .tint(MacStyle.accent)
                }
            }
        }

        /// The trial notices where the store sells: Subscribe for Annual, Compare plans, and
        /// the renewal terms.
        @Test(arguments: [(PlanNotice.trialReminder, "reminder"), (.trialEnded, "ended")])
        func sellingNotices(notice: PlanNotice, name: String) async {
            let endsAt = Timestamp(iso: "2026-09-28T12:00:00.000Z")!.date
            let plan = notice == .trialReminder ? Plan(kind: .premium, source: .trial) : Plan(kind: .free)
            let purchase = await purchase()
            await sheetSnapshot("mac-plan-notice-\(name)-selling") {
                NoticeSheet(
                    notice: notice, endsAt: endsAt, plan: plan, purchase: purchase, now: now, onClose: {},
                    onSeePlan: {}, onComparePlans: {}
                )
                .tint(MacStyle.accent)
            }
        }

        /// The Account tab's Plan group, in a build that sells: the plan row, which opens the
        /// Plan sheet, and the storage meter, for a free account, a lapsed trial, and an App Store
        /// subscriber.
        @Test(arguments: ["free", "trial-ended", "apple"])
        func accountTab(name: String) async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            let row =
                SamplePlan(rawValue: name)?.entitlement(now: now)
                ?? Entitlement(
                    id: "sample-entitlement", premiumSource: name,
                    premiumExpiresAt: Timestamp(now.addingTimeInterval(30 * 86_400)), autoRenews: true,
                    premiumQuotaBytes: 10_000_000_000)
            try await store.write { writer in try row.upsert(writer.db) }
            let plan = PlanModel(store: store, now: { [now] in now })
            #expect(try await poll { plan.plan.kind != .unknown })
            let purchase = PurchaseModel(
                client: FakePurchaseClient(), refresh: {}, sync: {}, analytics: RecordingAnalyticsSink().client)
            await windowSnapshot("mac-plan-account-\(name)", size: MacSettingsTabs.size) {
                MacSettingsTabs.content(.account, version: "0.7.0")
                    .environment(\.store, store)
                    .environment(\.plan, plan)
                    .environment(\.purchase, purchase)
                    .tint(MacStyle.accent)
            }
        }
    }
#endif
