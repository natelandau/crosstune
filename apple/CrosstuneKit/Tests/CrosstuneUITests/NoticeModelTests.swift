import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import SwiftUI
import Testing

@testable import CrosstuneUI

@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("Timed out waiting for a condition")
}

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
            trialEndsAt: trialEndsAt.map(Timestamp.init), premiumQuotaBytes: 10_000, freeQuotaBytes: 1_000,
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
        #expect(model.holdsRecordings)
    }

    @Test func waitsWhileTheShellIsCoveredOrCapturing() async throws {
        try await pull(trial(endingIn: 10))
        let model = try await model()
        model.coverChanged(covered: true, capturing: false)

        try await addRecording()
        try await eventually { model.facts?.holdsRecordings == true }
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
        try await eventually { model.facts?.seen == [.firstRecording] }
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
        #expect(model.holdsRecordings == false)
    }

    @Test func theReminderKnowsWhenTheAccountHoldsRecordings() async throws {
        try await pull(trial(endingIn: 2))
        try await addRecording()
        try await store.write { writer in try writer.markNoticeSeen(.firstRecording) }
        let model = try await model()

        try await eventually { model.showing == .trialReminder }
        #expect(model.holdsRecordings)
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
        try await eventually { model.facts?.holdsRecordings == true }

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
        try await eventually { other.facts?.seen == [.firstRecording] }
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
        #expect(
            NoticeText.trialReminderBody
                == "Premium keeps recordings playing, practice mode, and scans on every tune.")
        #expect(
            NoticeText.trialReminderRecordings
                == "Your recordings stay and export after that, but stop playing in the app until you subscribe.")
        #expect(NoticeText.trialEndedTitle == "Your trial has ended")
        #expect(
            NoticeText.trialEndedBody
                == "Every recording you made is kept. Export includes them, and they play again the moment you subscribe. Scans stay open on one tune."
        )
        #expect(NoticeText.ok == "OK")
    }

    @Test func theSheetSaysWhatTheNoticeIs() throws {
        let ends = try #require(Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 13, hour: 12)))
        let date = PlanText.day(ends)

        #expect(NoticeSheet.title(.firstRecording, endsAt: ends) == NoticeText.firstRecordingTitle)
        #expect(
            NoticeSheet.paragraphs(.firstRecording, endsAt: ends, holdsRecordings: true)
                == [NoticeText.firstRecordingBody(endsAt: date)])
        #expect(NoticeSheet.title(.trialReminder, endsAt: ends) == NoticeText.trialReminderTitle(endsAt: date))
        #expect(
            NoticeSheet.paragraphs(.trialReminder, endsAt: ends, holdsRecordings: false)
                == [NoticeText.trialReminderBody])
        #expect(
            NoticeSheet.paragraphs(.trialReminder, endsAt: ends, holdsRecordings: true)
                == [NoticeText.trialReminderBody, NoticeText.trialReminderRecordings])
        #expect(NoticeSheet.title(.trialEnded, endsAt: ends) == NoticeText.trialEndedTitle)
        #expect(
            NoticeSheet.paragraphs(.trialEnded, endsAt: ends, holdsRecordings: true) == [NoticeText.trialEndedBody])
    }

    @Test func aRequestedPremiumSheetHoldsTheNextNotice() async throws {
        try await pull(trial(endingIn: 2))
        try await addRecording()
        let model = try await model()
        try await eventually { model.showing == .trialReminder }

        // The notice's own sheet covers the shell while it is up.
        model.coverChanged(
            covered: AppShell.noticeCovered(shellCovered: true, premiumRequested: false, phase: .active),
            capturing: false)

        // Subscribe on the reminder: the notice's sheet goes and the Premium sheet is asked for,
        // before that sheet has shown and claimed the shell.
        model.dismiss()
        model.coverChanged(
            covered: AppShell.noticeCovered(shellCovered: false, premiumRequested: true, phase: .active),
            capturing: false)

        #expect(model.showing == nil)
        model.coverChanged(
            covered: AppShell.noticeCovered(shellCovered: false, premiumRequested: false, phase: .active),
            capturing: false)
        #expect(model.showing == .firstRecording)
    }

    @Test func theNoticesOfferSubscribeOnlyWhenTheyCanSell() {
        let trial = Plan(kind: .premium, source: .trial)
        let free = Plan(kind: .free)
        #expect(NoticeSheet.subscribeEntry(.trialReminder, plan: trial, sells: true) == .trialReminder)
        #expect(NoticeSheet.subscribeEntry(.trialEnded, plan: free, sells: true) == .trialEnded)
        // The first recording keeps See your plan.
        #expect(NoticeSheet.subscribeEntry(.firstRecording, plan: trial, sells: true) == nil)
        // A build that offers no purchase keeps See your plan.
        #expect(NoticeSheet.subscribeEntry(.trialReminder, plan: trial, sells: false) == nil)
        #expect(NoticeSheet.subscribeEntry(.trialEnded, plan: free, sells: false) == nil)
        // An account already paying, or comped, is sold nothing.
        for source: PlanSource in [.apple, .stripe, .comp] {
            let plan = Plan(kind: .premium, source: source)
            #expect(NoticeSheet.subscribeEntry(.trialEnded, plan: plan, sells: true) == nil)
            #expect(NoticeSheet.subscribeEntry(.trialReminder, plan: plan, sells: true) == nil)
        }
        #expect(NoticeSheet.subscribeEntry(.trialEnded, plan: .unknown, sells: true) == nil)
    }

    @Test func theNoticesNameThePlansValues() {
        #expect(NoticeKind.allCases.map(\.rawValue) == PlanNotice.allCases.map(\.rawValue))
    }
}
