import CrosstuneAnalytics
import Foundation
import StoreKit
import SwiftUI

/// Decides when to ask for an App Store review. It asks once per device, ever, and only after
/// the musician has, on this device, added a tune, saved or imported a recording, and practiced,
/// opened the app at least ``opensNeeded`` times, and had it for ``daysNeeded`` days. Work synced
/// from another device does not count. It becomes due only at one of those milestones, so the
/// request follows something that went well.
///
/// Kept in `UserDefaults` rather than the synced store: the rule is about this device, and it
/// outlasts sign-out.
@MainActor
@Observable
public final class ReviewPrompt {
    static let opensNeeded = 10
    static let daysNeeded = 7

    enum Key {
        static let firstOpened = "review.firstOpened"
        static let opens = "review.opens"
        static let addedTune = "review.addedTune"
        static let madeRecording = "review.madeRecording"
        static let practiced = "review.practiced"
        static let asked = "review.asked"
    }

    /// Whether the shell should ask at its next clear moment.
    public private(set) var isDue = false

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let now: () -> Date
    /// True until the app first comes forward and again once it goes to the background, so a
    /// brief inactive spell (Control Center, a system alert) is not counted as an open.
    @ObservationIgnored private var isAway = true

    public init(defaults: UserDefaults = .standard, now: @escaping () -> Date = { .now }) {
        self.defaults = defaults
        self.now = now
    }

    /// Counts the app coming to the foreground from the background or a launch. The first one
    /// starts the week.
    public func opened() {
        guard isAway else { return }
        isAway = false
        if defaults.object(forKey: Key.firstOpened) == nil { defaults.set(now(), forKey: Key.firstOpened) }
        defaults.set(defaults.integer(forKey: Key.opens) + 1, forKey: Key.opens)
    }

    /// Notes the app going to the background. A milestone reported on the way out is kept but
    /// does not make the prompt due, so the request never greets the next open.
    public func leftForeground() {
        isAway = true
    }

    /// Records the milestone `event` marks, if any, and becomes due when the rule is met.
    public func note(_ event: AnalyticsEvent) {
        guard let key = Self.milestone(event) else { return }
        defaults.set(true, forKey: key)
        if !isAway, isEligible { isDue = true }
    }

    /// An analytics observer that hands this prompt only the events that mark a milestone, so
    /// the rest never hop to the main actor.
    public nonisolated var observer: @Sendable (AnalyticsEvent) -> Void {
        { [self] event in
            guard Self.milestone(event) != nil else { return }
            Task { @MainActor in self.note(event) }
        }
    }

    /// Marks the request made, so this device is never asked again.
    func asked() {
        defaults.set(true, forKey: Key.asked)
        isDue = false
    }

    private var isEligible: Bool {
        guard !defaults.bool(forKey: Key.asked),
            defaults.bool(forKey: Key.addedTune), defaults.bool(forKey: Key.madeRecording),
            defaults.bool(forKey: Key.practiced),
            defaults.integer(forKey: Key.opens) >= Self.opensNeeded,
            let first = defaults.object(forKey: Key.firstOpened) as? Date,
            let ready = Calendar.current.date(byAdding: .day, value: Self.daysNeeded, to: first)
        else { return false }
        return now() >= ready
    }

    private nonisolated static func milestone(_ event: AnalyticsEvent) -> String? {
        switch event {
        case .tuneCreated: Key.addedTune
        case .importCompleted(_, let added, _, _) where added > 0: Key.addedTune
        case .recordingSaved, .audioImported: Key.madeRecording
        case .practiceEnded: Key.practiced
        default: nil
        }
    }
}

extension EnvironmentValues {
    /// The app's review prompt. The app sets it at the root of each scene; nil asks for nothing.
    @Entry public var reviewPrompt: ReviewPrompt?
}

extension View {
    /// Asks for a review once the prompt is due and `isClear` says nothing covers the window.
    func requestsReview(isClear: Bool) -> some View {
        modifier(ReviewRequest(isClear: isClear))
    }
}

private struct ReviewRequest: ViewModifier {
    let isClear: Bool

    @Environment(\.reviewPrompt) private var prompt
    @Environment(\.requestReview) private var requestReview

    func body(content: Content) -> some View {
        content
            .onChange(of: isClear && prompt?.isDue == true, initial: true) { _, ready in
                // Another window may have asked first in this same update.
                guard ready, let prompt, prompt.isDue else { return }
                prompt.asked()
                requestReview()
            }
    }
}
