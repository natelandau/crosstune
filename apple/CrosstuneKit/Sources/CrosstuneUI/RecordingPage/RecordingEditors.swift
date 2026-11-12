import CrosstuneAnalytics
import CrosstuneDesign
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import SwiftUI

/// The words a recording's row editors show.
public enum RecordingEditorText {
    public static let nameLabel = "Recording name"
    public static let placeholder = "Jam at Tom’s, take 2, …"
    public static let year = "Year"
    public static let month = "Month"
    public static let day = "Day"
    public static let any = "Any"
    public static let clearDate = "Clear date"
    public static let notesPlaceholder = "Tuning, who it came from, what to work on…"

    /// `Recorded at <time>`: the exact time of a recording, which its date parts cannot show.
    public static func recordedAtNote(
        _ at: Timestamp, locale: Locale = .current, timeZone: TimeZone = .current
    ) -> String {
        "Recorded at \(at.date.formatted(Date.FormatStyle(time: .shortened, locale: locale, timeZone: timeZone)))"
    }
}

/// What each of a recording's row editors opens on, read from the recording as stored.
enum RecordingEdit {
    static func name(_ recording: Recording) -> AttributeEditSession<String> { .text(recording.label ?? "") }
    static func players(_ recording: Recording) -> AttributeEditSession<String> { .text(recording.players ?? "") }
    static func notes(_ recording: Recording) -> AttributeEditSession<String> { .text(recording.notes ?? "") }
    /// The tune the recording is filed under, nil for none.
    static func tune(_ rows: ScreenRows) -> AttributeEditSession<String?> { AttributeEditSession(stored: rows.tuneID) }

    /// `timeZone` reads a recording's day.
    static func recorded(_ recording: Recording, timeZone: TimeZone = .current)
        -> AttributeEditSession<RecordingDateDraft>
    {
        AttributeEditSession(stored: RecordingDateDraft(recording: recording, timeZone: timeZone))
    }
}

extension View {
    /// Edits one of a recording's fields from its row, saving through `model`: a popover or a
    /// part-height sheet as the tune page's rows do, and for Location the location editor as a
    /// sheet. Added has no editor.
    ///
    /// - Parameters:
    ///   - rows: The recording as stored now, which each opening starts from.
    ///   - onGoToTune: Opens the recording's tune; nil, as for an unfiled recording, leaves Go to
    ///     tune out of the Tune editor.
    func recordingEditor(
        for id: RecordingAttributeID, rows: ScreenRows, isPresented: Binding<Bool>, label: String,
        model: RecordingAttributeModel, onGoToTune: (() -> Void)?
    ) -> some View {
        modifier(
            RecordingEditing(
                id: id, rows: rows, isPresented: isPresented, label: label, model: model, onGoToTune: onGoToTune))
    }
}

private struct RecordingEditing: ViewModifier {
    let id: RecordingAttributeID
    let rows: ScreenRows
    @Binding var isPresented: Bool
    let label: String
    let model: RecordingAttributeModel
    let onGoToTune: (() -> Void)?

    @ViewBuilder func body(content: Content) -> some View {
        let recording = rows.recording
        switch id {
        case .name:
            editing(
                content, RecordingEdit.name(recording), commit: { await $0.rename($1) },
                body: { controls in RecordingNameEditor(controls: controls) })
        case .tune:
            editing(
                content, RecordingEdit.tune(rows), commit: { await $0.file($1) },
                body: { controls in
                    RecordingTuneEditor(
                        controls: controls, onGoToTune: onGoToTune,
                        onCreate: { title in Task { await model.fileUnderNewTune(title) } })
                })
        case .players:
            editing(
                content, RecordingEdit.players(recording), commit: { await $0.setPlayers($1) },
                body: { controls in
                    SuggestionEditor(
                        label: RecordingPageCopy.players, maxLength: Vocabulary.Limits.Recording.players,
                        controls: controls,
                        suggestions: .read { db in RecordingSuggestions.players(try Recording.fetchAll(db)) })
                })
        case .recorded:
            editing(
                content, RecordingEdit.recorded(recording),
                commit: { await $0.setRecorded(year: $1.year, month: $1.month, day: $1.day) },
                body: { controls in RecordingDateEditor(controls: controls) })
        case .notes:
            editing(
                content, RecordingEdit.notes(recording), commit: { await $0.setNotes($1) },
                body: { controls in RecordingNotesEditor(controls: controls) })
        case .location:
            content
                .sheet(isPresented: $isPresented) {
                    LocationEditor(recordingID: recording.id, onFailure: model.report)
                }
        }
    }

