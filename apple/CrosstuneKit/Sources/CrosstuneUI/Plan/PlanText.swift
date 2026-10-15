import CrosstuneStore
import Foundation

/// The words for the account's plan, identical to the web's.
public enum PlanText {
    nonisolated public static let group = "Plan"
    nonisolated public static let free = "Free"
    nonisolated public static let premium = "Premium"
    nonisolated public static let trial = "Premium trial"
    nonisolated public static let freeHelp =
        "Free includes your catalog, lists, links, sync, and export. Recordings and scans are part of Premium."
    nonisolated public static let premiumRecordingsTitle = "Recordings are part of Premium"
    nonisolated public static let premiumScansTitle = "Scans are part of Premium"
    nonisolated public static let premiumRecordingsBody =
        "Premium keeps your recordings on our servers, so they play on every device. Every recording you already have stays: you can rename, file, delete, and export it on any plan."
    nonisolated public static let premiumScansBody =
        "Premium keeps your scans on our servers, so they open on every device. Every scan you already have stays: you can delete and export it on any plan."
    nonisolated public static let seePlan = "See your plan"
    nonisolated public static let premiumPlanTitle = "Crosstune Premium"
    nonisolated public static let subscribe = "Subscribe"
    nonisolated public static let periodAnnual = "Annual"
    nonisolated public static let periodMonthly = "Monthly"
    nonisolated public static let billingPeriod = "Billing period"
    nonisolated public static let renewsUntilCancelled = "Renews until you cancel."
    nonisolated public static let subscribeOffline = "Subscribing needs a connection."
    nonisolated public static let subscribed = "You're on Premium."
    nonisolated public static let subscribeFailed = "Subscribing didn't finish. Try again in a moment."
    nonisolated public static let subscribePending =
        "Your purchase is waiting for approval. Premium starts once it goes through."
    nonisolated public static let restorePurchases = "Restore purchases"
    nonisolated public static let restored = "Your App Store subscription is restored."
    nonisolated public static let nothingToRestore = "This Apple Account has no Crosstune subscription to restore."
    nonisolated public static let otherAccount =
        "This App Store subscription belongs to another Crosstune account. Sign out, then sign in with the account that subscribed."
    nonisolated public static let restoreFailed = "Restoring didn't finish. Try again in a moment."
    nonisolated public static let manageAppStore = "Manage in App Store settings"
    nonisolated public static let manageOnTheWeb = "Manage on the web"
    nonisolated public static let manageAtWebsite = "Manage your subscription at my.crosstune.app."
    nonisolated public static let termsOfUse = "Terms of Use"
    nonisolated public static let privacyPolicy = "Privacy Policy"
    nonisolated public static let termsURL = "https://crosstune.app/terms"
    nonisolated public static let privacyURL = "https://crosstune.app/privacy"
    nonisolated public static let premiumPitch =
        "Your recordings live on our servers, so they play on every device. Premium pays for that."
    nonisolated public static let trialStorage = "100 MB of storage during the trial."
    nonisolated public static let trialKeeps = "Everything you make stays and exports after."
    nonisolated public static let trialEndsToday = "Ends today"
    nonisolated public static let compareFree = "Free"
    nonisolated public static let comparePremium = "Premium"
    nonisolated public static let featureCatalog = "Tunes, lists, links, lyrics"
    nonisolated public static let featureSync = "Sync and export"
    nonisolated public static let featureRecord = "Record and upload"
    nonisolated public static let featurePlay = "Play recordings"
    nonisolated public static let featurePractice = "Practice: speed, pitch, loops"
    nonisolated public static let featureScans = "Scans"
    nonisolated public static let featureStorage = "Storage"
    nonisolated public static let storagePremium = "3 GB"
    nonisolated public static let onPremium = "You're on Premium"
    nonisolated public static let thanks = "Thanks for keeping Crosstune going."
    nonisolated public static let renews = "Renews"
    nonisolated public static let ends = "Ends"
    nonisolated public static let compGrant = "Premium from Crosstune"
    nonisolated public static let included = "What's included"
    nonisolated public static let includedRecord = "Record and upload"
    nonisolated public static let includedRecordDetail = "From any device, saved to your tunes"
    nonisolated public static let includedEveryDevice = "Recordings on every device"
    nonisolated public static let includedEveryDeviceDetail = "Stored on our servers, 3 GB"
    nonisolated public static let includedPractice = "Practice mode"
    nonisolated public static let includedPracticeDetail = "Speed, pitch, and loops"
    nonisolated public static let includedScans = "Scans"
    nonisolated public static let includedScansDetail = "Up to 20 pages a tune"
    nonisolated public static let comparePlans = "Compare plans"

