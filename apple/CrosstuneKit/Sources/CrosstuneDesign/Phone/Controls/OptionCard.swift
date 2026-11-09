import SwiftUI

/// One of two or three offers that each need two lines: a 12pt card on the grouped surface,
/// ringed in the accent when chosen, with the pointer's highlight in the card's shape.
package struct OptionCard<Content: View>: View {
    private let isChosen: Bool
    private let action: () -> Void
    private let content: Content

    package init(isChosen: Bool, action: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.isChosen = isChosen
        self.action = action
        self.content = content()
    }

    package var body: some View {
        Button(action: action) { content }
            .buttonStyle(OptionCardStyle(isChosen: isChosen))
            .accessibilityAddTraits(isChosen ? .isSelected : [])
    }
}

private struct OptionCardStyle: ButtonStyle {
    let isChosen: Bool

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: ControlMetrics.containerRadius)
        configuration.label
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Palette.groupedSurface, in: shape)
            .overlay {
                shape.strokeBorder(isChosen ? Palette.accent : Palette.border, lineWidth: isChosen ? 2 : 1)
            }
            .pressDim(configuration.isPressed)
            .phoneAnimation(Motion.state, value: isChosen)
            .libraryHover(shape)
            .contentShape(shape)
    }
}

#Preview("Option cards") {
    HStack {
        OptionCard(isChosen: true, action: {}) { Text("Yearly\nSave 17%") }
        OptionCard(isChosen: false, action: {}) { Text("Monthly\n$4") }
    }
    .padding()
}
