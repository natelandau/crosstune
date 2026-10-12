import CrosstuneStore
import Foundation

/// The words for the account's plan, identical to the web's.
public enum PlanText {
    nonisolated public static let group = "Plan"
    nonisolated public static let free = "Free"
    nonisolated public static let premium = "Premium"
    nonisolated public static let trial = "Premium trial"
    nonisolated public static let freeHelp =
        "Free includes your catalog, lists, links, sync, and export. Recordings and scans on more than one tune are part of Premium."
    nonisolated public static let freeStorageHelp = "On the free plan, storage counts scans only."
    nonisolated public static let premiumRecordingsTitle = "Recordings are part of Premium"
    nonisolated public static let premiumScansTitle = "Scans on more than one tune are part of Premium"
    nonisolated public static let premiumRecordingsBody =
        "Premium keeps your recordings on our servers, so they play on every device. Every recording you already have stays: you can rename, file, delete, and export it on any plan."
    nonisolated public static let seePlan = "See your plan"
    nonisolated public static let premiumPlanTitle = "Crosstune Premium"
    nonisolated public static let premiumPlanBody =
        "Recordings that play on every device, practice mode, scans on every tune, and 5 GB of storage."
    nonisolated public static let subscribe = "Subscribe"
    nonisolated public static let periodAnnual = "Annual"
    nonisolated public static let periodMonthly = "Monthly"
    nonisolated public static let billingPeriod = "Billing period"
    nonisolated public static let billingStartsToday = "Billing starts today. The rest of your trial is not added on."
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

    nonisolated public static func annualPrice(_ price: String) -> String { "\(price) a year" }
    nonisolated public static func monthlyPrice(_ price: String) -> String { "\(price) a month" }

    /// Names the one tune a free account's scans open on.
    nonisolated public static func premiumScansBody(tuneTitle: String) -> String {
        "On the free plan, scans open on one tune, \"\(tuneTitle)\". Pages on other tunes stay: you can delete or export them."
    }

    /// A trial's end and what is left of it, counted in calendar days.
    nonisolated public static func trialLeft(
        endsAt: Date, now: Date, calendar: Calendar = .current, locale: Locale = .current
    ) -> String {
        let days =
            calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: endsAt))
            .day ?? 0
        if days <= 0 { return "Ends today" }
        let left = days == 1 ? "1 day left" : "\(days) days left"
        return "Ends \(day(endsAt, calendar: calendar, locale: locale)), \(left)"
    }

    /// The end of a comp or paid grant.
    nonisolated public static func premiumUntil(
        _ date: Date, calendar: Calendar = .current, locale: Locale = .current
    ) -> String {
        "Until \(day(date, calendar: calendar, locale: locale))"
    }

    /// The plan row's name for a plan, nil while it is unknown.
    nonisolated static func name(_ plan: Plan) -> String? {
        switch plan.kind {
        case .unknown: nil
        case .free: free
        case .premium: plan.isTrial ? trial : premium
        }
    }

    /// The plan row's detail: a trial's days left, or when a comp or paid grant ends.
    nonisolated static func detail(
        _ plan: Plan, now: Date, calendar: Calendar = .current, locale: Locale = .current
    ) -> String? {
        guard plan.kind == .premium else { return nil }
        if plan.isTrial {
            return (plan.trialEndsAt ?? plan.premiumEndsAt).map {
                trialLeft(endsAt: $0, now: now, calendar: calendar, locale: locale)
            }
        }
        return plan.premiumEndsAt.map { premiumUntil($0, calendar: calendar, locale: locale) }
    }

    /// A day in the app's date format.
    nonisolated static func day(_ date: Date, calendar: Calendar = .current, locale: Locale = .current) -> String {
        date.formatted(
            Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
                .month(.abbreviated).day().year())
    }
}