    nonisolated public static func save(_ percent: Int) -> String { "Save \(percent)%" }

    /// How much the annual price saves against twelve monthly ones, as a whole percent. Nil when it
    /// saves less than one percent, so no badge claims a saving that is not there.
    nonisolated public static func saving(annual: Decimal, monthly: Decimal) -> Int? {
        guard monthly > 0 else { return nil }
        var percent = (1 - annual / (monthly * 12)) * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &percent, 0, .plain)
        let whole = NSDecimalNumber(decimal: rounded).intValue
        return whole >= 1 ? whole : nil
    }

    /// The words for a purchase or restore outcome.
    nonisolated public static func line(_ line: PurchaseModel.Line) -> String {
        switch line {
        case .subscribed: subscribed
        case .pending: subscribePending
        case .failed: subscribeFailed
        case .restored: restored
        case .nothingToRestore: nothingToRestore
        case .otherAccount: otherAccount
        case .restoreFailed: restoreFailed
        }
    }

    nonisolated public static let perYear = "a year"
    nonisolated public static let perMonth = "a month"
    nonisolated public static func annualPrice(_ price: String) -> String { "\(price) \(perYear)" }
    nonisolated public static func monthlyPrice(_ price: String) -> String { "\(price) \(perMonth)" }

    /// A trial's end and what is left of it, counted in calendar days.
    nonisolated public static func trialLeft(
        endsAt: Date, now: Date, calendar: Calendar = .current, locale: Locale = .current
    ) -> String {
        let left = trialDaysLeft(endsAt: endsAt, now: now, calendar: calendar)
        guard trialDays(endsAt: endsAt, now: now, calendar: calendar) > 0 else { return left }
        return "\(trialEnds(endsAt, calendar: calendar, locale: locale)), \(left)"
    }

    /// The trial card's headline: the calendar days left, or "Ends today" on the last day.
    nonisolated public static func trialDaysLeft(endsAt: Date, now: Date, calendar: Calendar = .current) -> String {
        let days = trialDays(endsAt: endsAt, now: now, calendar: calendar)
        if days <= 0 { return trialEndsToday }
        return days == 1 ? "1 day left" : "\(days) days left"
    }

    /// The day a trial ends, as the trial card's date line.
    nonisolated public static func trialEnds(
        _ endsAt: Date, calendar: Calendar = .current, locale: Locale = .current
    ) -> String {
        "Ends \(day(endsAt, calendar: calendar, locale: locale))"
    }

    /// Calendar days from `now` to a trial's end, zero or less on its last day.
    nonisolated static func trialDays(endsAt: Date, now: Date, calendar: Calendar = .current) -> Int {
        calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: endsAt))
            .day ?? 0
    }

    /// The plan row's name for a plan, nil while it is unknown.
    nonisolated static func name(_ plan: Plan) -> String? {
        switch plan.kind {
        case .unknown: nil
        case .free: free
        case .premium: plan.isTrial ? trial : premium
        }
    }

    /// The plan row's detail, worded as the Plan sheet's membership row: a trial's days left, or
    /// when a paid grant renews or a comp or paid grant ends.
    nonisolated static func detail(
        _ plan: Plan, now: Date, calendar: Calendar = .current, locale: Locale = .current
    ) -> String? {
        guard plan.kind == .premium else { return nil }
        if plan.isTrial {
            return (plan.trialEndsAt ?? plan.premiumEndsAt).map {
                trialLeft(endsAt: $0, now: now, calendar: calendar, locale: locale)
            }
        }
        guard let row = PlanSheet.membership(plan, now: now, calendar: calendar, locale: locale), !row.value.isEmpty
        else {
            return nil
        }
        return "\(row.label) \(row.value)"
    }

    /// A day in the app's date format.
    nonisolated static func day(_ date: Date, calendar: Calendar = .current, locale: Locale = .current) -> String {
        date.formatted(
            Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
                .month(.abbreviated).day().year())
    }
}
