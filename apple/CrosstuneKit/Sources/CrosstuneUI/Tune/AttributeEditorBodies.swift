import CrosstuneStore
import CrosstuneVocabulary
import GRDB
import SwiftUI

/// What a choice in an editor's body does to the open editor.
enum AttributeChoice<Value: Equatable & Sendable>: Equatable, Sendable {
    /// Held as the draft, saved when the editor closes.
    case draft(Value)
    /// Saved now, with the editor left open for the rest of the attribute.
    case stay(Value)
    /// Saved now, and the editor closes.
    case close(Value)
}

/// One attribute's in-place edit: the value its editor opens on and the write a saved value makes.
struct AttributeEdit<Value: Equatable & Sendable> {
    let session: AttributeEditSession<Value>
    let patch: @Sendable (Value) -> AttributePatch

    private static func values(_ detail: TuneDetail) -> TuneFormValues {
        TuneFormValues(tune: detail.tune, userTune: detail.userTune)
    }
}

extension AttributeEdit where Value == String {
    private static func text(
        _ detail: TuneDetail, _ field: WritableKeyPath<TuneFormValues, String> & Sendable
    ) -> Self {
        Self(session: .text(values(detail)[keyPath: field])) { value in { $0[keyPath: field] = value } }
    }

    static func status(_ detail: TuneDetail) -> Self { text(detail, \.status) }
    static func timeSignature(_ detail: TuneDetail) -> Self { text(detail, \.timeSignature) }
    static func partStructure(_ detail: TuneDetail) -> Self { text(detail, \.partStructure) }
    static func genre(_ detail: TuneDetail) -> Self { text(detail, \.genre) }
    static func composer(_ detail: TuneDetail) -> Self { text(detail, \.composer) }
    static func alternateTitles(_ detail: TuneDetail) -> Self { text(detail, \.alternateTitles) }
    static func learnedFrom(_ detail: TuneDetail) -> Self { text(detail, \.learnedFrom) }
    static func learnedOn(_ detail: TuneDetail) -> Self { text(detail, \.learnedOn) }
    /// The write fills a time signature the tune lacks, under the form's type rule.
    static func tuneType(_ detail: TuneDetail) -> Self { text(detail, \.tuneType) }
}

extension AttributeEdit where Value == KeyModes {
    /// Every write carries the key and the modes both, so two quick picks never undo each other.
    static func key(_ detail: TuneDetail) -> Self {
        Self(session: AttributeEditSession(stored: KeyModes(values(detail)), normalize: \.saved)) { keyModes in
            {
                $0.key = keyModes.key
                $0.modes = keyModes.modes
            }
        }
    }
}

extension AttributeEdit where Value == TuningValues {
    static func tuning(_ instrument: String, _ detail: TuneDetail) -> Self {
        Self(session: AttributeEditSession(stored: values(detail).tuning(instrument))) { entry in
            { $0.tunings[instrument] = entry }
        }
    }

    /// What picking a tuning does: saves it and stays open for the capo on an instrument that
    /// takes one, as the key's editor stays open for the modes; elsewhere saves and closes.
    static func choosing(
        _ tuning: String, instrument: String, in draft: TuningValues
    ) -> AttributeChoice<TuningValues> {
        var next = draft
        next.tuning = tuning
        return TuningRows.takesCapo(instrument) ? .stay(next) : .close(next)
    }
}

extension AttributeEdit where Value == Bool {
    static func crooked(_ detail: TuneDetail) -> Self {
        Self(session: AttributeEditSession(stored: detail.tune.isCrooked)) { isCrooked in { $0.isCrooked = isCrooked } }
    }
}

/// The key's editor value: the key and one mode per part, as the form's rows hold them.
struct KeyModes: Equatable, Sendable {
    var key: String
    var modes: [String]

    init(key: String, modes: [String]) {
        self.key = key
        self.modes = modes
    }

    init(_ values: TuneFormValues) {
        self.init(key: values.key, modes: values.modes)
    }

    /// As a save writes it: an empty mode row is only a part waiting for its mode.
    var saved: KeyModes {
        KeyModes(key: key.trimmingCharacters(in: .whitespacesAndNewlines), modes: modes.filter { !$0.isEmpty })
    }

