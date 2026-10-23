import SwiftUI

/// The fill of a capsule or pill with no color of its own. Off the Mac it follows its container,
/// as the web's controls do: `field` on a ground, `raised` on a surface card, and on the practice
/// ground a translucent gray that reads on jet. The Mac draws `field`, and its own chips on a card.
struct NeutralFill: ShapeStyle {
    /// Where a neutral fill sits.
    enum Container: Equatable {
        case ground, card, practice
    }

    func resolve(in environment: EnvironmentValues) -> Color {
        let container = Self.container(
            practice: environment.practiceGround != nil, onPaperCard: environment.onPaperCard)
        if let token = Self.token(container, scheme: environment.colorScheme) { return Palette.color(token) }
        return Self.practiceGray
    }

    static func container(practice: Bool, onPaperCard: Bool) -> Container {
        #if os(macOS)
            return .ground
        #else
            if practice { return .practice }
            return onPaperCard ? .card : .ground
        #endif
    }

    /// The palette fill for `container`, or nil on the practice ground. A grouped form's card is
    /// the ground in light mode and the surface in dark mode, so a chip on it takes the fill that
    /// stands off that layer.
    static func token(_ container: Container, scheme: ColorScheme) -> Palette.Token? {
        switch container {
        case .ground: .field
        case .card: scheme == .dark ? .raised : .field
        case .practice: nil
        }
    }

    /// The system's tertiary fill, heavier than its own so it shows on the dark jet ground.
    static let practiceGray = Color(.sRGB, red: 118 / 255, green: 118 / 255, blue: 128 / 255, opacity: 0.44)
}

extension ShapeStyle where Self == NeutralFill {
    static var neutralFill: NeutralFill { NeutralFill() }
}

extension EnvironmentValues {
    /// Whether this view sits on a grouped form's card, which ``PaperForm`` sets.
    @Entry var onPaperCard = false
}
