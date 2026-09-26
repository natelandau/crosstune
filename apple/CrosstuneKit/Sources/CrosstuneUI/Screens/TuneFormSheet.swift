import CrosstuneStore
import CrosstuneVocabulary
import SwiftUI

/// What the tune form opens on: a new tune, perhaps with a title typed into a search and a list
/// it lands in, or an existing tune to edit.
public enum TuneFormTarget: Hashable, Identifiable, Sendable {
    case new(title: String?, listID: String? = nil)
    case edit(tuneID: String, userTuneID: String)

    public var id: Self { self }
}

/// The tune form, as a sheet over the screen that opened it. Fields run from the most touched to
/// the rarest: title, status, key, tunings, notes, then the details.
///
/// Reads the store from the environment.
public struct TuneFormSheet: View {
    public static let newTitle = "New tune"
    public static let editTitle = "Edit tune"
    public static let cancel = "Cancel"
    public static let save = "Save"
    public static let addTune = CatalogScreen.addTune

    private let target: TuneFormTarget
    private let onSaved: (_ tuneID: String) -> Void

    @Environment(\.store) private var store
    @State private var model: TuneFormModel?

    /// - Parameter onSaved: Runs once a save lands, with the saved tune's id.
    public init(target: TuneFormTarget, onSaved: @escaping (_ tuneID: String) -> Void) {
        self.target = target
        self.onSaved = onSaved
    }

    public var body: some View {
        NavigationStack {
            Group {
                if let model {
                    TuneFormContent(model: model, onSaved: onSaved)
                } else {
                    // Loading is silence.
                    Color.clear
                        .navigationTitle(Self.title(target))
                }
            }
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 480, minHeight: 560, idealHeight: 720)
        #endif
        .task {
            guard model == nil, let store else { return }
            let model = TuneFormModel(store: store, target: target)
            await model.load()
            self.model = model
        }
        .shellSheet()
    }

    static func title(_ target: TuneFormTarget) -> String {
        if case .edit = target { return editTitle }
        return newTitle
    }
}

private struct TuneFormContent: View {
    @Bindable var model: TuneFormModel
    let onSaved: (_ tuneID: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var titleFocused: Bool

    var body: some View {
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
        .navigationTitle(TuneFormSheet.title(model.target))
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(TuneFormSheet.cancel) { dismiss() }
                    .disabled(model.isSaving)
            }
            if model.phase == .ready {
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.isNew ? TuneFormSheet.addTune : TuneFormSheet.save) { save() }
                        .fontWeight(.semibold)
                        .disabled(!model.canSave)
                }
            }
        }
        // Typed work leaves only through Cancel, and nothing leaves while its save is running.
        .interactiveDismissDisabled(model.isEdited || model.isSaving)
    }

    private var form: some View {
        Form {
            if let failure = model.failure {
                Section {
                    Text(failure)
                        .foregroundStyle(.red)
                }
            }
            titleSection
            Section(TuneFieldLabels.status) {
                StatusRail(status: $model.values.status)
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    .listRowBackground(Color.clear)
            }
            Section(TuneFieldLabels.key) {
                KeyChooser(key: $model.values.key)
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
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
                .lineLimit(3...)
                .characterLimit(Vocabulary.Limits.Tune.notes, text: $model.values.notes)
            }
            detailsSection
        }
        .formStyle(.grouped)
        .onAppear {
            if model.isNew && model.values.title.isEmpty { titleFocused = true }
        }
    }

    private var titleSection: some View {
        Section {
            TextField(
                TuneFieldLabels.title,
                text: Binding {
                    model.values.title
                } set: {
                    model.setTitle($0)
                },
                prompt: Text(TuneFieldLabels.title)
            )
            .characterLimit(Vocabulary.Limits.Tune.title, text: $model.values.title)
            .focused($titleFocused)
            .submitLabel(.done)
            .onSubmit(save)
        } footer: {
            if let validation = model.validation {
                Text(validation)
                    .foregroundStyle(.red)
            }
        }
    }

    private var detailsSection: some View {
        Section {
            LabeledContent(TuneFieldLabels.alternateTitles) {
                TextField(
                    TuneFieldLabels.alternateTitles, text: $model.values.alternateTitles,
                    prompt: Text(TuneFieldLabels.notSet)
                )
                .multilineTextAlignment(.trailing)
            }
            SuggestionPicker(
                TuneFieldLabels.composer, value: $model.values.composer, options: model.composerOptions,
                allowsOther: true, maxLength: Vocabulary.Limits.Tune.composer)
            ModeRows(values: $model.values)
            SuggestionPicker(
                TuneFieldLabels.genre, value: $model.values.genre, options: Vocabulary.genres, allowsOther: true,
                maxLength: Vocabulary.Limits.Tune.genre)
            SuggestionPicker(
                TuneFieldLabels.tuneType,
                value: Binding {
                    model.values.tuneType
                } set: {
                    model.setType($0)
                },
                options: model.typeOptions, allowsOther: true, maxLength: Vocabulary.Limits.Tune.tuneType)
            SuggestionPicker(
                TuneFieldLabels.timeSignature,
                value: Binding {
                    model.values.timeSignature
                } set: {
                    model.setTimeSignature($0)
                },
                options: Vocabulary.timeSignatures, allowsOther: false, reportsRepicks: true)
            SuggestionPicker(
                TuneFieldLabels.partStructure, value: $model.values.partStructure,
                options: Vocabulary.partStructures, allowsOther: true, maxLength: Vocabulary.Limits.Tune.partStructure)
            Toggle(isOn: $model.values.isCrooked) {
                Text(TuneFieldLabels.isCrooked)
                Text(TuneFieldLabels.crookedHelp)
            }
            NavigationLink(TuneFieldLabels.lyrics) {
                LyricsEditor(lyrics: $model.values.lyrics)
            }
            LabeledContent(TuneFieldLabels.learnedFrom) {
                TextField(
                    TuneFieldLabels.learnedFrom, text: $model.values.learnedFrom, prompt: Text(TuneFieldLabels.notSet)
                )
                .multilineTextAlignment(.trailing)
                .characterLimit(Vocabulary.Limits.Tune.learnedFrom, text: $model.values.learnedFrom)
            }
            LearnedOnRow(day: $model.values.learnedOn)
        } header: {
            Text(TuneFieldLabels.details)
        } footer: {
            Text(TuneFieldLabels.detailsFooter)
        }
    }

    private func save() {
        Task {
            guard let tuneID = await model.save() else {
                if model.validation != nil { titleFocused = true }
                return
            }
            onSaved(tuneID)
            dismiss()
        }
    }
}