    /// Values for the form's mode rows, which read only the modes.
    var rows: TuneFormValues {
        var values = TuneFormValues()
        values.key = key
        values.modes = modes
        return values
    }

    /// A key press saves at once and leaves the editor open for the modes.
    static func choosing(key: String, in draft: KeyModes) -> AttributeChoice<KeyModes> {
        choosing(KeyModes(key: key, modes: draft.modes), in: draft)
    }

    /// A mode saves at once; a row added for the next part waits for its mode.
    static func choosing(modes: [String], in draft: KeyModes) -> AttributeChoice<KeyModes> {
        choosing(KeyModes(key: draft.key, modes: modes), in: draft)
    }

    private static func choosing(_ next: KeyModes, in draft: KeyModes) -> AttributeChoice<KeyModes> {
        next.saved == draft.saved ? .draft(next) : .stay(next)
    }
}

extension View {
    /// Edits one of the tune's attributes in place with that attribute's editor, saving through `write`.
    ///
    /// - Parameters:
    ///   - label: The attribute's label: the sheet's title and the popover's accessible name.
    ///   - write: Applies a saved value. Bind it to the tune the editor opened for, so a save
    ///     that lands as the page swaps tunes still lands on that one.
    func attributeEditor(
        for id: AttributeID, detail: TuneDetail, isPresented: Binding<Bool>,
        anchor: PopoverAttachmentAnchor = .rect(.bounds),
        label: String, write: @escaping @MainActor (@escaping AttributePatch) -> Void
    ) -> some View {
        modifier(
            AttributeEditing(
                id: id, detail: detail, isPresented: isPresented, anchor: anchor, label: label, write: write))
    }
}

private struct AttributeEditing: ViewModifier {
    let id: AttributeID
    let detail: TuneDetail
    @Binding var isPresented: Bool
    let anchor: PopoverAttachmentAnchor
    let label: String
    let write: @MainActor (@escaping AttributePatch) -> Void

    @ViewBuilder func body(content: Content) -> some View {
        switch id {
        case .status:
            editing(content, .status(detail)) { controls in StatusEditor(controls: controls) }
        case .key:
            editing(content, .key(detail)) { controls in KeyEditor(controls: controls) }
        case .tuning(let instrument):
            editing(content, .tuning(instrument, detail)) { controls in
                TuningEditor(instrument: instrument, controls: controls)
            }
        case .tuneType:
            editing(content, .tuneType(detail)) { controls in
                SuggestionEditor(
                    label: TuneFieldLabels.tuneType, maxLength: Vocabulary.Limits.Tune.tuneType, controls: controls,
                    suggestions: .catalog { [genre = detail.tune.genre ?? ""] in
                        TuneSuggestions.types(genre: genre, tunes: $0.tunes)
                    })
            }
        case .timeSignature:
            editing(content, .timeSignature(detail)) { controls in TimeSignatureEditor(controls: controls) }
        case .partStructure:
            editing(content, .partStructure(detail)) { controls in
                SuggestionEditor(
                    label: TuneFieldLabels.partStructure, maxLength: Vocabulary.Limits.Tune.partStructure,
                    controls: controls, suggestions: .fixed(Vocabulary.partStructures))
                CrookedToggle(isCrooked: detail.tune.isCrooked) { write(AttributeEdit.crooked(detail).patch($0)) }
            }
        case .isCrooked:
            editing(content, .crooked(detail)) { controls in
                CrookedToggle(isCrooked: controls.draft.wrappedValue, focus: controls.firstField) {
                    controls.save($0)
                }
            }
        case .genre:
            editing(content, .genre(detail)) { controls in
                SuggestionEditor(
                    label: TuneFieldLabels.genre, maxLength: Vocabulary.Limits.Tune.genre, controls: controls,
                    suggestions: .fixed(Vocabulary.genres))
            }
        case .composer:
            editing(content, .composer(detail)) { controls in
                SuggestionEditor(
                    label: TuneFieldLabels.composer, maxLength: Vocabulary.Limits.Tune.composer, controls: controls,
                    suggestions: .catalog { TuneSuggestions.composers($0.tunes) })
            }
        case .alternateTitles:
            editing(content, .alternateTitles(detail)) { controls in AlternateTitlesEditor(controls: controls) }
        case .learnedFrom:
            editing(content, .learnedFrom(detail)) { controls in
                SuggestionEditor(
                    label: TuneFieldLabels.learnedFrom, maxLength: Vocabulary.Limits.Tune.learnedFrom,
                    controls: controls, suggestions: .catalog { TuneSuggestions.learnedFrom($0.userTunes) })
            }
        case .learnedOn:
            editing(content, .learnedOn(detail)) { controls in LearnedOnEditor(controls: controls) }
        }
    }

