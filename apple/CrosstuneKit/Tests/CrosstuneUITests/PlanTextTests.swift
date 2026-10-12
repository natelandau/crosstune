import CrosstuneStore
import Foundation
import Testing

@testable import CrosstuneUI

@Suite struct PlanTextTests {
    private static let locale = Locale(identifier: "en_US")
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }()
    private static let now = Date(timeIntervalSince1970: 1_791_633_600)  // 2026-10-10 12:00 GMT

    @Test func namesThePlansAndHelp() {
        #expect(PlanText.group == "Plan")
        #expect(PlanText.free == "Free")
        #expect(PlanText.premium == "Premium")
        #expect(PlanText.trial == "Premium trial")
        #expect(
            PlanText.freeHelp
                == "Free includes your catalog, lists, links, sync, and export. Recordings and scans on more than one tune are part of Premium."
        )
        #expect(PlanText.freeStorageHelp == "On the free plan, storage counts scans only.")
    }

    @Test func holdsTheAppleOnlyCopy() {
        #expect(
            PlanText.subscribePending == "Your purchase is waiting for approval. Premium starts once it goes through.")
        #expect(PlanText.restorePurchases == "Restore purchases")
        #expect(PlanText.restored == "Your App Store subscription is restored.")
        #expect(PlanText.nothingToRestore == "This Apple Account has no Crosstune subscription to restore.")
        #expect(
            PlanText.otherAccount
                == "This App Store subscription belongs to another Crosstune account. Sign out, then sign in with the account that subscribed."
        )
        #expect(PlanText.restoreFailed == "Restoring didn't finish. Try again in a moment.")
        #expect(PlanText.manageOnTheWeb == "Manage on the web")
        #expect(PlanText.manageAtWebsite == "Manage your subscription at my.crosstune.app.")
        #expect(PlanText.termsOfUse == "Terms of Use")
        #expect(PlanText.privacyPolicy == "Privacy Policy")
        #expect(PlanText.termsURL == "https://crosstune.app/terms")
        #expect(PlanText.privacyURL == "https://crosstune.app/privacy")
    }

    @Test func countsTheDaysLeftInATrial() {
        let ends = Self.now.addingTimeInterval(5 * 86_400)
        #expect(
            PlanText.trialLeft(endsAt: ends, now: Self.now, calendar: Self.calendar, locale: Self.locale)
                == "Ends Oct 15, 2026, 5 days left")
    }

    @Test func saysOneDayLeft() {
        let ends = Self.now.addingTimeInterval(86_400)
        #expect(
            PlanText.trialLeft(endsAt: ends, now: Self.now, calendar: Self.calendar, locale: Self.locale)
                == "Ends Oct 11, 2026, 1 day left")
    }

    @Test func saysEndsTodayOnTheLastDay() {
        let ends = Self.now.addingTimeInterval(3_600)
        #expect(
            PlanText.trialLeft(endsAt: ends, now: Self.now, calendar: Self.calendar, locale: Self.locale)
                == "Ends today")
    }

    @Test func namesTheDayAGrantEnds() {
        #expect(
            PlanText.premiumUntil(Self.now, calendar: Self.calendar, locale: Self.locale) == "Until Oct 10, 2026")
    }

    @Test func namesThePlanByKindAndSource() {
        #expect(PlanText.name(.unknown) == nil)
        #expect(PlanText.name(Plan(kind: .free)) == "Free")
        #expect(PlanText.name(Plan(kind: .premium, source: .trial)) == "Premium trial")
        #expect(PlanText.name(Plan(kind: .premium, source: .comp)) == "Premium")
        #expect(PlanText.name(Plan(kind: .premium, source: .apple)) == "Premium")
    }

    @Test func detailsATrialByItsEndAndFallsBackToTheGrantEnd() {
        let ends = Self.now.addingTimeInterval(5 * 86_400)
        let expected = "Ends Oct 15, 2026, 5 days left"
        let byTrial = Plan(kind: .premium, source: .trial, trialEndsAt: ends)
        let byGrant = Plan(kind: .premium, source: .trial, premiumEndsAt: ends)
        for plan in [byTrial, byGrant] {
            #expect(PlanText.detail(plan, now: Self.now, calendar: Self.calendar, locale: Self.locale) == expected)
        }
    }

    @Test func detailsAGrantByItsEndOrNotAtAll() {
        let comp = Plan(kind: .premium, source: .comp, premiumEndsAt: Self.now)
        #expect(
            PlanText.detail(comp, now: Self.now, calendar: Self.calendar, locale: Self.locale) == "Until Oct 10, 2026")
        let open = Plan(kind: .premium, source: .comp)
        #expect(PlanText.detail(open, now: Self.now, calendar: Self.calendar, locale: Self.locale) == nil)
        #expect(PlanText.detail(Plan(kind: .free), now: Self.now) == nil)
        #expect(PlanText.detail(.unknown, now: Self.now) == nil)
    }

    @Test func picksTheQuotaFromThePlanOrTheReportedFigures() {
        let reported = StorageFigures(usedBytes: 1, quotaBytes: 900, maxFileBytes: 1)
        let none = StorageFigures(usedBytes: 1, quotaBytes: 0, maxFileBytes: 1)
        #expect(StorageFigures.quota(plan: Plan(kind: .free, quotaBytes: 50), reported: reported) == 50)
        #expect(StorageFigures.quota(plan: .unknown, reported: reported) == 900)
        #expect(StorageFigures.quota(plan: .unknown, reported: none) == nil)
        #expect(StorageFigures.quota(plan: .unknown, reported: nil) == nil)
        #expect(StorageFigures.quota(plan: Plan(kind: .free), reported: reported) == 900)
        #expect(reported.measured(against: Plan(kind: .free)) == reported)
    }
}
