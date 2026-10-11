import Foundation

/// The words for the one-time plan notices. The way to the Plan group is ``PlanText/seePlan``.
public enum NoticeText {
    nonisolated public static let firstRecordingTitle = "Recordings are part of your trial"
    nonisolated public static let trialReminderBody =
        "Premium keeps recordings playing, practice mode, and scans on every tune."
    nonisolated public static let trialReminderRecordings =
        "Your recordings stay and export after that, but stop playing in the app until you subscribe."
    nonisolated public static let trialEndedTitle = "Your trial has ended"
    nonisolated public static let trialEndedBody =
        "Every recording you made is kept. Export includes them, and they play again the moment you subscribe. Scans stay open on one tune."
    nonisolated public static let ok = "OK"

    nonisolated public static func firstRecordingBody(endsAt: String) -> String {
        "Your Premium trial ends \(endsAt). After that, every recording stays and exports, but it won't play in the app until you subscribe."
    }

    nonisolated public static func trialReminderTitle(endsAt: String) -> String {
        "Your trial ends \(endsAt)"
    }
}