    private func editing<Value: Equatable & Sendable, Body: View>(
        _ content: Content, _ edit: AttributeEdit<Value>,
        @ViewBuilder body: @escaping (AttributeEditorControls<Value>) -> Body
    ) -> some View {
        let write = write
        return content.attributeEditor(
            isPresented: $isPresented, anchor: anchor, label: label, session: edit.session,
            onCommit: { write(edit.patch($0)) },
            content: { controls in AttributeEditorStack { body(controls) } })
    }
}

/// An editor body's layout: its rows stacked, wide enough for the key grid in a popover and as
/// wide as a sheet allows.
private struct AttributeEditorStack<Content: View>: View {
    @ViewBuilder let content: Content

    @Environment(\.spacing) private var spacing

    var body: some View {
        VStack(alignment: .leading, spacing: spacing(12)) {
            content
        }
        .environment(\.rowsOutsideForm, true)
        #if os(macOS)
            .frame(width: 320, alignment: .leading)
        #else
            .frame(minWidth: 0, idealWidth: 340, maxWidth: .infinity, alignment: .leading)
        #endif
    }
}

private struct StatusEditor: View {
    let controls: AttributeEditorControls<String>

    var body: some View {
        StatusPicker(
            status: Binding {
                controls.draft.wrappedValue
            } set: {
                controls.pick($0)
            }
        )
        .focused(controls.firstField)
    }
}

extension AttributeEditorControls where Value: Sendable {
    /// Carries out what a choice in the body does to the open editor.
    func apply(_ choice: AttributeChoice<Value>) {
        switch choice {
        case .draft(let next): draft.wrappedValue = next
        case .stay(let next): save(next)
        case .close(let next): pick(next)
        }
    }
}

private struct KeyEditor: View {
    let controls: AttributeEditorControls<KeyModes>

    var body: some View {
        let draft = controls.draft
        KeyChooser(
            key: Binding {
                draft.wrappedValue.key
            } set: {
                controls.apply(KeyModes.choosing(key: $0, in: draft.wrappedValue))
            }
        )
        .focused(controls.firstField)
        ModeRows(
            values: Binding {
                draft.wrappedValue.rows
            } set: {
                controls.apply(KeyModes.choosing(modes: $0.modes, in: draft.wrappedValue))
            })
    }
}

private struct TuningEditor: View {
    let instrument: String
    let controls: AttributeEditorControls<TuningValues>

    var body: some View {
        let draft = controls.draft
        TuningRows(
            instruments: [instrument],
            values: Binding {
                var values = TuneFormValues()
                values.tunings[instrument] = draft.wrappedValue
                return values
            } set: {
                draft.wrappedValue = $0.tuning(instrument)
            },
            focus: controls.firstField,
            onPickTuning: { instrument, tuning in
                controls.apply(AttributeEdit.choosing(tuning, instrument: instrument, in: draft.wrappedValue))
            }
        )
        .onSubmit { controls.done() }
    }
}

private struct TimeSignatureEditor: View {
    let controls: AttributeEditorControls<String>

    var body: some View {
        // Picking the value already chosen still closes the editor.
        SuggestionPicker(
            TuneFieldLabels.timeSignature,
            value: Binding {
                controls.draft.wrappedValue
            } set: {
                controls.pick($0)
            },
            options: Vocabulary.timeSignatures, reportsRepicks: true
        )
        .focused(controls.firstField)
    }
}

