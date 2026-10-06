import SwiftUI

/// How the iPhone and iPad move a change: fully, as a cross-fade under Reduce Motion, or not at
/// all on the Mac, which allows only a few signature moments.
enum PhoneMotion: Equatable {
    case none
    case crossFade
    case full

    static func resolve(reduceMotion: Bool, animatesPhoneMotion: Bool = PageStyle.animatesPhoneMotion) -> Self {
        if !animatesPhoneMotion { return .none }
        return reduceMotion ? .crossFade : .full
    }

    /// `full` under full motion, a short ease-in-out under Reduce Motion, or `reduced` when a
    /// cross-fade would still move something.
    func animation(_ full: Animation, reduced: Animation? = .easeInOut(duration: 0.2)) -> Animation? {
        switch self {
        case .none: nil
        case .crossFade: reduced
        case .full: full
        }
    }

    /// `slide` under full motion, a fade under Reduce Motion, nothing on the Mac.
    func transition(_ slide: AnyTransition) -> AnyTransition {
        switch self {
        case .none: .identity
        case .crossFade: .opacity
        case .full: slide
        }
    }

    /// A count rolls its digits under full motion, up as `value` grows and down as it falls,
    /// and fades otherwise.
    func countTransition(value: Double) -> ContentTransition {
        self == .full ? .numericText(value: value) : .opacity
    }
}

extension View {
    /// Animates changes of `value` as the platform and Reduce Motion allow. Pass `reduced: nil`
    /// when the change is a movement that a cross-fade cannot stand in for.
    func phoneAnimation<Value: Equatable>(
        _ animation: Animation = .default, reduced: Animation? = .easeInOut(duration: 0.2), value: Value
    ) -> some View {
        modifier(PhoneAnimation(animation: animation, reduced: reduced, value: value))
    }

    /// Gives a view that arrives or leaves a transition as the platform and Reduce Motion allow.
    func phoneTransition(_ slide: AnyTransition) -> some View {
        modifier(PhoneTransition(slide: slide))
    }
}

private struct PhoneAnimation<Value: Equatable>: ViewModifier {
    let animation: Animation
    let reduced: Animation?
    let value: Value

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.animation(
            PhoneMotion.resolve(reduceMotion: reduceMotion).animation(animation, reduced: reduced), value: value)
    }
}

private struct PhoneTransition: ViewModifier {
    let slide: AnyTransition

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.transition(PhoneMotion.resolve(reduceMotion: reduceMotion).transition(slide))
    }
}
