import SwiftUI

/// The mark a pick row draws: an accent check for a single pick, or an accent fill circle with
/// a check for one of several, an empty ring when off. Drawing only; the row owns the tap. The
/// Mac draws nothing, since a Mac pick row marks its choice itself.
package struct SelectionMark: View {
    package enum Style: Equatable {
        case single(isChosen: Bool)
        case multiple(isOn: Bool)
    }

    package static let size: CGFloat = 24

    private let style: Style

    @ScaledMetric(relativeTo: .body) private var side = Self.size

    package init(_ style: Style) {
        self.style = style
    }

    package var body: some View {
        #if !os(macOS)
            mark
        #endif
    }

    private var mark: some View {
        ZStack {
            switch style {
            case .single(let isChosen):
                if isChosen {
                    Image(systemName: "checkmark")
                        .font(.system(size: side * 0.7, weight: .semibold))
                        .foregroundStyle(Palette.accent)
                        .transition(.opacity)
                }
            case .multiple(let isOn):
                if isOn {
                    Circle().fill(Palette.accentFill)
                    Image(systemName: "checkmark")
                        .font(.system(size: side * 0.5, weight: .bold))
                        .foregroundStyle(Palette.onAccentFill)
                } else {
                    Circle().strokeBorder(Palette.textTertiary, lineWidth: 1.5)
                }
            }
        }
        .frame(width: side, height: side)
        .phoneAnimation(Motion.state, value: style)
        .accessibilityHidden(true)
    }
}

#Preview("Selection marks") {
    HStack(spacing: 16) {
        SelectionMark(.single(isChosen: true))
        SelectionMark(.multiple(isOn: true))
        SelectionMark(.multiple(isOn: false))
    }
    .padding()
}
