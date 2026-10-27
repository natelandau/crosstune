import CrosstuneAnalytics
import CrosstuneDesign
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
    @State private var composers: [String] = []
    @State private var learnedFrom: [String] = []

    init(entries: [CatalogEntry], instruments: Set<String>, bulk: BulkActions, onSaved: @escaping () -> Void) {
        self.entries = entries
        self.bulk = bulk
        self.onSaved = onSaved
        _form = State(initialValue: BulkEditForm(entries: entries, instruments: instruments))
    }

    var body: some View {
        #if os(macOS)
            MacSheet(
                title: BulkActionText.editTitle(entries.count), subtitle: BulkEditForm.footnote, size: .longForm,
                cancel: .cancel(TuneFormSheet.cancel, isEnabled: !bulk.isPending) { dismiss() },
                primary: .init(TuneFormSheet.save, isEnabled: form.isEdited && !bulk.isPending, action: save)
            ) {
                macForm
            }
            .modifier(BulkEditLifecycle(form: form, bulk: bulk, composers: $composers, learnedFrom: $learnedFrom))
            .shellSheet()
        #else
            phoneBody
        #endif
    }

    #if os(macOS)
        private var macForm: some View {
            MacFormScroll {
                if let failure = bulk.editFailure {
                    FailureText(failure)
                }
                MacFormSection(TuneFieldLabels.status, caption: mixedCaption(.status), card: false) {
                    BulkStatusPicker(form: $form)
                }
                MacFormSection(TuneFieldLabels.key, caption: mixedCaption(.key), card: false) {
                    KeyChooser(key: keyBinding, isMixed: form.isMixed(.key))
                }
                let tunings = form.fields.filter { $0.instrument != nil }
                if !tunings.isEmpty {
                    MacFormSection(TuneFieldLabels.tuning) {
                        ForEach(tunings, id: \.self) { row($0) }
                    }
                }
                MacFormSection(TuneFieldLabels.details) {
                    ForEach(details, id: \.self) { row($0) }
                }
            }
        }

        /// Mixed on a section's heading line, when the tunes disagree on its one field.
        private func mixedCaption(_ field: EditField) -> String? {
            form.isMixed(field) ? BulkEditForm.mixed : nil
        }
    #endif

    #if os(iOS)
        private var phoneBody: some View {
            NavigationStack {
                GroupedForm {
                    Section {
                        if let failure = bulk.editFailure {
                            Text(failure)
                                .foregroundStyle(Palette.danger)
                        }
                    } footer: {
                        Text(BulkEditForm.footnote)
                    }
                    Section {
                        BulkStatusPicker(form: $form)
                    } header: {
                        Text(TuneFieldLabels.status)
                    } footer: {
                        if form.isMixed(.status) {
                            Text(BulkEditForm.mixed)
                        }
                    }
                    Section {
                        KeyChooser(key: keyBinding, isMixed: form.isMixed(.key))
                            .chipRowInsets()
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
                .navigationTitle(BulkActionText.editTitle(entries.count))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(TuneFormSheet.cancel) { dismiss() }
                            .disabled(bulk.isPending)
                    }
                    ConfirmToolbarItem {
                        Button(TuneFormSheet.save, action: save)
                            .fontWeight(.semibold)
                            .disabled(!form.isEdited || bulk.isPending)
                    }
                }
            }
            .modifier(BulkEditLifecycle(form: form, bulk: bulk, composers: $composers, learnedFrom: $learnedFrom))
            .shellSheet()
        }
    #endif

    private var details: [EditField] {
        form.fields.filter { $0 != .status && $0 != .key && $0.instrument == nil }
    }

    @ViewBuilder private func row(_ field: EditField) -> some View {
        switch field {
        case .status, .key:
            // Never rows: `details` leaves out the status and the key, which have sections of
            // their own above.
            EmptyView()
        case .mode:
            BulkChoiceRow(field: field, form: $form, options: Vocabulary.modes, emptyChoice: BulkEditForm.clear)
        case .tuning(let instrument):
            BulkSuggestionRow(
                field: field, form: $form, suggestions: Vocabulary.tuningSuggestions[instrument] ?? [],
                rowLabel: Vocabulary.instrumentLabel(instrument), maxLength: Vocabulary.Limits.Tune.tuning)
        case .genre:
            BulkSuggestionRow(
                field: field, form: $form, suggestions: Vocabulary.genres, maxLength: Vocabulary.Limits.Tune.genre)
        case .tuneType:
            BulkSuggestionRow(
                field: field, form: $form, suggestions: Vocabulary.tuneTypes,
                maxLength: Vocabulary.Limits.Tune.tuneType)
        case .timeSignature:
            BulkChoiceRow(
                field: field, form: $form, options: Vocabulary.timeSignatures, emptyChoice: BulkEditForm.clear)
        case .partStructure:
            BulkSuggestionRow(
                field: field, form: $form, suggestions: Vocabulary.partStructures,
                maxLength: Vocabulary.Limits.Tune.partStructure)
        case .composer:
            BulkSuggestionRow(
                field: field, form: $form, suggestions: composers, maxLength: Vocabulary.Limits.Tune.composer)
        case .isCrooked:
            BulkChoiceRow(
                field: field, form: $form, options: [BulkEditForm.yes, BulkEditForm.no],
                emptyChoice: BulkEditForm.keep)
        case .learnedFrom:
            BulkSuggestionRow(
                field: field, form: $form, suggestions: learnedFrom, maxLength: Vocabulary.Limits.Tune.learnedFrom)
        case .learnedOn:
            BulkDateRow(field: field, form: $form)
        }
    }

    private var keyBinding: Binding<String> {
        Binding {
            form.text(.key)
        } set: { typed in
            form.touch(.key, typed.isEmpty ? .clear : .text(typed))
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

private struct BulkEditLifecycle: ViewModifier {
    let form: BulkEditForm
    let bulk: BulkActions
    @Binding var composers: [String]
    @Binding var learnedFrom: [String]

    func body(content: Content) -> some View {
        content
            // A touched row leaves only through Cancel, and nothing leaves while the save runs.
            .interactiveDismissDisabled(form.isEdited || bulk.isPending)
            .onAppear { bulk.clearEditFailure() }
            .task {
                let suggestions = await bulk.suggestions()
                composers = suggestions.composers
                learnedFrom = suggestions.learnedFrom
            }
    }
}

/// A field picked from a menu of choices across many tunes. Its empty choice, when it has one,
/// is named for what it does: Clear empties the field on every tune, Keep changes none.
private struct BulkChoiceRow: View {
    let field: EditField
    @Binding var form: BulkEditForm
    let options: [String]
    var emptyChoice: String?

    var body: some View {
        #if os(macOS)
            MacPullDown(field.label, value: form.shown(field)) { items }
        #else
            LabeledContent {
                Menu {
                    items
                } label: {
                    HStack(spacing: 4) {
                        Text(form.shown(field))
                        Image(systemName: "chevron.up.chevron.down")
                            .imageScale(.small)
                            .accessibilityHidden(true)
                    }
                    .foregroundStyle(.textSecondary)
                }
                // A plain menu keeps the value secondary, as the tune form shows its values, where
                // the default style would tint it.
                .buttonStyle(.plain)
            } label: {
                Text(field.label)
            }
            .accessibilityLabel(field.label)
        #endif
    }

    @ViewBuilder private var items: some View {
        if let emptyChoice {
            choice(emptyChoice, isCurrent: false) {
                form.touch(field, field.kind == .yesNo ? nil : .clear)
            }
        }
        ForEach(SuggestionPicker.choices(options, value: current), id: \.self) { option in
            choice(option, isCurrent: option == current) {
                form.touch(field, value(option))
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

    /// A toggle, so the check reads as the choice's state rather than as an icon.
    private func choice(_ title: String, isCurrent: Bool, action: @escaping () -> Void) -> some View {
        Toggle(
            title,
            isOn: Binding {
                isCurrent
            } set: { _ in
                action()
            })
    }
}

/// An open vocabulary across many tunes, typed straight in. Where the tunes disagree the field
/// is empty under a Mixed prompt until typed into, and Mixed among the suggestions puts it back.
/// Deleting the text empties the field on every tune.
private struct BulkSuggestionRow: View {
    let field: EditField
    @Binding var form: BulkEditForm
    let suggestions: [String]
    /// The row's visible label, where a section header already names half the field.
    var rowLabel: String?
    var maxLength: Int?

    var body: some View {
        SuggestionField(
            field.label, rowLabel: rowLabel, value: typed, suggestions: suggestions, maxLength: maxLength,
            keep: form.summary(field) == .mixed
                ? SuggestionField.Keep(
                    label: BulkEditForm.mixed, kept: form.isMixed(field), onKeep: { form.touch(field, nil) })
                : nil)
    }

    private var typed: Binding<String> {
        Binding {
            form.text(field)
        } set: { text in
            form.touch(field, text.isEmpty ? .clear : .text(text))
        }
    }
}

/// The learned-on day across many tunes: the shared day in a date picker with a control that
/// clears it, or Not set or Mixed, which a press sets to today.
private struct BulkDateRow: View {
    let field: EditField
    @Binding var form: BulkEditForm

    var body: some View {
        #if os(macOS)
            LabeledContent(field.label) {
                MacDateValue(
                    label: field.label, day: form.text(field), placeholder: form.placeholder(field),
                    onSet: { form.touch(field, .text($0)) }, onClear: { form.touch(field, .clear) })
            }
        #else
            phoneBody
        #endif
    }

    #if !os(macOS)
        @ViewBuilder private var phoneBody: some View {
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
                        .foregroundStyle(.textSecondary)
                }
            } else {
                LabeledContent(field.label) {
                    Button(form.placeholder(field)) { form.touch(field, .text(CalendarDay.day(.now))) }
                        .buttonStyle(.borderless)
                        .foregroundStyle(.textSecondary)
                        .accessibilityLabel("\(field.label), \(form.placeholder(field))")
                        .accessibilityHint(TuneFieldLabels.setsToday)
                }
            }
        }
    #endif
}
