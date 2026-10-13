import Foundation

/// The words for the one-time plan notices. The way to the Plan group is ``PlanText/seePlan``.
public enum NoticeText {
    nonisolated public static let firstRecordingTitle = "Recordings are part of your trial"
    nonisolated public static let trialEndedTitle = "Your trial has ended"
    nonisolated public static let ok = "OK"
    nonisolated public static let losePlayback = "Recordings don't play in the app"
    nonisolated public static let loseRecording = "No new recordings or practice mode"
    nonisolated public static let loseScans = "Scans open on one tune only"
    nonisolated public static let keeps =
        "Every recording and scan stays, and export always includes them. Subscribe and they play again at once."

    /// What is left of the trial, from whole calendar days: zero or fewer is its last day.
    nonisolated public static func daysLeft(_ days: Int) -> String {
        if days <= 0 { return PlanText.trialEndsToday }
        return days == 1 ? "1 day left of Premium" : "\(days) days left of Premium"
    }

    nonisolated public static func subscribeAnnual(_ price: String) -> String { "Subscribe for \(price) a year" }

    nonisolated public static func firstRecordingBody(endsAt: String) -> String {
        "Your Premium trial ends \(endsAt). After that, every recording stays and exports, but it won't play in the app until you subscribe."
    }

    nonisolated public static func trialReminderTitle(endsAt: String) -> String {
        "Your trial ends \(endsAt)"
    }
}
