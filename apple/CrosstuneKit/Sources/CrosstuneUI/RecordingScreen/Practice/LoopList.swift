import CrosstuneStore
import SwiftUI

/// The recording's loops as list rows: tap one to select it and frame it, tap the selected one
/// to name it, swipe or use its menu to delete it with an undo, and New loop to make a four
/// second loop at the playhead. Rows for a `List`.
struct LoopList: View {
    let model: PracticeModel

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.spacing) private var spacing

    var body: some View {
        Section {
            ForEach(model.loops, id: \.id) { row in
                if model.renaming == row.id {
                    LoopNameField(model: model, row: row)
                } else {
                    loopRow(row)
                }
            }
            if model.showsCreate {
                Button {
                    model.newLoop()
                } label: {
                    Label(PracticeText.newLoop, systemImage: "plus")
                        .frame(minHeight: 44)
                        .contentShape(.rect)
                }
                .disabled(!model.create.allowed || !model.isLoaded)
                .help(model.create.reason ?? PracticeText.newLoop)
                .listRowSeparator(.hidden)
            }
        } header: {
            Text(PracticeText.loops)
        }
    }

    private func loopRow(_ row: RecordingLoop) -> some View {
        let selected = row.id == model.selectedID
        let name = model.name(row)
        let trimStart = model.trimStartMs
        return Button {
            model.choose(row.id)
        } label: {
            HStack(spacing: spacing(12)) {
                Circle()
                    .fill(LoopColor.color(row.color, scheme: colorScheme))
                    .frame(width: 12, height: 12)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: spacing.rowLineGap) {
                    Text(name)
                        .lineLimit(1)
                    HStack(spacing: spacing(8)) {
                        Text(PracticeText.range(startMs: row.startMs - trimStart, endMs: row.endMs - trimStart))
                        Text(RecordingText.duration(milliseconds: row.endMs - row.startMs) ?? "")
                        if selected && model.isRepeating {
                            Text(PracticeText.repeatingTag).foregroundStyle(.tint)
                        }
                    }
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .listRowBackground(Rectangle().fill(selected ? AnyShapeStyle(.tint.opacity(0.12)) : AnyShapeStyle(.clear)))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityAction(named: PracticeText.rename) { model.beginRename(row.id) }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(PracticeText.delete, systemImage: "trash", role: .destructive) { model.delete(row.id) }
        }
        .contextMenu {
            Button(PracticeText.rename, systemImage: "pencil") { model.beginRename(row.id) }
            Button(PracticeText.delete, systemImage: "trash", role: .destructive) { model.delete(row.id) }
        }
    }
}

/// A loop's name being edited in place, with the tune's parts offered as chips. Return or a chip
/// saves; leaving the field saves what it holds; Escape closes it unsaved.
private struct LoopNameField: View {
    let model: PracticeModel
    let row: RecordingLoop

    @State private var text: String
    @FocusState private var focused: Bool
    @Environment(\.spacing) private var spacing

    init(model: PracticeModel, row: RecordingLoop) {
        self.model = model
        self.row = row
        _text = State(initialValue: row.label ?? "")
    }

    var body: some View {
        let suggestions = model.suggestions(for: row.id)
        VStack(alignment: .leading, spacing: spacing.stackGap) {
            TextField(PracticeText.loopName, text: $text)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.done)
                .focused($focused)
                .onSubmit { model.commitRename(text) }
                .onKeyPress(.escape) {
                    model.cancelRename()
                    return .handled
                }
                .onChange(of: text) { _, value in
                    let capped = LoopModel.cappedLabel(value)
                    if capped != value { text = capped }
                }
            if !suggestions.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: spacing.railGap) {
                        ForEach(suggestions, id: \.self) { label in
                            ChoiceCapsule(chosen: false) {
                                model.commitRename(label)
                            } label: {
                                Text(label)
                            }
                            // A press keeps the field's focus, so its text is not saved first.
                            .focusable(false)
                        }
                    }
                }
                .scrollIndicators(.hidden)
                .accessibilityLabel(PracticeText.suggestions)
            }
        }
        .onAppear { focused = true }
        .onChange(of: focused) { _, isFocused in
            // Leaving the field saves it, unless a chip or Escape closes it first.
            if !isFocused, model.renaming == row.id { model.renameLostFocus(text) }
        }
    }
}
