import SwiftUI

/// A form row whose value opens a menu of choices that act when picked, even the one already
/// shown, which a system picker skips: the label leading, the value and an up-down chevron
/// trailing in the secondary color. Each item is a `Toggle`, so the menu checks the current
/// choice. `label` is the row's full name for VoiceOver, and `rowLabel` the shorter one it shows
/// under a header that already names half of it. On the Mac it draws the Mac pull-down.
package struct MenuRow<Items: View>: View {
    private let label: String
    private let rowLabel: String
    private let value: String
    private let items: Items

    package init(_ label: String, rowLabel: String? = nil, value: String, @ViewBuilder items: () -> Items) {
        self.label = label
        self.rowLabel = rowLabel ?? label
        self.value = value
        self.items = items()
    }

    package var body: some View {
        #if os(macOS)
            MacPullDown(rowLabel, value: value) { items }
        #else
            LabeledContent {
                Menu {
                    items
                } label: {
                    HStack(spacing: 4) {
                        Text(value)
                            .contentMask()
                        Image(systemName: "chevron.up.chevron.down")
                            .imageScale(.small)
                            .accessibilityHidden(true)
                    }
                    .foregroundStyle(Palette.textSecondary)
                }
            } label: {
                Text(rowLabel)
            }
            .accessibilityLabel(label)
        #endif
    }
}

#Preview("Menu row") {
    @Previewable @State var meter = "4/4"
    Form {
        MenuRow("Time signature", value: meter) {
            ForEach(["2/4", "3/4", "4/4", "6/8"], id: \.self) { choice in
                Toggle(
                    choice,
                    isOn: Binding {
                        meter == choice
                    } set: { _ in
                        meter = choice
                    })
            }
        }
    }
}
