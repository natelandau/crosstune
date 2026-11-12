import CrosstuneAnalytics
import CrosstuneDesign
import CrosstuneStore
import CrosstuneVocabulary
import SwiftUI

/// A field the tune form can open focused on.
public enum TuneFormFocus: Hashable, Sendable {
    case lyrics
}

/// The tune the form edits, and the field it opens focused on, if any.
public struct TuneFormTarget: Hashable, Identifiable, Sendable {
    public let tuneID: String
    public let userTuneID: String
    public let focus: TuneFormFocus?

    public var id: Self { self }

    public static func edit(tuneID: String, userTuneID: String, focus: TuneFormFocus? = nil) -> Self {
        Self(tuneID: tuneID, userTuneID: userTuneID, focus: focus)
    }
}

/// The tune form, as a sheet over the screen that opened it. It edits one tune.
/// Fields run from the most touched to the rarest: title, status, key, tunings, notes, lyrics, then the details.
///
/// Reads the store from the environment.
public struct TuneFormSheet: View {
    public static let title = "Edit tune"
    public static let cancel = "Cancel"
    public static let save = "Save"

    private let target: TuneFormTarget
    private let onSaved: (_ tuneID: String) -> Void

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @State private var model: TuneFormModel?

    /// - Parameter onSaved: Runs once a save lands, with the saved tune's id.
    public init(target: TuneFormTarget, onSaved: @escaping (_ tuneID: String) -> Void) {
        self.target = target
        self.onSaved = onSaved
    }

    public var body: some View {
        #if os(macOS)
            Group {
                if let model {
                    TuneFormContent(model: model, onSaved: onSaved)
                } else {
                    // Loading is silence.
                    Color.clear.macSheetFrame(.longForm)
                }
            }
            .task { await loadModel() }
            .shellSheet()
        #else
            NavigationStack {
                Group {
                    if let model {
                        TuneFormContent(model: model, onSaved: onSaved)
                    } else {
                        // Loading is silence.
                        Color.clear
                            .navigationTitle(Self.title)
                    }
                }
                .navigationBarTitleDisplayMode(.inline)
            }
            .task { await loadModel() }
            .shellSheet()
        #endif
    }

    private func loadModel() async {
        guard model == nil, let store else { return }
        let model = TuneFormModel(store: store, target: target, analytics: analytics)
        await model.load()
        self.model = model
    }
}