/// The catalog's entries, joined as the form joins them, for the suggestions it offers.
private struct AttributeCatalog: Sendable {
    var entries: [CatalogEntry] = []

    var tunes: [Tune] { entries.map(\.tune) }
    var userTunes: [UserTune] { entries.map(\.userTune) }

    nonisolated static func read(_ db: Database) throws -> AttributeCatalog {
        AttributeCatalog(
            entries: CatalogSearch.entries(
                tunes: try Tune.filter(Tune.CodingKeys.deletedAt == nil).fetchAll(db),
                userTunes: try UserTune.filter(UserTune.CodingKeys.deletedAt == nil).fetchAll(db)))
    }
}

/// An open vocabulary's editor: a field with suggestions, where a pick saves and closes and
/// Enter saves what was typed.
private struct SuggestionEditor: View {
    enum Suggestions {
        case fixed([String])
        /// Drawn from the catalog, read once as the editor opens.
        case catalog((AttributeCatalog) -> [String])
    }

    let label: String
    let maxLength: Int
    let controls: AttributeEditorControls<String>
    let suggestions: Suggestions

    @Environment(\.store) private var store
    /// The catalog's suggestions, built once as the catalog arrives rather than on each
    /// keystroke's redraw.
    @State private var built: [String]?

    var body: some View {
        SuggestionField(
            label, value: controls.draft, suggestions: shown, maxLength: maxLength, focus: controls.firstField,
            onPick: { controls.pick($0) }
        )
        .onSubmit { controls.done() }
        .task {
            guard case .catalog(let build) = suggestions else { return }
            let read = (try? await store?.read(AttributeCatalog.read)) ?? AttributeCatalog()
            built = build(read)
        }
    }

    private var shown: [String] {
        switch suggestions {
        case .fixed(let list): list
        case .catalog(let build): built ?? build(AttributeCatalog())
        }
    }
}

/// The crooked switch, which saves as it flips and leaves the editor open.
private struct CrookedToggle: View {
    var focus: FocusState<Bool>.Binding?
    let onChange: (Bool) -> Void

    @State private var isOn: Bool

    init(isCrooked: Bool, focus: FocusState<Bool>.Binding? = nil, onChange: @escaping (Bool) -> Void) {
        self.focus = focus
        self.onChange = onChange
        _isOn = State(initialValue: isCrooked)
    }

    var body: some View {
        let toggle = Toggle(
            isOn: Binding {
                isOn
            } set: {
                isOn = $0
                onChange($0)
            }
        ) {
            Text(TuneFieldLabels.isCrooked)
            Text(TuneFieldLabels.crookedHelp)
        }
        if let focus {
            toggle.focused(focus)
        } else {
            toggle
        }
    }
}

private struct AlternateTitlesEditor: View {
    let controls: AttributeEditorControls<String>

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(TuneFieldLabels.alternateTitles, text: controls.draft, prompt: Text(TuneFieldLabels.notSet))
                .contentMask()
                #if os(macOS)
                    // The editor's title names the field, so it draws only its value.
                    .labelsHidden()
                    .textFieldStyle(.macField)
                #endif
                .focused(controls.firstField)
                .onSubmit { controls.done() }
            Text(TuneFieldLabels.detailsFooter)
                .font(.platform(.footnote))
                .foregroundStyle(.textSecondary)
        }
    }
}

/// The learned-on day. Enter on a date that is not whole says so and stays open.
struct LearnedOnEditor: View {
    nonisolated static let incomplete = "Enter the year, month, and day."

    let controls: AttributeEditorControls<String>

    @State private var refused: String?

    /// Why Enter cannot save `day`, or nil when it is a whole date or empty.
    nonisolated static func refusal(_ day: String) -> String? {
        day.isEmpty || CalendarDay.date(day) != nil ? nil : incomplete
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            LearnedOnRow(day: controls.draft)
                .focused(controls.firstField)
            if let refused {
                Text(refused)
                    .font(.platform(.footnote))
                    .foregroundStyle(.red)
            }
        }
        .onSubmit {
            refused = Self.refusal(controls.draft.wrappedValue)
            if refused == nil { controls.done() }
        }
        .onChange(of: controls.draft.wrappedValue) { refused = nil }
    }
}
