import CrosstuneStore
import SwiftUI

/// A loop's name tab at the top of its stretch of the waveform. The selected loop's tab is a
/// button that opens its name field in place; any other loop's tab only names it, so a tap on
/// it reaches the waveform and selects the loop.
struct LoopNameTab: View {
    let model: PracticeModel
    let loop: PlacedLoop
    let isSelected: Bool
    /// The widest the tab may grow before it truncates.
    let maxWidth: CGFloat

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let name = model.row(loop.id).map(model.name) ?? ""
        if model.renaming == loop.id {
            LoopNameField(model: model, id: loop.id, color: LoopColor.color(loop.color, scheme: colorScheme))
        } else if isSelected {
            Button {
                model.beginRename(loop.id)
            } label: {
                face(name)
                    .frame(minHeight: 44, alignment: .top)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(name)
            .accessibilityHint(PracticeText.rename)
        } else {
            face(name)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private func face(_ name: String) -> some View {
        Text(name)
            .font(.footnote.weight(.semibold))
            .lineLimit(1)
            .truncationMode(.tail)
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                LoopColor.color(loop.color, scheme: colorScheme),
                in: UnevenRoundedRectangle(bottomLeadingRadius: 5, bottomTrailingRadius: 5)
            )
            .frame(maxWidth: maxWidth, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A loop's name being edited in its tab. Return saves; leaving the field, or touching the
/// waveform, saves what it holds, unless a suggestion chip or Escape closes it first. It opens
/// on the stored label, empty for an unnamed loop.
struct LoopNameField: View {
    let model: PracticeModel
    let id: String
    let color: Color

    @State private var text: String
    @FocusState private var focused: Bool

    private static let width: CGFloat = 180

    init(model: PracticeModel, id: String, color: Color) {
        self.model = model
        self.id = id
        self.color = color
        _text = State(initialValue: model.renameText(id))
    }

    var body: some View {
        TextField(PracticeText.loopName, text: $text)
            .textFieldStyle(.plain)
            .font(.footnote)
            .padding(.horizontal, 8)
            .frame(width: Self.width, height: 32)
            .background(.background, in: UnevenRoundedRectangle(bottomLeadingRadius: 5, bottomTrailingRadius: 5))
            .overlay {
                UnevenRoundedRectangle(bottomLeadingRadius: 5, bottomTrailingRadius: 5).strokeBorder(color)
            }
            .submitLabel(.done)
            .focused($focused)
            .onSubmit { model.commitRename(text, for: id) }
            .onKeyPress(.escape) {
                model.cancelRename()
                return .handled
            }
            .onChange(of: text, initial: true) { _, value in
                let capped = LoopModel.cappedLabel(value)
                if capped != value { text = capped }
                model.renameTyped(capped)
            }
            .onAppear { focused = true }
            .onChange(of: focused) { _, isFocused in
                if !isFocused, model.renaming == id { model.renameLostFocus(text) }
            }
    }
}

/// The tune's parts as names for the loop being renamed. A chip writes its name once and
/// closes the field. With no loop being renamed, or no parts to suggest, the row keeps its
/// height with nothing showing.
struct LoopSuggestions: View {
    let model: PracticeModel
    /// The loop being renamed, if any.
    let id: String?

    @Environment(\.spacing) private var spacing

    var body: some View {
        let suggestions = id.map(model.suggestions(for:)) ?? []
        if let id, !suggestions.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: spacing.railGap) {
                    ForEach(suggestions, id: \.self) { label in
                        ChoiceCapsule(chosen: false) {
                            model.commitRename(label, for: id)
                        } label: {
                            Text(label)
                        }
                        // A press keeps the field's focus, so its text is not saved first.
                        .focusable(false)
                    }
                }
            }
            .scrollIndicators(.never)
            .accessibilityLabel(PracticeText.suggestions)
        } else {
            ChoiceCapsule(chosen: false) {
            } label: {
                Text(PracticeText.suggestions)
            }
            .reserved(shown: false)
        }
    }
}