    private func editing<Value: Equatable & Sendable, Body: View>(
        _ content: Content, _ session: AttributeEditSession<Value>,
        commit: @escaping @MainActor (RecordingAttributeModel, Value) async -> Void,
        @ViewBuilder body: @escaping (AttributeEditorControls<Value>) -> Body
    ) -> some View {
        let model = model
        return content.attributeEditor(
            isPresented: $isPresented, label: label, session: session,
            onCommit: { value in Task { await commit(model, value) } },
            content: { controls in AttributeEditorStack { body(controls) } })
    }
}

private struct RecordingNameEditor: View {
    let controls: AttributeEditorControls<String>

    var body: some View {
        TextField(RecordingEditorText.nameLabel, text: controls.draft, prompt: Text(RecordingEditorText.placeholder))
            .contentMask()
            #if os(macOS)
                // The editor's title names the field, so it draws only its value.
                .labelsHidden()
                .textFieldStyle(.macField)
            #endif
            .characterLimit(Vocabulary.Limits.Recording.label, text: controls.draft)
            .focused(controls.firstField)
            .submitLabel(.done)
            .onSubmit { controls.done() }
    }
}

private struct RecordingNotesEditor: View {
    let controls: AttributeEditorControls<String>

    var body: some View {
        #if os(macOS)
            MacTextArea(
                RecordingPageCopy.notes, text: controls.draft, placeholder: RecordingEditorText.notesPlaceholder,
                minLines: 3, maxLines: 8
            )
            .characterLimit(Vocabulary.Limits.Recording.notes, text: controls.draft)
            .focused(controls.firstField)
        #else
            TextField(
                RecordingPageCopy.notes, text: controls.draft, prompt: Text(RecordingEditorText.notesPlaceholder),
                axis: .vertical
            )
            .contentMask()
            .characterLimit(Vocabulary.Limits.Recording.notes, text: controls.draft)
            .lineLimit(3...8)
            .focused(controls.firstField)
        #endif
    }
}

/// The recorded date as a year, narrowed by an optional month and day. Enter on a date that
/// cannot be stored says why and stays open.
struct RecordingDateEditor: View {
    let controls: AttributeEditorControls<RecordingDateDraft>

    @Environment(\.locale) private var locale
    @State private var refused: String?

    private static let months = Array(1...12)

    /// Why Enter cannot save `draft`, or nil when it can be stored as it stands.
    nonisolated static func refusal(_ draft: RecordingDateDraft, now: Timestamp = .now) -> String? {
        do {
            _ = try draft.resolved(now: now)
            return nil
        } catch {
            return error.message
        }
    }

    var body: some View {
        let draft = controls.draft.wrappedValue
        VStack(alignment: .leading, spacing: 8) {
            yearField
            monthPicker(draft)
            dayPicker(draft)
            Button(RecordingEditorText.clearDate) { controls.draft.wrappedValue.clear() }
                .buttonStyle(.text)
                .disabled(draft.isEmpty)
            if let refused {
                Text(refused)
                    .font(.platform(.footnote))
                    .foregroundStyle(Palette.danger)
            } else if let time = draft.keptTime {
                Text(RecordingEditorText.recordedAtNote(time))
                    .font(.platform(.footnote))
                    .foregroundStyle(.textSecondary)
            }
        }
        .onSubmit {
            refused = Self.refusal(controls.draft.wrappedValue)
            if refused == nil { controls.done() }
        }
        // An edit takes back the refusal, which said why the date before it could not be saved.
        .onChange(of: draft) { refused = nil }
    }

