import SwiftUI

/// A tune's status as an SF symbol shape.
public struct StatusGlyph: View {
    private let status: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(_ status: String) {
        self.status = status
    }

    public var body: some View {
        let label = StatusStyle.label(status)

        Image(systemName: Self.symbol(for: status))
            .font(PageStyle.body)
            .foregroundStyle(StatusGlyphStyle(status: status))
            .help(label)
            .accessibilityLabel(label)
            .contentTransition(
                reduceMotion ? .identity : .symbolEffect(.replace)
            )
            // A content transition plays only inside an animated change.
            .animation(reduceMotion ? nil : .default, value: StatusStyle.normalized(status))
    }

    /// The SF symbol name for a status.
    public static func symbol(for status: String) -> String {
        switch StatusStyle.normalized(status) {
        case "known":
            "checkmark.circle.fill"
        case "learning":
            "circle.lefthalf.filled"
        default:
            "circle"
        }
    }
}

/// How a status glyph draws: its status color, darkened for the ring where it sits on a fill,
/// and white on an emphasized accent selection, where green, orange, and the ring's gray each
/// fall under 3:1. The check, the half fill, and the ring still carry the status.
struct StatusGlyphStyle: ShapeStyle {
    let status: String

    enum Ink: Equatable {
        case white
        case status(Color)
        case ring(UnknownRing.Placement)
    }

    func resolve(in environment: EnvironmentValues) -> Color {
        switch Self.ink(status, in: environment) {
        case .white: Palette.color(.onAccentFill)
        case .status(let color): color
        case .ring(let placement): BrandStyle.color(hex: UnknownRing.hex(placement, scheme: environment.colorScheme))
        }
    }

    static func ink(_ status: String, in environment: EnvironmentValues) -> Ink {
        if environment.backgroundProminence == .increased { return .white }
        switch StatusStyle.dot(status) {
        case .filled(let color): return .status(color)
        case .ring: return .ring(UnknownRing.placement(in: environment))
        }
    }
}
