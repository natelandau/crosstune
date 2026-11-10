import SwiftUI

/// A list row's own buttons. A line of text inside a row that acts on its own, as a row's tune
/// line, takes `.rowLine`, a borderless button, never the system's default style, which in a
/// `List` makes the whole row fire every button in it. `.rowHighlight(radius:)` is a row that
/// opens something: `field` behind it in a rounded rectangle while pressed; an iPad's pointer
/// takes the system highlight. `.pickRow` is a row that picks a value, its label alone on iPhone
/// and iPad; `.formPickRow` is one in a grouped form, in the form's accent words. Every whole row
/// draws the Mac's row style; a row line is a control inside a row and stays borderless there.
package struct RowButtonStyle: PrimitiveButtonStyle {
    package enum Kind: Equatable {
        case line
        case highlight(radius: CGFloat)
        case pick
        case formPick
    }

    package let kind: Kind

    package init(_ kind: Kind) {
        self.kind = kind
    }

    @ViewBuilder package func makeBody(configuration: Configuration) -> some View {
        let button = Button(configuration)
        switch kind {
        case .line: button.buttonStyle(.borderless)
        #if os(macOS)
            // The label holds its own insets, so it lines up with the read-only rows.
            case .highlight: button.buttonStyle(MacRowStyle(padsLabel: false))
        #else
            case .highlight(let radius): button.buttonStyle(RowHighlightAppearance(radius: radius))
        #endif
        case .pick:
            #if os(macOS)
                button.buttonStyle(.macRow)
            #else
                button.buttonStyle(.plain)
            #endif
        case .formPick:
            #if os(macOS)
                button.buttonStyle(.macRow)
            #else
                button.buttonStyle(.accentWords)
            #endif
        }
    }
}

extension PrimitiveButtonStyle where Self == RowButtonStyle {
    /// A borderless press, for a line of text inside a row that acts on its own.
    package static var rowLine: Self { RowButtonStyle(.line) }
    /// The `field` tint while pressed in corners of `radius`, and the Mac's row style.
    package static func rowHighlight(radius: CGFloat) -> Self { RowButtonStyle(.highlight(radius: radius)) }
    /// A row that picks a value: its label alone, and the Mac's row style.
    package static var pickRow: Self { RowButtonStyle(.pick) }
    /// A grouped form's row that picks a value: the form's accent words, and the Mac's row style.
    package static var formPickRow: Self { RowButtonStyle(.formPick) }
}

extension View {
    /// Gives a menu the row line's borderless press. A menu ignores `.rowLine`, a primitive style,
    /// and in a list row the system's default would make the row fire the menu.
    package func rowLineMenuAppearance() -> some View {
        buttonStyle(.borderless)
    }
}

#if !os(macOS)
    private struct RowHighlightAppearance: ButtonStyle {
        let radius: CGFloat

        func makeBody(configuration: Configuration) -> some View {
            RowHighlightBody(configuration: configuration, radius: radius)
        }
    }

    private struct RowHighlightBody: View {
        let configuration: ButtonStyleConfiguration
        let radius: CGFloat

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: radius)
            configuration.label
                .background(configuration.isPressed ? Palette.field : .clear, in: shape)
                .libraryHover(shape)
                .contentShape(shape)
        }
    }
#endif

#Preview("Row buttons") {
    VStack(spacing: 0) {
        Button {
        } label: {
            Text("Opens an editor").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).padding(.horizontal)
        }
        .buttonStyle(.rowHighlight(radius: 8))
        Button("A tune line") {}.buttonStyle(.rowLine)
    }
    .padding()
}
