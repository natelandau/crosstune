import CrosstuneAnalytics
import CrosstuneBilling
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import SwiftUI
import Testing

@testable import CrosstuneUI

private let day: TimeInterval = 86_400

@MainActor
@Suite struct NoticeModelTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()
    private let clock = PlanClock()
    private let store: CrosstuneStore

    init() throws {
        store = try root.open()
    }

    private func entitlement(
        source: String?, expiresAt: Date? = nil, trialEndsAt: Date? = nil, trialEndSeen: Bool = false
    ) -> Entitlement {
        Entitlement(
            id: "entitlement-1", createdAt: noon, premiumSource: source,
            premiumExpiresAt: expiresAt.map(Timestamp.init), autoRenews: false,
            trialEndsAt: trialEndsAt.map(Timestamp.init), premiumQuotaBytes: 10_000,
            trialEndSeenAt: trialEndSeen ? noon : nil)
    }

    /// A trial running `days` more days from the test clock.
    private func trial(endingIn days: Double) -> Entitlement {
        let end = clock.now.addingTimeInterval(days * day)
        return entitlement(source: "trial", expiresAt: end, trialEndsAt: end)
    }

    private func pull(_ row: Entitlement) async throws {
        try await store.write { writer in try row.upsert(writer.db) }
    }

    private func addRecording(_ id: String = "r1") async throws {
        try await store.write { writer in
            try writer.put(
                Recording(id: id, createdAt: noon, tuneID: nil, source: "microphone", addedAt: noon), at: noon)
        }
    }

    /// A notice model over the store, once it has read the store and the plan.
    private func model(claim: NoticeClaim = NoticeClaim()) async throws -> NoticeModel {
        let plan = PlanModel(
            store: store, now: { [clock] in clock.now }, sleep: { [clock] in try await clock.sleep($0) })
        let model = NoticeModel(
            store: store, plan: plan, analytics: sink.client, claim: claim, now: { [clock] in clock.now })
        try await eventually { model.isLoaded }
        return model
    }

    private var shownNotices: [String] {
        sink.captures.filter { $0.name == "notice_shown" }.compactMap {
            if case .string(let notice) = $0.properties["notice"] { notice } else { nil }
        }
    }

    @Test func aTrialWithNoRecordingsShowsNothingUntilItHoldsOne() async throws {
        try await pull(trial(endingIn: 10))
        let model = try await model()
        #expect(model.showing == nil)

        try await addRecording()

        try await eventually { model.showing == .firstRecording }
        #expect(model.inputs?.holdsRecordings == true)
    }

    @Test func waitsWhileTheShellIsCoveredOrCapturing() async throws {
        try await pull(trial(endingIn: 10))
        let model = try await model()
        model.coverChanged(covered: true, capturing: false)

        try await addRecording()
        try await eventually { model.inputs?.holdsRecordings == true }
        #expect(model.showing == nil)

        model.coverChanged(covered: false, capturing: true)
        #expect(model.showing == nil)

        model.coverChanged(covered: false, capturing: false)
        #expect(model.showing == .firstRecording)
    }

    @Test func dismissingMarksItSeenAndNeverShowsItAgain() async throws {
        try await pull(trial(endingIn: 10))
        try await addRecording()
        let model = try await model()
        try await eventually { model.showing == .firstRecording }

        model.dismiss()

        #expect(model.showing == nil)
        try await eventually { model.inputs?.seen == [.firstRecording] }
        #expect(try await store.seenNotices() == [.firstRecording])
        #expect(model.showing == nil)
        #expect(shownNotices == ["first_recording"])
    }

    @Test func takesANoticeDownWhenItIsSeenElsewhere() async throws {
        try await pull(trial(endingIn: 10))
        try await addRecording()
        let model = try await model()
        try await eventually { model.showing == .firstRecording }

        try await store.write { writer in try writer.markNoticeSeen(.firstRecording) }

        try await eventually { model.showing == nil }
        #expect(shownNotices == ["first_recording"])
    }

    @Test func remindsThreeDaysBeforeATrialEndsWithoutAStoreWrite() async throws {
        try await pull(trial(endingIn: 4))
        let model = try await model()
        #expect(model.showing == nil)
        // The plan's sleep is relative, so it must start before the clock moves.
        try await eventually { clock.sleeps.count == 1 }

        clock.now = clock.now.addingTimeInterval(day)

        try await eventually { model.showing == .trialReminder }
        #expect(model.inputs?.holdsRecordings == false)
    }

    @Test func theReminderKnowsWhenTheAccountHoldsRecordings() async throws {
        try await pull(trial(endingIn: 2))
        try await addRecording()
        try await store.write { writer in try writer.markNoticeSeen(.firstRecording) }
        let model = try await model()

        try await eventually { model.showing == .trialReminder }
        #expect(model.inputs?.holdsRecordings == true)
        #expect(model.trialEndsAt == clock.now.addingTimeInterval(2 * day))
    }

    @Test func showsTheNextDueNoticeOnceTheFirstIsDismissed() async throws {
        try await pull(trial(endingIn: 2))
        try await addRecording()
        let model = try await model()
        try await eventually { model.showing == .trialReminder }

        model.dismiss()

        #expect(model.showing == .firstRecording)
        #expect(shownNotices == ["trial_reminder", "first_recording"])
    }

    @Test func anEndedTrialWithNoSourceShowsTheEndNotice() async throws {
        let ended = clock.now.addingTimeInterval(-day)
        try await pull(entitlement(source: nil, trialEndsAt: ended))
        let model = try await model()

        try await eventually { model.showing == .trialEnded }
    }

    @Test func aTrialEndingWhileOpenShowsTheEndNotice() async throws {
        try await pull(trial(endingIn: 1))
        try await store.write { writer in try writer.markNoticeSeen(.trialReminder) }
        let model = try await model()
        #expect(model.showing == nil)
        // The plan's sleep is relative, so it must start before the clock moves.
        try await eventually { clock.sleeps.count == 1 }

        clock.now = clock.now.addingTimeInterval(day)

        try await eventually { model.showing == .trialEnded }
    }

    @Test func aCompAccountWhoseTrialEndedSeesNothing() async throws {
        let ended = clock.now.addingTimeInterval(-day)
        try await pull(entitlement(source: "comp", trialEndsAt: ended))
        try await addRecording()
        let model = try await model()

        #expect(model.showing == nil)
        #expect(sink.captures.isEmpty)
    }

    @Test func aNoticeTheRowCarriesAsSeenNeverShows() async throws {
        let ended = clock.now.addingTimeInterval(-day)
        try await pull(entitlement(source: "trial", expiresAt: ended, trialEndsAt: ended, trialEndSeen: true))
        let model = try await model()

        #expect(model.showing == nil)
        #expect(sink.captures.isEmpty)
    }

    @Test func sendsOneEventPerShowing() async throws {
        try await pull(trial(endingIn: 10))
        try await addRecording()
        let model = try await model()
        try await eventually { model.showing == .firstRecording }

        // A cover arriving and leaving while the notice is up is the notice's own sheet.
        model.coverChanged(covered: true, capturing: false)
        model.coverChanged(covered: false, capturing: false)
        try await addRecording("r2")
        try await eventually { model.inputs?.holdsRecordings == true }

        #expect(model.showing == .firstRecording)
        #expect(
            sink.captures == [.init(name: "notice_shown", properties: ["notice": .string("first_recording")])])
    }

    @Test func waitsForItsOwnSheetToLeaveBeforeTheNextNotice() async throws {
        try await pull(trial(endingIn: 2))
        try await addRecording()
        let model = try await model()
        try await eventually { model.showing == .trialReminder }
        // The notice's own sheet covers the shell while it is up.
        model.coverChanged(covered: true, capturing: false)

        model.dismiss()

        #expect(model.showing == nil)
        model.coverChanged(covered: false, capturing: false)
        #expect(model.showing == .firstRecording)
    }

    @Test func onlyOneWindowShowsADueNotice() async throws {
        try await pull(trial(endingIn: 10))
        try await addRecording()
        let claim = NoticeClaim()
        let first = try await model(claim: claim)
        let second = try await model(claim: claim)
        try await eventually { first.showing == .firstRecording || second.showing == .firstRecording }
        let (presenter, other) = first.showing == nil ? (second, first) : (first, second)
        other.coverChanged(covered: false, capturing: false)

        #expect(other.showing == nil)
        #expect(shownNotices == ["first_recording"])

        presenter.dismiss()
        try await eventually { other.inputs?.seen == [.firstRecording] }
        #expect(presenter.showing == nil)
        #expect(other.showing == nil)
        #expect(shownNotices == ["first_recording"])
    }

    @Test func aBackgroundWindowYieldsTheNoticeToAnActiveOne() async throws {
        try await pull(trial(endingIn: 10))
        let claim = NoticeClaim()
        let background = try await model(claim: claim)
        let active = try await model(claim: claim)
        background.coverChanged(
            covered: AppShell.noticeCovered(shellCovered: false, premiumRequested: false, phase: .background),
            capturing: false)
        active.coverChanged(
            covered: AppShell.noticeCovered(shellCovered: false, premiumRequested: false, phase: .active),
            capturing: false)

        try await addRecording()

        try await eventually { active.showing == .firstRecording }
        #expect(background.showing == nil)
        #expect(AppShell.noticeCovered(shellCovered: false, premiumRequested: false, phase: .inactive))
        #expect(AppShell.noticeCovered(shellCovered: true, premiumRequested: false, phase: .active))
    }

    @Test func aClosingWindowHandsTheNoticeToAnotherWithoutASecondEvent() async throws {
        try await pull(trial(endingIn: 10))
        try await addRecording()
        let claim = NoticeClaim()
        let first = try await model(claim: claim)
        let second = try await model(claim: claim)
        try await eventually { first.showing == .firstRecording || second.showing == .firstRecording }
        let (presenter, other) = first.showing == nil ? (second, first) : (first, second)

        presenter.leave()

        try await eventually { other.showing == .firstRecording }
        #expect(presenter.showing == nil)
        #expect(try await store.seenNotices().isEmpty)
        #expect(shownNotices == ["first_recording"])
    }

    @Test func theCopyIsExact() {
        #expect(NoticeText.firstRecordingTitle == "Recordings are part of your trial")
        #expect(
            NoticeText.firstRecordingBody(endsAt: "Oct 13, 2026")
                == "Your Premium trial ends Oct 13, 2026. After that, every recording stays and exports, but it won't play in the app until you subscribe."
        )
        #expect(NoticeText.trialReminderTitle(endsAt: "Oct 13, 2026") == "Your trial ends Oct 13, 2026")
        #expect(NoticeText.trialEndedTitle == "Your trial has ended")
        #expect(NoticeText.ok == "OK")
    }

    @Test func theNewNoticeCopyIsExact() {
        #expect(NoticeText.daysLeft(1) == "1 day left of Premium")
        #expect(NoticeText.daysLeft(3) == "3 days left of Premium")
        #expect(NoticeText.daysLeft(0) == PlanText.trialEndsToday)
        #expect(NoticeText.daysLeft(-1) == PlanText.trialEndsToday)
        #expect(NoticeText.losePlayback == "Recordings don't play in the app")
        #expect(NoticeText.loseRecording == "No new recordings or practice mode")
        #expect(NoticeText.loseScans == "Scans don't open in the app")
        #expect(
            NoticeText.keeps
                == "Every recording and scan stays, and export always includes them. Subscribe and they work again at once."
        )
        #expect(NoticeText.subscribeAnnual("$49.99") == "Subscribe for $49.99 a year")
    }

    @Test func theSheetSaysWhatTheNoticeIs() throws {
        let ends = try #require(Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 13, hour: 12)))
        let now = ends.addingTimeInterval(-2 * day)
        let date = PlanText.day(ends)

        #expect(NoticeSheet.title(.firstRecording, endsAt: ends) == NoticeText.firstRecordingTitle)
        #expect(NoticeSheet.firstRecordingBody(endsAt: ends) == NoticeText.firstRecordingBody(endsAt: date))
        #expect(NoticeSheet.firstRecordingBody(endsAt: nil) == nil)
        #expect(NoticeSheet.title(.trialReminder, endsAt: ends) == NoticeText.trialReminderTitle(endsAt: date))
        #expect(NoticeSheet.subtitle(.trialReminder, endsAt: ends, now: now) == NoticeText.daysLeft(2))
        #expect(NoticeSheet.title(.trialEnded, endsAt: ends) == NoticeText.trialEndedTitle)
        #expect(NoticeSheet.subtitle(.trialEnded, endsAt: ends, now: now) == nil)
        #expect(
            NoticeSheet.loses == [NoticeText.losePlayback, NoticeText.loseRecording, NoticeText.loseScans])
    }

    @Test func theReminderSaysTheTrialEndsTodayOnItsLastDay() throws {
        let ends = try #require(Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 13, hour: 18)))
        let lastDay = try #require(Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 13, hour: 9)))
        let dayBefore = lastDay.addingTimeInterval(-day)

        #expect(NoticeSheet.subtitle(.trialReminder, endsAt: ends, now: lastDay) == PlanText.trialEndsToday)
        #expect(NoticeSheet.subtitle(.trialReminder, endsAt: ends, now: dayBefore) == NoticeText.daysLeft(1))
    }

    @Test func comparePlansOpensThePlanSheetFromTheNotice() async throws {
        try await pull(trial(endingIn: 2))
        try await addRecording()
        let model = try await model()
        let plan = PlanModel(store: store, now: { [clock] in clock.now })
        let presenter = PremiumPresenter(plan: plan, analytics: sink.client)
        try await eventually { model.showing == .trialReminder }

        // The notice's own sheet covers the shell while it is up.
        model.coverChanged(
            covered: AppShell.noticeCovered(shellCovered: true, premiumRequested: false, phase: .active),
            capturing: false)

        // Compare plans on the reminder: the notice's sheet goes, and once it has, the Plan
        // sheet is asked for from the notice, before that sheet has shown and claimed the shell.
        let entry = try #require(NoticeSheet.entry(.trialReminder))
        model.dismiss()
        presenter.present(.plan, from: entry)
        model.coverChanged(
            covered: AppShell.noticeCovered(
                shellCovered: false, premiumRequested: presenter.presented != nil, phase: .active),
            capturing: false)

        #expect(presenter.presented == .plan)
        #expect(presenter.presentedFrom == .trialReminder)
        #expect(
            sink.captures.contains(
                .init(
                    name: "premium_sheet_shown",
                    properties: ["reason": .string("plan"), "from": .string("trial_reminder")])))
        #expect(model.showing == nil)
        presenter.presented = nil
        model.coverChanged(
            covered: AppShell.noticeCovered(shellCovered: false, premiumRequested: false, phase: .active),
            capturing: false)
        #expect(model.showing == .firstRecording)
    }

    @Test func theTrialNoticesSellOnlyWithAPurchaseModelAndAPlanThatCanSubscribe() {
        let trial = Plan(kind: .premium, source: .trial)
        let free = Plan(kind: .free)
        let purchase = PurchaseModel(client: FakePurchaseClient(), refresh: {}, sync: {}, analytics: sink.client)
        #expect(NoticeSheet.sells(.trialReminder, plan: trial, purchase: purchase))
        #expect(NoticeSheet.sells(.trialEnded, plan: free, purchase: purchase))
        // The first recording informs and is never purchasable.
        #expect(NoticeSheet.sells(.firstRecording, plan: trial, purchase: purchase) == false)
        // A build with no purchase model is not purchasable.
        #expect(NoticeSheet.sells(.trialReminder, plan: trial, purchase: nil) == false)
        #expect(NoticeSheet.sells(.trialEnded, plan: free, purchase: nil) == false)
        // An account already paying, or comped, is not purchasable.
        for source: PlanSource in [.apple, .stripe, .comp] {
            let plan = Plan(kind: .premium, source: source)
            #expect(NoticeSheet.sells(.trialEnded, plan: plan, purchase: purchase) == false)
            #expect(NoticeSheet.sells(.trialReminder, plan: plan, purchase: purchase) == false)
        }
        #expect(NoticeSheet.sells(.trialEnded, plan: .unknown, purchase: purchase) == false)
        // Compare plans reports where it came from, whether or not the notice is purchasable.
        #expect(NoticeSheet.entry(.trialReminder) == .trialReminder)
        #expect(NoticeSheet.entry(.trialEnded) == .trialEnded)
        #expect(NoticeSheet.entry(.firstRecording) == nil)
    }

    private let annual = PurchaseOffer(period: .annual, price: "$49.99", amount: 49.99)
    private let monthly = PurchaseOffer(period: .monthly, price: "$4.99", amount: 4.99)

    @Test func aNoticeThatSellsLeadsWithSubscribeForAnnual() {
        #expect(NoticeSheet.annualOffer(.ready([monthly, annual])) == annual)
        #expect(
            NoticeSheet.offer(sells: true, offers: .ready([annual, monthly]), line: nil)
                == .init(primary: .subscribe("$49.99"), secondary: .comparePlans))
        #expect(NoticeSheet.Offer(primary: .subscribe("$49.99"), secondary: .comparePlans).discloses)
    }

    @Test func withoutPricesTheNoticeLeadsWithComparePlans() {
        let comparePlans = NoticeSheet.Offer(primary: .comparePlans, secondary: nil)
        #expect(comparePlans.discloses == false)
        #expect(NoticeSheet.annualOffer(.loading) == nil)
        #expect(NoticeSheet.annualOffer(.unavailable) == nil)
        #expect(NoticeSheet.annualOffer(.ready([monthly])) == nil)
        for offers: PurchaseModel.Offers in [.unavailable, .ready([monthly]), .ready([])] {
            #expect(NoticeSheet.offer(sells: true, offers: offers, line: nil) == comparePlans)
        }
        // A notice that is not purchasable shows the comparison alone, prices or not.
        #expect(NoticeSheet.offer(sells: false, offers: .ready([annual]), line: nil) == comparePlans)
        #expect(NoticeSheet.offer(sells: false, offers: nil, line: nil) == comparePlans)
        // A failed try keeps the choice, with its line above it.
        #expect(
            NoticeSheet.offer(sells: true, offers: .ready([annual]), line: .failed)
                == .init(primary: .subscribe("$49.99"), secondary: .comparePlans))
    }

    @Test func aPurchaseOnTheNoticeSettlesOnClose() {
        let settled = NoticeSheet.Offer(primary: .close, secondary: nil)
        #expect(NoticeSheet.offer(sells: true, offers: .ready([annual]), line: .subscribed) == settled)
        // The plan turns Premium once the sync lands, while the notice may still be up.
        #expect(NoticeSheet.offer(sells: false, offers: .ready([annual]), line: .subscribed) == settled)
        #expect(settled.discloses == false)
    }

    @Test func subscribeOnANoticeBuysAnnualFromTheNotice() async {
        let client = FakePurchaseClient()
        let purchase = PurchaseModel(client: client, refresh: {}, sync: {}, analytics: sink.client)
        await purchase.loadOffers()
        purchase.period = .monthly

        await NoticeSheet.subscribe(purchase, from: .trialReminder)

        #expect(client.purchased == [.annual])
        #expect(purchase.line == .subscribed)
        #expect(
            sink.captures.contains(
                .init(
                    name: "purchase_started",
                    properties: ["period": .string("annual"), "from": .string("trial_reminder")])))
    }

    @Test func aCancelledNoticePurchaseKeepsSubscribeWithNoLine() async {
        let client = FakePurchaseClient()
        client.purchaseResult = .cancelled
        let purchase = PurchaseModel(client: client, refresh: {}, sync: {}, analytics: sink.client)
        await purchase.loadOffers()

        await NoticeSheet.subscribe(purchase, from: .trialReminder)

        #expect(client.purchased == [.annual])
        #expect(purchase.line == nil)
        let offer = NoticeSheet.offer(sells: true, offers: purchase.offers, line: purchase.line)
        #expect(offer.primary == .subscribe("A$1"))
        #expect(offer.outcome(purchase.line) == nil)
    }

    @Test func whileOffersLoadSubscribesPlaceWaitsUnderCompareAlreadyInPlace() {
        let loading = NoticeSheet.offer(sells: true, offers: .loading, line: nil)
        #expect(loading == .init(primary: .waiting, secondary: .comparePlans))
        #expect(loading.discloses == false)
        // Once the store answers, the choice settles without Compare plans moving up first.
        #expect(
            NoticeSheet.offer(sells: true, offers: .ready([annual]), line: nil)
                == .init(primary: .subscribe("$49.99"), secondary: .comparePlans))
        #expect(
            NoticeSheet.offer(sells: true, offers: .unavailable, line: nil)
                == .init(primary: .comparePlans, secondary: nil))
        // A notice that is not purchasable never waits on the store.
        #expect(
            NoticeSheet.offer(sells: false, offers: .loading, line: nil)
                == .init(primary: .comparePlans, secondary: nil))
    }

    @Test func onlyAChoiceOrASettledPurchaseShowsTheOutcome() {
        let subscribe = NoticeSheet.Offer(primary: .subscribe("$49.99"), secondary: .comparePlans)
        #expect(subscribe.outcome(.failed) == PlanText.line(.failed))
        #expect(subscribe.outcome(nil) == nil)
        #expect(NoticeSheet.Offer(primary: .close, secondary: nil).outcome(.subscribed) == PlanText.subscribed)
        // A failure from before the device went offline does not sit over Compare plans.
        #expect(NoticeSheet.Offer(primary: .comparePlans, secondary: nil).outcome(.failed) == nil)
        #expect(NoticeSheet.Offer(primary: .waiting, secondary: .comparePlans).outcome(.failed) == nil)
    }

    @Test func returnNeverBuys() {
        #expect(NoticeSheet.Action.subscribe("$49.99").isDefault == false)
        #expect(NoticeSheet.Action.waiting.isDefault == false)
        #expect(NoticeSheet.Action.comparePlans.isDefault)
        #expect(NoticeSheet.Action.close.isDefault)
    }

    @Test func comparePlansHoldsTheEntryUntilTheNoticeHasGone() {
        let handoff = CompareHandoff()
        var steps: [String] = []

        handoff.compare(.trialReminder) { steps.append("dismiss, holding \(handoff.entry == .trialReminder)") }
        #expect(steps == ["dismiss, holding true"])

        // The Plan sheet is asked for while the cover still holds, then the cover lets go.
        handoff.noticeLeft(
            open: { entry in steps.append("open \(entry == .trialReminder), holding \(handoff.entry != nil)") },
            seePlan: {})
        #expect(steps == ["dismiss, holding true", "open true, holding true"])
        #expect(handoff.entry == nil)
    }

    @Test func seePlanWaitsUntilTheNoticeHasGone() {
        let handoff = CompareHandoff()
        var steps: [String] = []

        handoff.seePlan { steps.append("dismiss, holding \(handoff.isHolding)") }
        handoff.noticeLeft(open: { _ in steps.append("compare") }, seePlan: { steps.append("see plan") })
        handoff.noticeLeft(open: { _ in steps.append("compare") }, seePlan: { steps.append("see plan") })

        #expect(steps == ["dismiss, holding true", "see plan"])
        #expect(!handoff.isHolding)
    }

    @Test func aNoticeLeavingWithoutCompareOpensNothing() {
        let handoff = CompareHandoff()
        var opened: [PremiumEntry] = []

        handoff.noticeLeft(open: { opened.append($0) }, seePlan: {})
        handoff.compare(nil) {}
        handoff.noticeLeft(open: { opened.append($0) }, seePlan: {})

        #expect(opened.isEmpty)
    }

    @Test func theNoticesNameThePlansValues() {
        #expect(NoticeKind.allCases.map(\.rawValue) == PlanNotice.allCases.map(\.rawValue))
    }
}

