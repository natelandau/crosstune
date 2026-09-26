import CrosstuneVocabulary
import SwiftUI

/// The tune form's shared fields over many tunes at once. Each row shows the value every
/// selected tune shares, Not set when none holds one, or Mixed when they disagree; only a row
/// the musician touches is written, and Save stays dead until one is.
struct BulkEditSheet: View {
    let entries: [CatalogEntry]
    let bulk: BulkActions
    /// Runs once the save lands, before the sheet closes.
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var form: BulkEditForm

    init(entries: [CatalogEntry], instruments: Set<String>, bulk: BulkActions, onSaved: @escaping () -> Void) {
        self.entries = entries
        self.bulk = bulk
        self.onSaved = onSaved
        _form = State(initialValue: BulkEditForm(entries: entries, instruments: instruments))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let failure = bulk.editFailure {
                        Text(failure)
                            .foregroundStyle(.red)
                    }
                } footer: {
                    Text(BulkEditForm.footnote)
                }
                Section {
                    row(.status)
                }
                Section {
                    KeyChooser(key: text(.key), isMixed: form.isMixed(.key))
                        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                        .listRowBackground(Color.clear)
                } header: {
                    Text(TuneFieldLabels.key)
                } footer: {
                    if form.isMixed(.key) {
                        Text(BulkEditForm.mixed)
                    }
                }
                let tunings = form.fields.filter { $0.instrument != nil }
                if !tunings.isEmpty {
                    Section(TuneFieldLabels.tuning) {
                        ForEach(tunings, id: \.self) { row($0) }
                    }
                }
                Section(TuneFieldLabels.details) {
                    ForEach(details, id: \.self) { row($0) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(BulkActionText.editTitle(entries.count))
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(TuneFormSheet.cancel) { dismiss() }
                        .disabled(bulk.isPending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(TuneFormSheet.save, action: save)
                        .fontWeight(.semibold)
                        .disabled(!form.isEdited || bulk.isPending)
                }
            }
        }
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 480, minHeight: 560, idealHeight: 720)
        #endif
        // A touched row leaves only through Cancel, and nothing leaves while the save runs.
        .interactiveDismissDisabled(form.isEdited || bulk.isPending)
        .onAppear { bulk.clearEditFailure() }
        .shellSheet()
    }

    private var details: [EditField] {
        form.fields.filter { $0 != .status && $0 != .key && $0.instrument == nil }
    }

    @ViewBuilder private func row(_ field: EditField) -> some View {
        switch field {
        case .status:
            BulkChoiceRow(
                field: field, form: $form, options: Vocabulary.statuses, name: StatusStyle.label)
        case .key:
            // Never a row: the key is the pill grid in its own section above.
            EmptyView()
        case .mode:
            BulkChoiceRow(field: field, form: $form, options: Vocabulary.modes, emptyChoice: BulkEditForm.clear)
        case .tuning(let instrument):
            BulkChoiceRow(
                field: field, form: $form, options: Vocabulary.tuningSuggestions[instrument] ?? [],
                rowLabel: TuningText.instrumentLabel(instrument), emptyChoice: BulkEditForm.clear,
                allowsOther: true, maxLength: Vocabulary.Limits.Tune.tuning)
        case .genre:
            BulkChoiceRow(
                field: field, form: $form, options: Vocabulary.genres, emptyChoice: BulkEditForm.clear,
                allowsOther: true, maxLength: Vocabulary.Limits.Tune.genre)
        case .tuneType:
            BulkChoiceRow(
                field: field, form: $form, options: Vocabulary.tuneTypes, emptyChoice: BulkEditForm.clear,
                allowsOther: true, maxLength: Vocabulary.Limits.Tune.tuneType)
        case .timeSignature:
            BulkChoiceRow(
                field: field, form: $form, options: Vocabulary.timeSignatures, emptyChoice: BulkEditForm.clear)
        case .partStructure:
            BulkChoiceRow(
                field: field, form: $form, options: Vocabulary.partStructures, emptyChoice: BulkEditForm.clear,
                allowsOther: true, maxLength: Vocabulary.Limits.Tune.partStructure)
        case .isCrooked:
            BulkChoiceRow(
                field: field, form: $form, options: [BulkEditForm.yes, BulkEditForm.no],
                emptyChoice: BulkEditForm.keep)
        case .learnedFrom:
            LabeledContent(field.label) {
                TextField(field.label, text: text(field), prompt: Text(form.placeholder(field)))
                    .multilineTextAlignment(.trailing)
                    .characterLimit(Vocabulary.Limits.Tune.learnedFrom, text: text(field))
            }
        case .learnedOn:
            BulkDateRow(field: field, form: $form)
        }
    }

    /// A typed or picked text field, touched by every change.
    private func text(_ field: EditField) -> Binding<String> {
        Binding {
            form.text(field)
        } set: { typed in
            form.touch(field, typed.isEmpty ? .clear : .text(typed))
        }
    }

    private func save() {
        let patch = form.patch
        Task {
            guard await bulk.edit(entries, patch: patch) else { return }
            onSaved()
            dismiss()
        }
    }
}

