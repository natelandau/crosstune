import SwiftUI

/// A list row's own buttons. A line of text inside a row that acts on its own, as a row's tune
/// line, takes `.rowLine`, a borderless button, never the system's default style, which in a
/// `List` makes the whole row fire every button in it. `.rowHighlight(radius:)` is a row that
/// opens something: `field` behind it in a rounded rectangle while pressed, and under the pointer
/// on the Mac; an iPad's pointer takes the system highlight. `.pickRow` is a row that picks a
/// value, its label alone on iPhone and iPad; `.formPickRow` is one in a grouped form, in the
/// form's accent words. Both draw the Mac's pick row.
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
        case .highlight(let radius): button.buttonStyle(RowHighlightAppearance(radius: radius))
        case .pick:
            #if os(macOS)
                button.buttonStyle(.macPickRow)
            #else
                button.buttonStyle(.plain)
            #endif
        case .formPick:
            #if os(macOS)
                button.buttonStyle(.macPickRow)
            #else
                button.buttonStyle(.accentWords)
            #endif
        }
    }
}

extension PrimitiveButtonStyle where Self == RowButtonStyle {
    /// A borderless press, for a line of text inside a row that acts on its own.
    package static var rowLine: Self { RowButtonStyle(.line) }
    /// The `field` tint while pressed, and under the Mac's pointer, in corners of `radius`.
    package static func rowHighlight(radius: CGFloat) -> Self { RowButtonStyle(.highlight(radius: radius)) }
    /// A row that picks a value: its label alone, and the Mac's pick row.
    package static var pickRow: Self { RowButtonStyle(.pick) }
    /// A grouped form's row that picks a value: the form's accent words, and the Mac's pick row.
    package static var formPickRow: Self { RowButtonStyle(.formPick) }
}

extension View {
    /// Gives a menu the row line's borderless press. A menu ignores `.rowLine`, a primitive style,
    /// and in a list row the system's default would make the row fire the menu.
    package func rowLineMenuAppearance() -> some View {
        buttonStyle(.borderless)
    }
}

private struct RowHighlightAppearance: ButtonStyle {
    let radius: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        RowHighlightBody(configuration: configuration, radius: radius)
    }
}

private struct RowHighlightBody: View {
    let configuration: ButtonStyleConfiguration
    let radius: CGFloat

    @State private var isHovered = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius)
        configuration.label
            .background(isHovered || configuration.isPressed ? Palette.field : .clear, in: shape)
            #if os(macOS)
                .contentShape(shape)
                .onHover { isHovered = $0 }
            #else
                .libraryHover(shape)
                .contentShape(shape)
            #endif
    }
}

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