#if os(macOS)
    @MainActor
    @Suite struct MacNoticeFooterTests {
        @Test func firstRecordingNoticeDefaultsToOK() {
            let footer = NoticeSheet.macFirstRecordingFooter(onClose: {}, onSeePlan: {})
            #expect(footer.cancel == nil)
            #expect(footer.secondary?.title == PlanText.seePlan)
            #expect(footer.secondary?.role == .secondary)
            #expect(footer.primary?.title == NoticeText.ok)
            #expect(footer.primary?.role == .primary)
            // Escape closes it as OK does, though no Cancel shows.
            #expect(footer.escape != nil)
            let keys = MacSheetAction.keyboardRoles(
                cancel: footer.cancel, primary: footer.primary)
            #expect(keys == .init(cancel: nil, primary: .defaultAction))
        }

        @Test func trialNoticeNeverDefaultsToSubscribe() {
            let purchasable = NoticeSheet.macTrialFooter(
                NoticeSheet.Offer(primary: .subscribe("$49.99"), secondary: .comparePlans), isWorking: false,
                onClose: {}, onComparePlans: {}, onSubscribe: {})
            #expect(purchasable.cancel?.title == PlanSheet.close)
            #expect(purchasable.secondary?.title == PlanText.comparePlans)
            #expect(purchasable.primary?.title == NoticeText.subscribeAnnual("$49.99"))
            #expect(purchasable.primary?.role == .primary)
            #expect(purchasable.primary?.isDefault == false)
            #expect(
                MacSheetAction.keyboardRoles(
                    cancel: purchasable.cancel, primary: purchasable.primary)
                    == .init(cancel: .cancellation, primary: nil))

            let waiting = NoticeSheet.macTrialFooter(
                NoticeSheet.Offer(primary: .waiting, secondary: .comparePlans), isWorking: false, onClose: {},
                onComparePlans: {}, onSubscribe: {})
            #expect(waiting.primary?.isDefault == false)
            #expect(waiting.primary?.isEnabled == false)
            #expect(waiting.secondary?.title == PlanText.comparePlans)
        }

        @Test func aTrialNoticeWithoutASaleDefaultsToComparePlans() {
            let footer = NoticeSheet.macTrialFooter(
                NoticeSheet.Offer(primary: .comparePlans, secondary: nil), isWorking: false, onClose: {},
                onComparePlans: {}, onSubscribe: {})
            #expect(footer.cancel?.title == PlanSheet.close)
            #expect(footer.secondary == nil)
            #expect(footer.primary?.title == PlanText.comparePlans)
            #expect(footer.primary?.isDefault == true)
        }

        /// Once a purchase settles, Close is the one way out, so it takes Return and Escape.
        @Test func aSettledTrialNoticeClosesOnEitherKey() {
            let footer = NoticeSheet.macTrialFooter(
                NoticeSheet.Offer(primary: .close, secondary: nil), isWorking: false, onClose: {},
                onComparePlans: {}, onSubscribe: {})
            #expect(footer.cancel == nil)
            #expect(footer.primary?.title == PlanSheet.close)
            #expect(footer.primary?.isDefault == true)
            #expect(footer.escape != nil)
        }
    }

    /// Presses keys in a notice hosted in a hidden window, so the notice's own wiring, the
    /// hidden Escape button included, is what answers.
    @MainActor
    @Suite(.enabled(if: hasWindowServer, "Needs a window server to host the sheet"))
    struct MacNoticeKeyTests {
        final class Presses {
            var close = 0
            var seePlan = 0
            var compare = 0
        }

        private func host(_ notice: PlanNotice, _ presses: Presses) -> NSWindow {
            let sheet = NoticeSheet(
                notice: notice, endsAt: Date(timeIntervalSince1970: 1_800_000_000),
                plan: Plan(kind: .premium, source: .trial),
                purchase: nil, onClose: { presses.close += 1 }, onSeePlan: { presses.seePlan += 1 },
                onComparePlans: { presses.compare += 1 })
            let window = hiddenWindow(
                size: CGSize(width: 480, height: 400), styleMask: [.titled], appearance: .aqua)
            window.contentView = NSHostingView(rootView: sheet)
            window.orderFrontRegardless()
            return window
        }

        /// Offers the key until the hosted view handles it, since it takes a few run-loop turns
        /// to lay out and register its shortcuts, then stops, so one press is one press.
        private func press(_ characters: String, code: UInt16, in window: NSWindow) async -> Bool {
            let event = NSEvent.keyEvent(
                with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0,
                windowNumber: window.windowNumber, context: nil, characters: characters,
                charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)!
            for _ in 0..<40 {
                if window.performKeyEquivalent(with: event) { return true }
                try? await Task.sleep(for: .milliseconds(25))
            }
            return false
        }

        @Test func escapeClosesTheFirstRecordingNotice() async throws {
            let presses = Presses()
            let window = host(.firstRecording, presses)
            defer { window.close() }

            #expect(await press("\u{1B}", code: 53, in: window))
            #expect(try await poll { presses.close == 1 })
            #expect(presses.seePlan == 0)
        }

        @Test func escapeClosesATrialNotice() async throws {
            let presses = Presses()
            let window = host(.trialEnded, presses)
            defer { window.close() }

            #expect(await press("\u{1B}", code: 53, in: window))
            #expect(try await poll { presses.close == 1 })
            #expect(presses.compare == 0)
        }
    }
#endif
