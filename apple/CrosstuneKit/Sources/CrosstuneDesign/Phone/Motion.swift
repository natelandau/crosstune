import SwiftUI

/// The animations and timings every iPhone control shares.
package enum Motion {
    package static let press: Animation = .linear(duration: 0.1)
    package static let state: Animation = .snappy(duration: 0.2)
    package static let springCurve = Spring(duration: 0.3, bounce: 0.3)
    package static let spring: Animation = .spring(springCurve)
    package static let reducedFade: Animation = .easeInOut(duration: 0.2)
    package static let workingDelay: Duration = .milliseconds(300)
    package static let doneHold: Duration = .seconds(1)
    package static let repeatDelay: Duration = .milliseconds(500)
    package static let repeatInterval: Duration = .milliseconds(100)
    package static let tabSlide: CGFloat = 12
    /// How long a status ring takes to draw itself closed.
    package static let drawDuration: Duration = .milliseconds(350)
    /// A status ring drawing itself closed, at an even pace.
    package static let draw: Animation = .linear(duration: drawDuration.seconds)

    /// A failed button's sideways shake: the offsets it visits in turn, ending at rest, spread
    /// evenly over `shakeDuration`.
    package static let shakeOffsets: [CGFloat] = [-4, 4, -3, 2, 0]
    package static let shakeDuration: Duration = .milliseconds(250)

    /// A fade over `duration`, for a mark whose timing its caller sets, such as a row's highlight.
    package static func fade(over duration: Duration) -> Animation {
        .easeInOut(duration: duration.seconds)
    }
}

extension Duration {
    /// The duration in seconds, as an animation or a `TimeInterval` takes it.
    package var seconds: Double {
        Double(components.seconds) + Double(components.attoseconds) / 1e18
    }
}

extension View {
    /// The library's press: dims to `opacity` while pressed, over `Motion.press`.
    package func pressDim(_ isPressed: Bool, to opacity: Double = ControlMetrics.pressedOpacity) -> some View {
        self.opacity(isPressed ? opacity : 1).animation(Motion.press, value: isPressed)
    }

    /// Shakes sideways each time `failures` changes. Reduce Motion leaves the view still.
    package func failureShake(_ failures: Int) -> some View {
        modifier(FailureShake(failures: failures))
    }

    /// Shrinks to `scale` the moment a press starts and springs back on release. Reduce Motion
    /// leaves the view still.
    package func pressScale(_ isPressed: Bool, to scale: CGFloat) -> some View {
        modifier(PressScale(isPressed: isPressed, scale: scale))
    }
}

private struct PressScale: ViewModifier {
    let isPressed: Bool
    let scale: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .scaleEffect(isPressed && !reduceMotion ? scale : 1)
            .animation(isPressed ? nil : Motion.spring, value: isPressed)
    }
}

private struct FailureShake: ViewModifier {
    let failures: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let offsets = reduceMotion ? [] : Motion.shakeOffsets
        let step = Motion.shakeDuration.seconds / Double(max(offsets.count, 1))
        content.keyframeAnimator(initialValue: CGFloat.zero, trigger: failures) { view, offset in
            view.offset(x: offset)
        } keyframes: { _ in
            KeyframeTrack {
                for offset in offsets { CubicKeyframe(offset, duration: step) }
            }
        }
    }
}
