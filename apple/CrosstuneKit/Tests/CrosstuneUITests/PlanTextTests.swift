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

    @Test func savesSeventeenPercentOnTheStorePrices() {
        #expect(PlanText.saving(annual: 49.99, monthly: 4.99) == 17)
        #expect(PlanText.saving(annual: 59.88, monthly: 4.99) == nil)
        #expect(PlanText.saving(annual: 70, monthly: 4.99) == nil)
    }

    @Test func roundsTheSavingToTheNearestWholePercent() {
        // Against twelve months at 10: 114 saves 5%, 114.6 saves 4.5%, which rounds up, and 114.61
        // saves 4.49%.
        #expect(PlanText.saving(annual: 114, monthly: 10) == 5)
        #expect(PlanText.saving(annual: 114.6, monthly: 10) == 5)
        #expect(PlanText.saving(annual: 114.61, monthly: 10) == 4)
        // Half a percent rounds up to the one percent the badge needs; under it shows nothing.
        #expect(PlanText.saving(annual: 119.4, monthly: 10) == 1)
        #expect(PlanText.saving(annual: 119.41, monthly: 10) == nil)
    }

    @Test func savesNothingAgainstAFreeOrNegativeMonth() {
        #expect(PlanText.saving(annual: 49.99, monthly: 0) == nil)
        #expect(PlanText.saving(annual: 49.99, monthly: -4.99) == nil)
    }

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

    @Test func trialDaysCountsWholeCalendarDays() {
        let days = { (offset: TimeInterval) in
            PlanText.trialDays(endsAt: Self.now.addingTimeInterval(offset), now: Self.now, calendar: Self.calendar)
        }
        #expect(days(3 * 86_400) == 3)
        // Midnight tomorrow is a day away, however few hours that is.
        #expect(days(12 * 3_600) == 1)
        #expect(days(8 * 3_600) == 0)
        #expect(days(-16 * 3_600) == -1)
    }

    @Test func theTrialCardCountsTheDaysLeft() {
        let left = { (days: Double) in
            PlanText.trialDaysLeft(
                endsAt: Self.now.addingTimeInterval(days * 86_400), now: Self.now, calendar: Self.calendar)
        }
        #expect(left(5) == "5 days left")
        #expect(left(1) == "1 day left")
        // Later the same calendar day is the last day.
        #expect(left(3_600 / 86_400) == PlanText.trialEndsToday)
        #expect(left(-1) == PlanText.trialEndsToday)
        #expect(PlanText.trialEndsToday == "Ends today")
    }

    @Test func theTrialCardNamesTheDayItEnds() {
        let ends = Self.now.addingTimeInterval(5 * 86_400)
        #expect(PlanText.trialEnds(ends, calendar: Self.calendar, locale: Self.locale) == "Ends Oct 15, 2026")
    }

    @Test func theSettingsLineJoinsTheCardsTwoLines() {
        for days in [1.0, 5, 29] {
            let ends = Self.now.addingTimeInterval(days * 86_400)
            #expect(
                PlanText.trialLeft(endsAt: ends, now: Self.now, calendar: Self.calendar, locale: Self.locale)
                    == "\(PlanText.trialEnds(ends, calendar: Self.calendar, locale: Self.locale)), \(PlanText.trialDaysLeft(endsAt: ends, now: Self.now, calendar: Self.calendar))"
            )
        }
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
            PlanText.detail(comp, now: Self.now, calendar: Self.calendar, locale: Self.locale) == "Ends Oct 10, 2026")
        let open = Plan(kind: .premium, source: .comp)
        #expect(PlanText.detail(open, now: Self.now, calendar: Self.calendar, locale: Self.locale) == nil)
        #expect(PlanText.detail(Plan(kind: .free), now: Self.now) == nil)
        #expect(PlanText.detail(.unknown, now: Self.now) == nil)
    }

    @Test func detailsASubscriptionAsThePlanSheetDoes() {
        let later = Self.now.addingTimeInterval(3600)
        for source in [PlanSource.apple, .stripe] {
            let renewing = Plan(kind: .premium, source: source, premiumEndsAt: later, autoRenews: true)
            #expect(
                PlanText.detail(renewing, now: Self.now, calendar: Self.calendar, locale: Self.locale)
                    == "Renews Oct 10, 2026")
            let inLeeway = Plan(kind: .premium, source: source, premiumEndsAt: Self.now, autoRenews: true)
            #expect(PlanText.detail(inLeeway, now: Self.now, calendar: Self.calendar, locale: Self.locale) == nil)
            let lapsing = Plan(kind: .premium, source: source, premiumEndsAt: Self.now, autoRenews: false)
            #expect(
                PlanText.detail(lapsing, now: Self.now, calendar: Self.calendar, locale: Self.locale)
                    == "Ends Oct 10, 2026")
        }
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
