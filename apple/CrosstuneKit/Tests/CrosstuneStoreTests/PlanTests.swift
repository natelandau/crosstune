import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneStore

private let now = Date(timeIntervalSince1970: 1_791_633_600)  // 2026-10-10T12:00:00Z
private let day: TimeInterval = 86_400

private func at(_ offset: TimeInterval) -> Timestamp { Timestamp(now.addingTimeInterval(offset)) }

private func row(
    source: String? = nil, expiresAt: Timestamp? = nil, autoRenews: Bool = false, trialEndsAt: Timestamp? = nil,
    recordingNoticeSeenAt: Timestamp? = nil, trialReminderSeenAt: Timestamp? = nil, trialEndSeenAt: Timestamp? = nil
) -> Entitlement {
    Entitlement(
        id: "entitlement-1", createdAt: Timestamp(iso: "2026-01-01T00:00:00.000Z")!, premiumSource: source,
        premiumExpiresAt: expiresAt, autoRenews: autoRenews, trialEndsAt: trialEndsAt, premiumQuotaBytes: 10_000,
        freeQuotaBytes: 1_000, recordingNoticeSeenAt: recordingNoticeSeenAt, trialReminderSeenAt: trialReminderSeenAt,
        trialEndSeenAt: trialEndSeenAt)
}

private func scan(_ id: String, _ tuneID: String, _ createdAt: String, deletedAt: String? = nil) -> ScanRecord {
    ScanRecord(
        id: id, createdAt: Timestamp(iso: createdAt)!, deletedAt: deletedAt.flatMap(Timestamp.init(iso:)),
        tuneID: tuneID, width: 10, height: 10)
}

@Suite struct PlanFromTests {
    @Test func isUnknownWithNoRowAndGatesNothing() {
        let plan = Plan.from(nil, now: now)
        #expect(plan.kind == .unknown)
        #expect(plan.quotaBytes == nil)
        #expect(plan.scansOnly == false)
        #expect(plan.recordingsPlay)
    }

    @Test func isPremiumDuringATrialWithThePremiumQuota() {
        let plan = Plan.from(row(source: "trial", expiresAt: at(day), trialEndsAt: at(day)), now: now)
        #expect(
            plan
                == Plan(
                    kind: .premium, source: .trial, premiumEndsAt: at(day).date, trialEndsAt: at(day).date,
                    quotaBytes: 10_000, scansOnly: false))
    }

    @Test func isFreeOnceATrialExpiredASecondAgoWithTheFreeQuotaCountingScansOnly() {
        let plan = Plan.from(row(source: "trial", expiresAt: at(-1)), now: now)
        #expect(plan.kind == .free)
        #expect(plan.source == nil)
        #expect(plan.quotaBytes == 1_000)
        #expect(plan.scansOnly)
        #expect(!plan.recordingsPlay)
    }

    @Test func isFreeAtTheVeryInstantAGrantExpires() {
        #expect(Plan.from(row(source: "stripe", expiresAt: at(0)), now: now).kind == .free)
    }

    @Test func keepsAnAutoRenewingGrantPremiumForSevenDaysPastItsExpiry() {
        let grant = { (daysAgo: Double) in row(source: "apple", expiresAt: at(-daysAgo * day), autoRenews: true) }
        #expect(Plan.from(grant(3), now: now).kind == .premium)
        #expect(Plan.from(grant(8), now: now).kind == .free)
        #expect(Plan.from(grant(7), now: now).kind == .free)
        #expect(PlanRules.offlineLeeway == 7 * day)
    }

    @Test func givesAGrantThatDoesNotAutoRenewNoLeeway() {
        #expect(Plan.from(row(source: "stripe", expiresAt: at(-day)), now: now).kind == .free)
    }

    @Test func isPremiumForACompWithNoExpiry() {
        let plan = Plan.from(row(source: "comp"), now: now)
        #expect(plan.kind == .premium)
        #expect(plan.source == .comp)
        #expect(plan.premiumEndsAt == nil)
    }

    @Test func isFreeWithNoPremiumSource() {
        #expect(Plan.from(row(), now: now).kind == .free)
    }

    @Test func reportsNoSourceThisBuildDoesNotKnow() {
        let plan = Plan.from(row(source: "gift"), now: now)
        #expect(plan.kind == .premium)
        #expect(plan.source == nil)
    }
}

@Suite struct ScanTuneTests {
    @Test func picksTheTuneOfTheEarliestLiveScan() {
        let scans = [
            scan("b", "tune-b", "2026-02-01T00:00:00.000Z"), scan("a", "tune-a", "2026-01-01T00:00:00.000Z"),
        ]
        #expect(PlanRules.scanTuneID(scans) == "tune-a")
    }

