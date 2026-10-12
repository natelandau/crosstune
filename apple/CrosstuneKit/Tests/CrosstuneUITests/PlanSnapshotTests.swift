#if os(macOS)
    import CrosstuneAnalytics
    import CrosstuneStore
    import CrosstuneTestSupport
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    /// Renders what a plan changes on the Mac to PNG for review: the recordings line and dimmed
    /// rows, a tune page with locked scans, the Premium sheet, each notice, and the Account tab's
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

        /// A free account's second sample tune, whose scan is not on the scan tune, holding
        /// recordings behind the line.
        @Test func lockedScansPage() async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            try await SampleScans.add(to: store)
            try await SamplePlan.free.store(in: store, now: now)
            let plan = PlanModel(store: store, now: { [now] in now })
            #expect(try await poll { plan.plan.kind == .free && plan.scanTune != nil })
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

        /// The Premium sheet for each reason, as the Mac presents it.
        @Test func premiumSheet() async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            try await SampleScans.add(to: store)
            try await SamplePlan.free.store(in: store, now: now)
            let plan = PlanModel(store: store, now: { [now] in now })
            #expect(try await poll { plan.scanTune != nil })
            for reason in PremiumReason.allCases {
                await sheetSnapshot("mac-plan-premium-\(reason.rawValue)") {
                    PremiumSheet(reason: reason, entry: .record, purchase: nil, onSeePlan: {})
                        .environment(\.plan, plan)
                        .environment(\.store, store)
                        .tint(MacStyle.accent)
                }
            }
        }

        /// The Premium sheet when the store could not be reached: no Subscribe, the offline line,
        /// and See your plan as the primary action.
        @Test func premiumSheetOffline() async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            try await SamplePlan.free.store(in: store, now: now)
            let plan = PlanModel(store: store, now: { [now] in now })
            #expect(try await poll { plan.plan.kind == .free })
            let client = FakePurchaseClient()
            client.offersResult = .failure(URLError(.notConnectedToInternet))
            let purchase = PurchaseModel(
                client: client, refresh: {}, sync: {}, analytics: RecordingAnalyticsSink().client)
            await purchase.loadOffers()
            #expect(PremiumSheet.sale(plan: plan.plan, offers: purchase.offers, line: nil) == .offline)
            #expect(PremiumSheet.seePlanLeads(.offline))
            await sheetSnapshot("mac-plan-premium-offline") {
                PremiumSheet(reason: .recordings, entry: .record, purchase: purchase, onSeePlan: {})
                    .environment(\.plan, plan)
                    .environment(\.store, store)
                    .tint(MacStyle.accent)
            }
        }

        /// The Premium sheet selling Annual or Monthly at the fake store's prices.
        @Test(arguments: [PremiumReason.recordings, .plan])
        func premiumSheetWithOffers(reason: PremiumReason) async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            try await SamplePlan.free.store(in: store, now: now)
            let plan = PlanModel(store: store, now: { [now] in now })
            #expect(try await poll { plan.plan.kind == .free })
            let purchase = PurchaseModel(
                client: FakePurchaseClient(), refresh: {}, sync: {}, analytics: RecordingAnalyticsSink().client)
            await purchase.loadOffers()
            await sheetSnapshot("mac-plan-premium-offers-\(reason.rawValue)") {
                PremiumSheet(reason: reason, entry: .record, purchase: purchase, onSeePlan: {})
                    .environment(\.plan, plan)
                    .environment(\.store, store)
                    .tint(MacStyle.accent)
            }
        }

        /// Each notice as the Mac presents it, the reminder with recordings held.
        @Test func notices() async {
            // Noon UTC, so the day it names is the same in every nearby time zone.
            let endsAt = Timestamp(iso: "2026-09-28T12:00:00.000Z")!.date
            for notice in PlanNotice.allCases {
                await sheetSnapshot("mac-plan-notice-\(notice.rawValue)") {
                    NoticeSheet(notice: notice, endsAt: endsAt, holdsRecordings: true, onOK: {}, onSeePlan: {})
                        .tint(MacStyle.accent)
                }
            }
        }

        /// The trial notices where the store can sell: Subscribe in place of See your plan.
        @Test func noticesThatSell() async {
            let endsAt = Timestamp(iso: "2026-09-28T12:00:00.000Z")!.date
            for notice in [PlanNotice.trialReminder, .trialEnded] {
                await sheetSnapshot("mac-plan-notice-\(notice.rawValue)-subscribe") {
                    NoticeSheet(
                        notice: notice, endsAt: endsAt, holdsRecordings: true, onOK: {}, onSeePlan: {},
                        onSubscribe: {}
                    )
                    .tint(MacStyle.accent)
                }
            }
        }

        /// The Account tab's Plan group in a build that sells, for a free account, an App Store
        /// subscriber, and a web subscriber outside the US.
        @Test(arguments: [("free", nil), ("apple", "apple"), ("stripe", "stripe")] as [(String, String?)])
        func accountTabWithPurchases(name: String, source: String?) async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            let row = Entitlement(
                id: "sample-entitlement", premiumSource: source,
                premiumExpiresAt: source.map { _ in Timestamp(now.addingTimeInterval(30 * 86_400)) },
                autoRenews: source != nil, premiumQuotaBytes: 10_000_000_000, freeQuotaBytes: 1_000_000_000)
            try await store.write { writer in try row.upsert(writer.db) }
            let plan = PlanModel(store: store, now: { [now] in now })
            #expect(try await poll { plan.plan.kind != .unknown })
            let client = FakePurchaseClient()
            client.storefront = "GBR"
            let purchase = PurchaseModel(
                client: client, refresh: {}, sync: {}, analytics: RecordingAnalyticsSink().client)
            await windowSnapshot("mac-plan-account-purchases-\(name)", size: MacSettingsTabs.size) {
                MacSettingsTabs.content(.account, version: "0.7.0")
                    .environment(\.store, store)
                    .environment(\.plan, plan)
                    .environment(\.purchases, client)
                    .environment(\.purchase, purchase)
                    .environment(\.stripePortalURL, URL(string: "https://billing.example.com/portal"))
                    .tint(MacStyle.accent)
            }
        }

        /// The Account tab's Plan group for the free plans. A trial's row counts days against the
        /// view's own clock, so its wording is left to `PlanTextTests`.
        @Test(arguments: [SamplePlan.free, .trialEnded])
        func accountTab(sample: SamplePlan) async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            try await sample.store(in: store, now: now)
            let plan = PlanModel(store: store, now: { [now] in now })
            #expect(try await poll { plan.plan.kind != .unknown })
            await windowSnapshot("mac-plan-account-\(sample.rawValue)", size: MacSettingsTabs.size) {
                MacSettingsTabs.content(.account, version: "0.7.0")
                    .environment(\.store, store)
                    .environment(\.plan, plan)
                    .tint(MacStyle.accent)
            }
        }
    }
#endif