private struct TuneFormContent: View {
    @Bindable var model: TuneFormModel
    let onSaved: (_ tuneID: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var titleFocused: Bool
    @FocusState private var lyricsFocused: Bool
    @FocusState private var alternateTitlesFocused: Bool
    @FocusState private var composerFocused: Bool
    @FocusState private var genreFocused: Bool
    @FocusState private var tuneTypeFocused: Bool
    @FocusState private var partStructureFocused: Bool
    @FocusState private var learnedFromFocused: Bool

    var body: some View {
        #if os(macOS)
            MacSheet(
                title: TuneFormSheet.title, size: .longForm,
                cancel: .cancel(TuneFormSheet.cancel, isEnabled: !model.isSaving) { dismiss() },
                primary: model.phase == .ready
                    ? .init(TuneFormSheet.save, isEnabled: model.canSave, action: save)
                    : nil,
                openingFocus: .firstField
            ) {
                phaseContent
            }
            // Typed work leaves only through Cancel, and nothing leaves while its save is running.
            .interactiveDismissDisabled(model.isEdited || model.isSaving)
        #else
            phoneBody
        #endif
    }

    private var phaseContent: some View {
        Group {
            switch model.phase {
            case .loading:
                Color.clear
            case .gone:
                ContentUnavailableView(TuneScreen.gone, systemImage: "music.note")
            case .failed:
                ContentUnavailableView(CatalogModel.actionFailed, systemImage: "exclamationmark.triangle")
            case .ready:
                form
            }
        }
    }

    #if os(macOS)
        private var form: some View {
            MacFormScroll {
                if let failure = model.failure {
                    FailureText(failure)
                }
                titleField
                MacFormSection(TuneFieldLabels.status, card: false) {
                    StatusPicker(status: $model.values.status)
                }
                MacFormSection(TuneFieldLabels.key, card: false) {
                    KeyChooser(key: $model.values.key)
                }
                if !model.tuningInstruments.isEmpty {
                    MacFormSection(TuneFieldLabels.tuning) {
                        TuningRows(instruments: model.tuningInstruments, values: $model.values)
                    }
                }
                MacFormSection(TuneFieldLabels.notes, card: false) {
                    MacTextArea(
                        TuneFieldLabels.notes, text: $model.values.notes,
                        placeholder: TuneFieldLabels.notesPlaceholder, minLines: 3, maxLines: 10
                    )
                    .contentMask()
                    .characterLimit(Vocabulary.Limits.Tune.notes, text: $model.values.notes)
                }
                MacFormSection(TuneFieldLabels.lyrics, card: false) {
                    MacTextArea(
                        TuneFieldLabels.lyrics, text: $model.values.lyrics,
                        placeholder: TuneFieldLabels.lyricsPlaceholder, minLines: 6, maxLines: 16
                    )
                    .contentMask()
                    .characterLimit(Vocabulary.Limits.Tune.lyrics, text: $model.values.lyrics)
                    .focused($lyricsFocused)
                }
                MacFormSection(TuneFieldLabels.details, subtitle: TuneFieldLabels.detailsFooter) {
                    detailRows
                }
            }
            .onAppear { lyricsFocused = model.target.focus == .lyrics }
        }

        /// The tune's title as the form's large heading: no label, since the prompt and the size
        /// name it.
        private var titleField: some View {
            VStack(alignment: .leading, spacing: 6) {
                TextField(TuneFieldLabels.title, text: titleBinding, prompt: Text(TuneFieldLabels.title))
                    .contentMask()
                    .textEntry(.name)
                    .labelsHidden()
                    .textFieldStyle(.macTitleField)
                    .foregroundStyle(Palette.textPrimary)
                    .characterLimit(Vocabulary.Limits.Tune.title, text: $model.values.title)
                    .focused($titleFocused)
                    .onSubmit(save)
                if let validation = model.validation {
                    FailureText(validation)
                }
            }
        }
    #endif

    private var titleBinding: Binding<String> {
        Binding {
            model.values.title
        } set: {
            model.setTitle($0)
        }
    }

    #if os(iOS)
        private var phoneBody: some View {
            phaseContent
                .navigationTitle(TuneFormSheet.title)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(TuneFormSheet.cancel) { dismiss() }
                            .disabled(model.isSaving)
                    }
                    if model.phase == .ready {
                        ConfirmToolbarItem {
                            AsyncButton(closesOnSuccess: true, action: store) {
                                Text(TuneFormSheet.save)
                            }
                            .disabled(!model.hasTitle)
                        }
                    }
                }
                // Typed work leaves only through Cancel, and nothing leaves while its save is running.
                .interactiveDismissDisabled(model.isEdited || model.isSaving)
        }

        private var form: some View {
            GroupedForm {
                if let failure = model.failure {
                    Section {
                        Text(failure)
                            .foregroundStyle(Palette.danger)
                    }
                }
                titleSection
                Section(TuneFieldLabels.status) {
                    StatusPicker(status: $model.values.status)
                }
                Section(TuneFieldLabels.key) {
                    KeyChooser(key: $model.values.key)
                        .chipRowInsets()
                        .listRowBackground(Color.clear)
                }
                if !model.tuningInstruments.isEmpty {
                    Section(TuneFieldLabels.tuning) {
                        TuningRows(instruments: model.tuningInstruments, values: $model.values)
                    }
                }
                Section(TuneFieldLabels.notes) {
                    TextField(
                        TuneFieldLabels.notes, text: $model.values.notes,
                        prompt: Text(TuneFieldLabels.notesPlaceholder), axis: .vertical
                    )
                    .contentMask()
                    .textEntry(.prose)
                    .lineLimit(3...)
                    .characterLimit(Vocabulary.Limits.Tune.notes, text: $model.values.notes)
                }
                Section(TuneFieldLabels.lyrics) {
                    TextField(
                        TuneFieldLabels.lyrics, text: $model.values.lyrics,
                        prompt: Text(TuneFieldLabels.lyricsPlaceholder), axis: .vertical
                    )
                    .contentMask()
                    .textEntry(.prose)
                    .lineLimit(6...)
                    .characterLimit(Vocabulary.Limits.Tune.lyrics, text: $model.values.lyrics)
                    .focused($lyricsFocused)
                }
                detailsSection
            }
            .onAppear { lyricsFocused = model.target.focus == .lyrics }
        }

        private var titleSection: some View {
            Section {
                TextField(TuneFieldLabels.title, text: titleBinding, prompt: Text(TuneFieldLabels.title))
                    .contentMask()
                    .textEntry(.name)
                    .characterLimit(Vocabulary.Limits.Tune.title, text: $model.values.title)
                    .focused($titleFocused)
                    .submitLabel(.done)
                    .onSubmit(save)
            } footer: {
                if let validation = model.validation {
                    Text(validation)
                        .foregroundStyle(Palette.danger)
                }
            }
        }

        private var detailsSection: some View {
            Section {
                detailRows
            } header: {
                Text(TuneFieldLabels.details)
            } footer: {
                Text(TuneFieldLabels.detailsFooter)
            }
        }
    #endif

    @ViewBuilder private var detailRows: some View {
        LabeledContent(TuneFieldLabels.alternateTitles) {
            TextField(
                TuneFieldLabels.alternateTitles, text: $model.values.alternateTitles,
                prompt: Text(TuneFieldLabels.notSet)
            )
            .contentMask()
            .textEntry(.name)
            #if os(macOS)
                .labelsHidden()
                .textFieldStyle(.macField)
            #else
                .multilineTextAlignment(.trailing)
            #endif
            .focused($alternateTitlesFocused)
            .returnFocuses($composerFocused)
        }
        SuggestionField(
            TuneFieldLabels.composer, value: $model.values.composer, suggestions: model.composerOptions,
            maxLength: Vocabulary.Limits.Tune.composer, focus: $composerFocused
        )
        .returnFocuses($genreFocused)
        ModeRows(values: $model.values)
        SuggestionField(
            TuneFieldLabels.genre, value: $model.values.genre, suggestions: Vocabulary.genres,
            maxLength: Vocabulary.Limits.Tune.genre, focus: $genreFocused
        )
        .returnFocuses($tuneTypeFocused)
        SuggestionField(
            TuneFieldLabels.tuneType,
            value: Binding {
                model.values.tuneType
            } set: {
                model.setType($0)
            },
            suggestions: model.typeOptions, maxLength: Vocabulary.Limits.Tune.tuneType, focus: $tuneTypeFocused
        )
        .returnFocuses($partStructureFocused)
        SuggestionPicker(
            TuneFieldLabels.timeSignature,
            value: Binding {
                model.values.timeSignature
            } set: {
                model.setTimeSignature($0)
            },
            options: Vocabulary.timeSignatures, reportsRepicks: true)
        SuggestionField(
            TuneFieldLabels.partStructure, value: $model.values.partStructure,
            suggestions: Vocabulary.partStructures, maxLength: Vocabulary.Limits.Tune.partStructure,
            focus: $partStructureFocused
        )
        .returnFocuses($learnedFromFocused)
        Toggle(isOn: $model.values.isCrooked) {
            Text(TuneFieldLabels.isCrooked)
            Text(TuneFieldLabels.crookedHelp)
        }
        SuggestionField(
            TuneFieldLabels.learnedFrom, value: $model.values.learnedFrom, suggestions: model.learnedFromOptions,
            maxLength: Vocabulary.Limits.Tune.learnedFrom, focus: $learnedFromFocused
        )
        .submitLabel(.done)
        LearnedOnRow(day: $model.values.learnedOn)
    }

    private func save() {
        Task { await store() }
    }

    /// Saves and closes, or keeps the form with the reason shown.
    private func store() async {
        guard let tuneID = await model.save() else {
            if model.validation != nil { titleFocused = true }
            return
        }
        onSaved(tuneID)
        dismiss()
    }
}
