import CrosstuneVocabulary
import SwiftUI

/// The key as a grid of pills, in the colors every other screen shows a key in. Key is closed:
/// nothing is typed here, and More keys opens the spellings the grid leaves out, both of each
/// black key among them.
///
/// A value the grid does not hold, picked from that menu or written by another client, joins the
/// grid as its own pill, so a key is never hidden and never silently dropped. The field is
/// optional: pressing the chosen key clears it.
struct KeyChooser: View {
    nonisolated static let moreKeys = "More keys…"
    nonisolated static let unknownKey = "Unknown key"

    @Binding var key: String
    /// True over tunes whose keys disagree, where no choice is shown as made.
    var isMixed = false

    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .subheadline) private var height: CGFloat = 32

    /// The pills on the grid: the quick keys, then a chosen key they lack.
    nonisolated static func shown(chosen: String) -> [String] {
        chosen.isEmpty || Vocabulary.quickKeys.contains(chosen) ? Vocabulary.quickKeys : Vocabulary.quickKeys + [chosen]
    }

    /// Every key the grid does not show, in order.
    nonisolated static func more(chosen: String) -> [String] {
        let shown = shown(chosen: chosen)
        return Vocabulary.allKeys.filter { !shown.contains($0) }
    }

    /// The key after pressing `pressed`: the chosen key clears, any other is chosen.
    nonisolated static func pressing(_ pressed: String, chosen: String) -> String {
        pressed == chosen ? "" : pressed
    }

    var body: some View {
        let chosen = key.trimmingCharacters(in: .whitespacesAndNewlines)
        FlowLayout(spacing: 6, lineSpacing: 2) {
            // A question mark is the shorthand a musician already writes on a tune list. It reads
            // as nothing aloud, so the choice is named in words.
            ChoiceCapsule(chosen: chosen.isEmpty && !isMixed) {
                key = ""
            } label: {
                Text("?")
            }
            .accessibilityLabel(Self.unknownKey)
            ForEach(Self.shown(chosen: chosen), id: \.self) { pill in
                Button {
                    key = Self.pressing(pill, chosen: chosen)
                } label: {
                    KeyPill(pill, chosen: pill == chosen)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(pill)
                .accessibilityAddTraits(pill == chosen ? .isSelected : [])
            }
            Menu {
                ForEach(Self.more(chosen: chosen), id: \.self) { more in
                    Button(more) { key = more }
                }
            } label: {
                Text(Self.moreKeys)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 14)
                    .frame(minHeight: height)
                    .background(neutralFill(colorScheme), in: .capsule)
                    .frame(minHeight: 44)
                    .contentShape(.rect)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(TuneFieldLabels.key)
        .accessibilityValue(isMixed ? BulkEditForm.mixed : "")
    }
}

#Preview("Key chooser") {
    @Previewable @State var key = "F#"
    KeyChooser(key: $key)
        .padding()
}