/// A field picked from a menu of choices across many tunes. Its empty choice, when it has one,
/// is named for what it does: Clear empties the field on every tune, Keep changes none. Other…
/// reveals a text field that starts from the current value rather than clearing it.
private struct BulkChoiceRow: View {
    let field: EditField
    @Binding var form: BulkEditForm
    let options: [String]
    /// The row's visible label, where a section header already names half the field.
    var rowLabel: String?
    /// What a choice reads as, where the stored value is not the word shown.
    var name: (String) -> String = { $0 }
    var emptyChoice: String?
    var allowsOther = false
    var maxLength: Int?

    @State private var typing = false
    @FocusState private var otherFocused: Bool

    var body: some View {
        LabeledContent {
            Menu {
                if let emptyChoice {
                    choice(emptyChoice, isCurrent: false) {
                        form.touch(field, field.kind == .yesNo ? nil : .clear)
                        typing = false
                    }
                }
                ForEach(SuggestionPicker.choices(options, value: current), id: \.self) { option in
                    choice(name(option), isCurrent: !typing && option == current) {
                        form.touch(field, value(option))
                        typing = false
                    }
                }
                if allowsOther {
                    choice(TuneFieldLabels.other, isCurrent: typing) {
                        typing = true
                        otherFocused = true
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(form.shown(field))
                    Image(systemName: "chevron.up.chevron.down")
                        .imageScale(.small)
                        .accessibilityHidden(true)
                }
                .foregroundStyle(.secondary)
            }
            // A plain menu keeps the value secondary, as the tune form shows its values, where
            // the default style would tint it.
            .buttonStyle(.plain)
        } label: {
            Text(rowLabel ?? field.label)
        }
        .accessibilityLabel(field.label)
        if typing {
            let otherLabel = TuneFieldLabels.other(field.label)
            LabeledContent(otherLabel) {
                TextField(otherLabel, text: typed, prompt: Text(form.placeholder(field)))
                    .multilineTextAlignment(.trailing)
                    .focused($otherFocused)
                    .characterLimit(maxLength, text: typed)
            }
        }
    }

    /// The row's value as its choices name it.
    private var current: String {
        switch form.value(field) {
        case .text(let text): text
        case .flag(let flag): flag ? BulkEditForm.yes : BulkEditForm.no
        case nil: ""
        }
    }

    private func value(_ option: String) -> TouchedValue {
        field.kind == .yesNo ? .flag(option == BulkEditForm.yes) : .text(option)
    }

    private var typed: Binding<String> {
        Binding {
            form.text(field)
        } set: { text in
            form.touch(field, text.isEmpty ? .clear : .text(text))
        }
    }

    @ViewBuilder
    private func choice(_ title: String, isCurrent: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            if isCurrent {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }
}

/// The learned-on day across many tunes: the shared day in a date picker with a control that
/// clears it, or Not set or Mixed, which a press sets to today.
private struct BulkDateRow: View {
    let field: EditField
    @Binding var form: BulkEditForm

    var body: some View {
        if let date = CalendarDay.date(form.text(field)) {
            HStack {
                DatePicker(
                    field.label,
                    selection: Binding {
                        date
                    } set: {
                        form.touch(field, .text(CalendarDay.day($0)))
                    }, displayedComponents: .date)
                Button(TuneFieldLabels.clearDate, systemImage: "xmark.circle.fill") { form.touch(field, .clear) }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
            }
        } else {
            LabeledContent(field.label) {
                Button(form.placeholder(field)) { form.touch(field, .text(CalendarDay.day(.now))) }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("\(field.label), \(form.placeholder(field))")
                    .accessibilityHint(TuneFieldLabels.setsToday)
            }
        }
    }
}
