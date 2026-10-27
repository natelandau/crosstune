import CrosstuneDesign
import SwiftUI

/// The key filter's choices as the colored pills the catalog's keys wear, since a menu draws
/// its images in one color. Any clears the filter; the question mark is the tunes with no key,
/// offered while the catalog holds some.
struct KeyFilterPopover: View {
    let choices: [String]
    let selected: String?
    let onChoose: (String?) -> Void

    /// The key filter after picking `key`: picking the chosen key again clears it, as an
    /// optional field does.
    nonisolated static func choice(picking key: String, selected: String?) -> String? {
        key == selected ? nil : key
    }

    /// A popover takes its content's ideal size, which for a flow layout is one long line,
    /// so a fixed width makes the pills wrap.
    private static let width: CGFloat = 280

    var body: some View {
        // Scrolls only when the pills outgrow the room the popover has, as at the largest text
        // sizes.
        ViewThatFits(in: .vertical) {
            grid
            ScrollView { grid }
        }
        .frame(width: Self.width, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(CatalogFacet.key.label)
    }

    #if os(macOS)
        private static let padding: CGFloat = 12
        private static let gap: CGFloat = 8
    #else
        private static let padding: CGFloat = 14
        private static let gap: CGFloat = 6
    #endif

    private var grid: some View {
        VStack(alignment: .leading, spacing: 10) {
            #if !os(macOS)
                Text(CatalogFacet.key.label)
                    .font(PageStyle.secondary.weight(.semibold))
                    .foregroundStyle(.textSecondary)
                    .accessibilityAddTraits(.isHeader)
            #endif
            FlowLayout(spacing: Self.gap, lineSpacing: 8) {
                ChoiceCapsule(chosen: selected == nil) {
                    onChoose(nil)
                } label: {
                    Text(CatalogFilterSheet.any)
                }
                ForEach(choices, id: \.self) { key in
                    let chosen = selected == key
                    keyChoice(key, chosen: chosen)
                        .accessibilityLabel(CatalogFacet.key.valueLabel(key))
                        .help(CatalogFacet.key.valueLabel(key))
                }
            }
        }
        .padding(Self.padding)
        .frame(width: Self.width, alignment: .leading)
    }

    @ViewBuilder private func keyChoice(_ key: String, chosen: Bool) -> some View {
        let action = { onChoose(Self.choice(picking: key, selected: selected)) }
        if key == CatalogFilters.noKey {
            #if os(macOS)
                ChoiceCapsule(chosen: chosen, action: action) { Text("?") }
            #else
                Button(action: action) { ChoiceCapsuleLabel(text: "?", chosen: chosen) }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(chosen ? .isSelected : [])
            #endif
        } else {
            KeyChipButton(key: key, chosen: chosen, action: action)
        }
    }
}
