import CoreGraphics
import Foundation

/// The arithmetic of a relative scrub: where a drag puts the position, how slowly it moves
/// while the finger is below the track, and how the time left is written.
package enum ScrubDrag {
    /// How far below the track the finger must be before the scrub slows to half speed.
    package static let halfSpeedDistance: CGFloat = 40
    /// How far below the track the finger must be before the scrub slows to quarter speed.
    package static let quarterSpeedDistance: CGFloat = 100

    /// The share of the finger's travel that moves the position, given how far below the
    /// track the finger is.
    package static func rate(verticalDistance: CGFloat) -> Double {
        if verticalDistance < halfSpeedDistance { return 1 }
        if verticalDistance <= quarterSpeedDistance { return 0.5 }
        return 0.25
    }

    /// The position after a drag of `dx` across a track `width` wide, counted from `start` so a
    /// touch alone never moves it, and held inside the recording.
    package static func position(
        from start: Double, dx: CGFloat, dy: CGFloat, width: CGFloat, duration: Double
    ) -> Double {
        guard width > 0 else { return start }
        let traveled = Double(dx / width) * duration * rate(verticalDistance: max(0, dy))
        return min(max(start + traveled, 0), duration)
    }

    /// One drag in progress. Each move adds only the finger's new travel at the current rate, so
    /// sliding down to a slower rate never re-scales travel already made.
    package struct Tracker {
        /// The position the drag has reached.
        package private(set) var position: Double
        private var lastDx: CGFloat = 0

        package init(start: Double) { position = start }

        @discardableResult
        package mutating func move(dx: CGFloat, dy: CGFloat, width: CGFloat, duration: Double) -> Double {
            position = ScrubDrag.position(
                from: position, dx: dx - lastDx, dy: dy, width: width, duration: duration)
            lastDx = dx
            return position
        }
    }

    /// `position` moved `step` seconds, held inside the recording.
    package static func stepped(_ position: Double, by step: Double, duration: Double) -> Double {
        min(max(0, position + step), duration)
    }

    /// Where an arrow key or a VoiceOver adjust moves `position`: `step` seconds, held inside the
    /// recording, or nil while its length is unknown, so a step never seeks to the start.
    package static func keyStepped(_ position: Double, by step: Double, duration: Double) -> Double? {
        duration > 0 ? stepped(position, by: step, duration: duration) : nil
    }

    /// A position as `m:ss`, or `h:mm:ss` past an hour.
    package static func clockText(_ seconds: Double) -> String {
        let total = Int(max(0, seconds.isFinite ? seconds : 0))
        let (hours, rest) = total.quotientAndRemainder(dividingBy: 3600)
        let (minutes, secs) = rest.quotientAndRemainder(dividingBy: 60)
        let tail = "\(secs < 10 ? "0" : "")\(secs)"
        guard hours > 0 else { return "\(minutes):\(tail)" }
        return "\(hours):\(minutes < 10 ? "0" : "")\(minutes):\(tail)"
    }

    /// The time left behind a true minus sign, rounded up so it reaches zero only at the end.
    package static func remainingText(_ elapsed: Double, duration: Double) -> String {
        "\u{2212}" + clockText(max(0, duration - elapsed).rounded(.up))
    }
}
