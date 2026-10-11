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
        case .premium: plan.source == "trial" ? trial : premium
        }
    }

    /// The plan row's detail: a trial's days left, or when a comp or paid grant ends.
    nonisolated static func detail(
        _ plan: Plan, now: Date, calendar: Calendar = .current, locale: Locale = .current
    ) -> String? {
        guard plan.kind == .premium else { return nil }
        if plan.source == "trial" {
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