    /// Takes a typed year and takes back the refusal, even when the draft filters every typed
    /// character out and so does not change.
    nonisolated static func type(_ typed: String, into draft: inout RecordingDateDraft, refused: inout String?) {
        draft.year = typed
        refused = nil
    }

    /// A month's name in the editor's locale. The draft holds Gregorian month numbers, so the
    /// names come from that calendar whatever calendar the device uses.
    private func monthName(_ month: Int) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = locale
        return calendar.standaloneMonthSymbols[month - 1]
    }

    private var yearField: some View {
        let year = Binding {
            controls.draft.wrappedValue.year
        } set: { typed in
            Self.type(typed, into: &controls.draft.wrappedValue, refused: &refused)
        }
        return LabeledContent(RecordingEditorText.year) {
            TextField(RecordingEditorText.year, text: year, prompt: Text(TuneFieldLabels.notSet))
                .contentMask()
                #if os(macOS)
                    .labelsHidden()
                    .textFieldStyle(.macField)
                    // Four digits, so the year reads as one value with the month and day.
                    .frame(width: 80)
                #else
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.numberPad)
                #endif
                .focused(controls.firstField)
                .submitLabel(.done)
        }
    }

    @ViewBuilder private func monthPicker(_ draft: RecordingDateDraft) -> some View {
        let month = controls.draft.month
        #if os(macOS)
            MacPopUp(
                RecordingEditorText.month, selection: month, choices: Self.months,
                label: { $0.map(monthName) ?? RecordingEditorText.any }
            )
            .disabled(!draft.isMonthEnabled)
        #else
            Picker(RecordingEditorText.month, selection: month) {
                Text(RecordingEditorText.any).tag(Int?.none)
                ForEach(Self.months, id: \.self) { choice in
                    Text(monthName(choice)).tag(Int?.some(choice))
                }
            }
            .disabled(!draft.isMonthEnabled)
        #endif
    }

    @ViewBuilder private func dayPicker(_ draft: RecordingDateDraft) -> some View {
        let day = controls.draft.day
        let days = Array(stride(from: 1, through: draft.dayCount, by: 1))
        #if os(macOS)
            MacPopUp(
                RecordingEditorText.day, selection: day, choices: days,
                label: { $0.map(String.init) ?? RecordingEditorText.any }
            )
            .disabled(!draft.isDayEnabled)
        #else
            Picker(RecordingEditorText.day, selection: day) {
                Text(RecordingEditorText.any).tag(Int?.none)
                // Kept while Day is disabled, so a chosen day still shows its value.
                ForEach(days, id: \.self) { choice in
                    Text(String(choice)).tag(Int?.some(choice))
                }
            }
            .disabled(!draft.isDayEnabled)
        #endif
    }
}

/// The Location group's map of the spot, with the saved location's address under it. A press
/// opens the location editor, as the row above it does.
struct RecordingLocationMap: View {
    let point: Coordinate
    let address: String?
    let onOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LocationMap(coordinate: point, accuracyM: point.accuracyM)
                .clipShape(.rect(cornerRadius: PageStyle.attributeRowRadius))
                .overlay {
                    // The row above names the location and opens the same editor for VoiceOver.
                    Button(action: onOpen) { Color.clear.contentShape(.rect) }
                        .buttonStyle(.labelOnly)
                        .accessibilityHidden(true)
                }
            if let address {
                Text(address)
                    .contentMask()
                    .font(PageStyle.secondary)
                    .foregroundStyle(.textSecondary)
            }
        }
    }
}