    @Test func breaksACreatedAtTieByID() {
        let scans = [
            scan("b", "tune-b", "2026-01-01T00:00:00.000Z"), scan("a", "tune-a", "2026-01-01T00:00:00.000Z"),
        ]
        #expect(PlanRules.scanTuneID(scans) == "tune-a")
    }

    @Test func ignoresDeletedScans() {
        let scans = [
            scan("a", "tune-a", "2026-01-01T00:00:00.000Z", deletedAt: "2026-03-01T00:00:00.000Z"),
            scan("b", "tune-b", "2026-02-01T00:00:00.000Z"),
        ]
        #expect(PlanRules.scanTuneID(scans) == "tune-b")
    }

    @Test func isNilWithNoLiveScan() {
        #expect(PlanRules.scanTuneID([]) == nil)
        let deleted = scan("a", "tune-a", "2026-01-01T00:00:00.000Z", deletedAt: "2026-03-01T00:00:00.000Z")
        #expect(PlanRules.scanTuneID([deleted]) == nil)
    }

    @Test func opensAnyScanForPremiumAndForAnUnknownPlan() {
        let premium = Plan.from(row(source: "comp"), now: now)
        #expect(PlanRules.scanOpens(premium, tuneID: "tune-b", scanTune: "tune-a"))
        #expect(PlanRules.scanOpens(Plan.from(nil, now: now), tuneID: "tune-b", scanTune: "tune-a"))
    }

    @Test func opensOnlyTheScanTuneOnFreeOrAnyTuneWhileThereIsNone() {
        let free = Plan.from(row(), now: now)
        #expect(PlanRules.scanOpens(free, tuneID: "tune-a", scanTune: "tune-a"))
        #expect(!PlanRules.scanOpens(free, tuneID: "tune-b", scanTune: "tune-a"))
        #expect(PlanRules.scanOpens(free, tuneID: "tune-b", scanTune: nil))
    }
}

@Suite struct DueNoticeTests {
    @Test func isTrialEndedForAFreeAccountWhoseTrialHasEndedAndWasNotSeen() {
        #expect(PlanRules.dueNotice(row(trialEndsAt: at(-1)), now: now, holdsRecordings: false) == .trialEnded)
        let seen = row(trialEndsAt: at(-1), trialEndSeenAt: at(-0.5))
        #expect(PlanRules.dueNotice(seen, now: now, holdsRecordings: false) == nil)
    }

    @Test func isTrialReminderInsideTheLastThreeDaysOfATrial() {
        let trial = row(source: "trial", expiresAt: at(2 * day), trialEndsAt: at(2 * day))
        #expect(PlanRules.dueNotice(trial, now: now, holdsRecordings: false) == .trialReminder)
        let seen = row(
            source: "trial", expiresAt: at(2 * day), trialEndsAt: at(2 * day), trialReminderSeenAt: at(-0.5))
        #expect(PlanRules.dueNotice(seen, now: now, holdsRecordings: false) == nil)
        let early = row(source: "trial", expiresAt: at(4 * day), trialEndsAt: at(4 * day))
        #expect(PlanRules.dueNotice(early, now: now, holdsRecordings: false) == nil)
        #expect(PlanRules.trialReminder == 3 * day)
    }

    @Test func isFirstRecordingForATrialThatHoldsARecording() {
        let trial = row(source: "trial", expiresAt: at(10 * day), trialEndsAt: at(10 * day))
        #expect(PlanRules.dueNotice(trial, now: now, holdsRecordings: false) == nil)
        #expect(PlanRules.dueNotice(trial, now: now, holdsRecordings: true) == .firstRecording)
        let seen = row(
            source: "trial", expiresAt: at(10 * day), trialEndsAt: at(10 * day), recordingNoticeSeenAt: at(-0.5))
        #expect(PlanRules.dueNotice(seen, now: now, holdsRecordings: true) == nil)
    }

    @Test func putsTheReminderBeforeFirstRecording() {
        let trial = row(source: "trial", expiresAt: at(day), trialEndsAt: at(day))
        #expect(PlanRules.dueNotice(trial, now: now, holdsRecordings: true) == .trialReminder)
    }

    @Test func putsTrialEndedBeforeTheOthers() {
        #expect(PlanRules.dueNotice(row(trialEndsAt: at(-day)), now: now, holdsRecordings: true) == .trialEnded)
        let expired = row(source: "trial", expiresAt: at(-day), trialEndsAt: at(-day))
        #expect(PlanRules.dueNotice(expired, now: now, holdsRecordings: true) == .trialEnded)
    }

    /// The server never rewrites the row when a grant expires, so an ended trial keeps its source.
    @Test func isTrialEndedForATrialThatRanOutAndStillNamesItsSource() {
        let expired = row(source: "trial", expiresAt: at(-1), trialEndsAt: at(-1))
        #expect(PlanRules.dueNotice(expired, now: now, holdsRecordings: false) == .trialEnded)
    }

    @Test func showsALapsedPurchaseNoTrialEndedNotice() {
        let lapsed = row(source: "apple", expiresAt: at(-30 * day), trialEndsAt: at(-60 * day))
        #expect(PlanRules.dueNotice(lapsed, now: now, holdsRecordings: true) == nil)
    }

    @Test func showsACompOrAPurchaseNoNotice() {
        let comp = row(source: "comp", trialEndsAt: at(-day))
        #expect(PlanRules.dueNotice(comp, now: now, holdsRecordings: true) == nil)
        let bought = row(source: "stripe", expiresAt: at(day), trialEndsAt: at(day))
        #expect(PlanRules.dueNotice(bought, now: now, holdsRecordings: true) == nil)
        #expect(PlanRules.dueNotice(nil, now: now, holdsRecordings: true) == nil)
    }

    @Test func namesEachNoticeAsTheAPIDoes() {
        #expect(PlanNotice.allCases.map(\.rawValue) == ["first_recording", "trial_reminder", "trial_ended"])
    }
}

@Suite struct NextChangeTests {
    @Test func isNilWithNoRowACompOrNothingAhead() {
        #expect(PlanRules.nextChange(nil, now: now) == nil)
        #expect(PlanRules.nextChange(row(source: "comp"), now: now) == nil)
        #expect(PlanRules.nextChange(row(trialEndsAt: at(-day)), now: now) == nil)
    }

    @Test func isTheExpiryPlusTheLeewayForAnAutoRenewingGrant() {
        let grant = row(source: "apple", expiresAt: at(-3 * day), autoRenews: true)
        #expect(PlanRules.nextChange(grant, now: now) == at(4 * day).date)
    }

    @Test func isTheExpiryForAGrantThatDoesNotRenew() {
        #expect(PlanRules.nextChange(row(source: "stripe", expiresAt: at(2 * day)), now: now) == at(2 * day).date)
    }

    @Test func isTheReminderStartForATrialMoreThanThreeDaysOut() {
        let trial = row(source: "trial", expiresAt: at(5 * day), trialEndsAt: at(5 * day))
        #expect(PlanRules.nextChange(trial, now: now) == at(2 * day).date)
    }

    @Test func isTheTrialEndOnceInsideTheReminderWindow() {
        let trial = row(source: "trial", expiresAt: at(day), trialEndsAt: at(day))
        #expect(PlanRules.nextChange(trial, now: now) == at(day).date)
    }

    @Test func changesTheAnswerOfDueNoticeExactlyAtTheInstantItReturns() throws {
        let trial = row(source: "trial", expiresAt: at(5 * day), trialEndsAt: at(5 * day))
        let change = try #require(PlanRules.nextChange(trial, now: now))
        let before = change.addingTimeInterval(-0.001)
        #expect(PlanRules.dueNotice(trial, now: before, holdsRecordings: false) == nil)
        #expect(PlanRules.dueNotice(trial, now: change, holdsRecordings: false) == .trialReminder)
    }
}

@Suite struct CurrentEntitlementTests {
    @Test func readsTheLiveRowAndIgnoresADeletedOne() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        #expect(try await store.read { db in try Entitlement.current(db) } == nil)

        var tombstoned = row(source: "comp")
        tombstoned.id = "entitlement-0"
        tombstoned.deletedAt = noon
        let deleted = tombstoned
        try await store.write { writer in try deleted.insert(writer.db) }
        #expect(try await store.read { db in try Entitlement.current(db) } == nil)

        let live = row(source: "trial", expiresAt: at(day))
        try await store.write { writer in try live.insert(writer.db) }
        #expect(try await store.read { db in try Entitlement.current(db) } == live)
    }
}

@Suite struct PlanCanSubscribeTests {
    @Test func isTrueForFreeAndForATrial() {
        #expect(Plan(kind: .free).canSubscribe)
        #expect(Plan(kind: .premium, source: .trial).canSubscribe)
    }

    @Test func isFalseForEveryOtherPlan() {
        #expect(Plan(kind: .premium, source: .comp).canSubscribe == false)
        #expect(Plan(kind: .premium, source: .apple).canSubscribe == false)
        #expect(Plan(kind: .premium, source: .stripe).canSubscribe == false)
        #expect(Plan(kind: .premium, source: nil).canSubscribe == false)
        #expect(Plan.unknown.canSubscribe == false)
    }
}

@Suite struct PlanIsTrialTests {
    @Test func isTrueOnlyForAPremiumTrial() {
        #expect(Plan(kind: .premium, source: .trial).isTrial)
        #expect(Plan(kind: .premium, source: .apple).isTrial == false)
        #expect(Plan(kind: .premium, source: nil).isTrial == false)
        #expect(Plan(kind: .free).isTrial == false)
        // A free plan never carries a source, but one built with it is still not a trial.
        #expect(Plan(kind: .free, source: .trial).isTrial == false)
        #expect(Plan.unknown.isTrial == false)
    }
}
