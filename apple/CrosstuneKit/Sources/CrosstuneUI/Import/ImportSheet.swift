import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import SwiftUI
import UniformTypeIdentifiers

#if os(macOS)
    import AppKit
#endif

/// Imports a list of tunes: paste or open a text file, review one row per tune, then add the
/// checked rows in one write. Closes where it was opened; the catalog showing the tunes is the
/// visible result, and a screen reader hears the count.
///
/// Reads the store and analytics from the environment.
public struct ImportSheet: View {
    private let entry: ImportEntry

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @Environment(\.dismiss) private var dismiss
    @State private var model: ImportModel?

    public init(entry: ImportEntry) {
        self.entry = entry
    }

    /// No taller than the Settings window it can open over; the form scrolls.
    static let macSize = MacSheetSize(minHeight: 440, idealHeight: 480)

    public var body: some View {
        #if os(macOS)
            Group {
                if let model {
                    ImportContent(model: model)
                } else {
                    // Loading is silence, but Cancel stays a way out should no store ever arrive.
                    MacSheet(
                        title: ImportCopy.title, size: Self.macSize,
                        cancel: .cancel(TuneFormSheet.cancel) { dismiss() }, primary: nil
                    ) {
                        Color.clear
                    }
                }
            }
            .task { await loadModel() }
            .shellSheet()
        #else
            phoneBody
        #endif
    }

    private func loadModel() async {
        guard model == nil, let store else { return }
        let model = ImportModel(store: store, analytics: analytics, entry: entry)
        self.model = model
        await model.load()
    }

    #if os(iOS)
        private var phoneBody: some View {
            NavigationStack {
                Group {
                    if let model {
                        ImportContent(model: model)
                    } else {
                        // Loading is silence, but Cancel stays a way out should no store ever arrive.
                        Color.clear
                            .navigationTitle(ImportCopy.title)
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button(TuneFormSheet.cancel) { dismiss() }
                                }
                            }
                    }
                }
                .navigationBarTitleDisplayMode(.inline)
            }
            .task { await loadModel() }
            .shellSheet()
        }
    #endif

    /// The row's second line: what was read when it differs from the title, then its notes.
    static func note(_ row: ImportRow) -> String? {
        let title = row.title.trimmingCharacters(in: .whitespacesAndNewlines)
        var parts: [String] = []
        if row.source != title { parts.append(row.source) }
        if row.duplicate && !title.isEmpty { parts.append(ImportCopy.alreadyInCatalog) }
        if row.warnings.contains(.shortened) { parts.append(ImportCopy.shortenedNote) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

private struct ImportContent: View {
    @Bindable var model: ImportModel

    @Environment(\.dismiss) private var dismiss
    @State private var importing = false

    #if os(macOS)
        var body: some View {
            MacSheet(
                title: ImportCopy.title, size: ImportSheet.macSize, cancel: macCancel, primary: macPrimary
            ) {
                if model.step == .paste {
                    Text(ImportCopy.recordingsNote)
                        .font(MacStyle.secondary)
                        .foregroundStyle(Palette.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } content: {
                switch model.step {
                case .paste:
                    // Not in a scroll view, so the editor fills the sheet down to its buttons.
                    VStack(alignment: .leading, spacing: 12) {
                        macFailure
                        macPasteStep
                    }
                    .padding(.horizontal, MacStyle.sheetMargin)
                    .padding(.top, 4)
                    .padding(.bottom, MacStyle.sheetMargin)
                case .review:
                    MacFormScroll {
                        macFailure
                        macReviewStep
                    }
                }
            }
            .modifier(ImportLifecycle(model: model, importing: $importing))
        }

        private var macCancel: MacSheetAction {
            switch model.step {
            case .paste: .cancel(TuneFormSheet.cancel) { dismiss() }
            case .review: .cancel(ImportCopy.back, isEnabled: !model.isAdding) { model.back() }
            }
        }

        private var macPrimary: MacSheetAction {
            switch model.step {
            case .paste:
                .init(ImportCopy.continueAction, isEnabled: model.canContinue) {
                    Task { await model.continueToReview() }
                }
            case .review: .init(model.addLabel, isEnabled: model.canAdd, action: add)
            }
        }

        @ViewBuilder private var macFailure: some View {
            if let failure = model.failure {
                FailureText(failure)
                    .contentMask()
            }
        }

        private var macPasteStep: some View {
            VStack(alignment: .leading, spacing: 12) {
                MacTextArea(
                    ImportCopy.pasteLabel, text: $model.text, placeholder: ImportCopy.pastePlaceholder, minLines: 11
                )
                .contentMask()
                .frame(maxHeight: .infinity)
                HStack(spacing: 16) {
                    Button(ImportCopy.openFile) { importing = true }
                        .buttonStyle(.macSecondary)
                        .disabled(!model.canOpenFile)
                    ImportHelp()
                }
            }
        }

        @ViewBuilder private var macReviewStep: some View {
            MacFormSection(ImportCopy.statusLabel, card: false) {
                StatusPicker(status: $model.status)
            }
            MacFormSection {
                reviewFields
            }
            if model.review?.dropped ?? 0 > 0 {
                Text(ImportCopy.overLimitNote)
                    .font(MacStyle.secondary)
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if model.showsHelp {
                ImportHelp()
            }
            if let rows = model.review?.rows, !rows.isEmpty {
                MacFormSection {
                    ForEach(rows) { row in
                        ImportReviewRow(row: row, model: model)
                    }
                }
            }
        }
    #endif

    #if os(iOS)
        var body: some View {
            PaperForm {
                if let failure = model.failure {
                    Section {
                        Text(failure)
                            .contentMask()
                            .foregroundStyle(.red)
                    }
                }
                switch model.step {
                case .paste: pasteStep
                case .review: reviewStep
                }
            }
            .navigationTitle(ImportCopy.title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    switch model.step {
                    case .paste:
                        Button(TuneFormSheet.cancel) { dismiss() }
                    case .review:
                        Button(ImportCopy.back, systemImage: "chevron.backward") { model.back() }
                            .disabled(model.isAdding)
                    }
                }
                ConfirmToolbarItem {
                    switch model.step {
                    case .paste:
                        Button(ImportCopy.continueAction) { Task { await model.continueToReview() } }
                            .fontWeight(.semibold)
                            .disabled(!model.canContinue)
                    case .review:
                        Button(model.addLabel, action: add)
                            .fontWeight(.semibold)
                            .disabled(!model.canAdd)
                    }
                }
            }
            .modifier(ImportLifecycle(model: model, importing: $importing))
        }

        @ViewBuilder private var pasteStep: some View {
            Section(ImportCopy.pasteLabel) {
                TextEditor(text: $model.text)
                    .contentMask()
                    .frame(minHeight: 200)
                    .accessibilityLabel(ImportCopy.pasteLabel)
                    .overlay(alignment: .topLeading) {
                        if model.text.isEmpty {
                            Text(ImportCopy.pastePlaceholder)
                                .foregroundStyle(.inkTertiary)
                                // The text editor's own text inset, so the placeholder sits where typing starts.
                                .padding(.top, 8)
                                .padding(.leading, 5)
                                .allowsHitTesting(false)
                                .accessibilityHidden(true)
                        }
                    }
            }
            Section {
                Button(ImportCopy.openFile, systemImage: "folder") { importing = true }
                    .disabled(!model.canOpenFile)
            }
            Section {
                ImportHelp()
                Text(ImportCopy.recordingsNote)
                    .font(.platform(.footnote))
                    .foregroundStyle(.inkSecondary)
            }
        }

        @ViewBuilder private var reviewStep: some View {
            // Status is a segmented control, so it sits apart from the card of rows below it.
            Section(ImportCopy.statusLabel) {
                StatusPicker(status: $model.status)
            }
            Section {
                reviewFields
            }
            if model.review?.dropped ?? 0 > 0 {
                Section {
                    Text(ImportCopy.overLimitNote)
                        .foregroundStyle(.inkSecondary)
                }
            }
            if model.showsHelp {
                Section {
                    ImportHelp()
                }
            }
            if let rows = model.review?.rows, !rows.isEmpty {
                Section {
                    ForEach(rows) { row in
                        ImportReviewRow(row: row, model: model)
                    }
                }
            }
        }
    #endif

    @ViewBuilder private var reviewFields: some View {
        SuggestionField(
            ImportCopy.genreLabel, value: $model.genre, suggestions: Vocabulary.genres,
            maxLength: Vocabulary.Limits.Tune.genre)
        #if os(macOS)
            MacPopUp(
                ImportCopy.listLabel, selection: $model.listKey,
                options: [ImportModel.ListKey.none, .new] + model.lists.map { .existing($0.id) }, label: listLabel
            )
            .contentMask()
        #else
            Picker(ImportCopy.listLabel, selection: $model.listKey) {
                Text(ImportCopy.noList).tag(ImportModel.ListKey.none)
                Text(ImportCopy.newList).tag(ImportModel.ListKey.new)
                ForEach(model.lists) { option in
                    Text(option.name)
                        .contentMask()
                        .tag(ImportModel.ListKey.existing(option.id))
                }
            }
            .contentMask()
        #endif
        if model.listKey == .new {
            TextField(ImportCopy.listNameLabel, text: $model.listName, prompt: Text(ImportCopy.listNameLabel))
                .contentMask()
                #if os(macOS)
                    // The prompt names the field, which a grouped form would name again.
                    .labelsHidden()
                    .textFieldStyle(.macField)
                #endif
                .characterLimit(Vocabulary.Limits.List.name, text: $model.listName)
        }
    }

    private func add() {
        Task {
            guard let added = try? await model.add(), added > 0 else { return }
            dismiss()
            AccessibilityNotification.Announcement(ImportCopy.addedTunes(added)).post()
        }
    }

    #if os(macOS)
        private func listLabel(_ key: ImportModel.ListKey) -> String {
            switch key {
            case .none: ImportCopy.noList
            case .new: ImportCopy.newList
            case .existing(let id): model.lists.first { $0.id == id }?.name ?? ""
            }
        }
    #endif
}

/// What the import sheet does around its steps on both platforms: arming Add, taking a dropped
/// file, holding typed work, and the file picker.
private struct ImportLifecycle: ViewModifier {
    let model: ImportModel
    @Binding var importing: Bool

    func body(content: Content) -> some View {
        content
            .task(id: model.step) {
                guard model.step == .review else { return }
                do {
                    try await Task.sleep(for: Self.armingDelay)
                } catch {
                    return
                }
                model.armAdd()
            }
            #if os(macOS)
                .dropDestination(for: URL.self) { urls, _ in
                    // A link dragged from a browser arrives as a URL too, and has no file to open.
                    let files = urls.filter(\.isFileURL)
                    guard model.step == .paste, model.canOpenFile, !files.isEmpty else { return false }
                    Task { await model.load(dropped: files) }
                    return true
                }
            #endif
            // Typed work leaves only through Cancel, and nothing leaves while its write is running.
            .interactiveDismissDisabled(model.isEdited || model.isAdding)
            .coversShell(importing)
            .fileImporter(isPresented: $importing, allowedContentTypes: [.plainText], allowsMultipleSelection: false) {
                result in
                switch result {
                case .success(let urls):
                    if let url = urls.first { Task { await model.load(file: url) } }
                case .failure(let error): model.failure = failureMessage(error)
                }
            }
    }

    /// How long Add waits once the review shows: the second press of a double click or double
    /// tap aimed at Continue lands within it.
    private static var armingDelay: Duration {
        #if os(macOS)
            .seconds(NSEvent.doubleClickInterval)
        #else
            .milliseconds(350)
        #endif
    }
}

/// One candidate: its check, its editable title, and what was read for it.
private struct ImportReviewRow: View {
    let row: ImportRow
    let model: ImportModel

    var body: some View {
        let title = row.title.trimmingCharacters(in: .whitespacesAndNewlines)
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Toggle(
                ImportCopy.include(title.isEmpty ? row.source : title),
                isOn: Binding {
                    row.included
                } set: {
                    model.setIncluded($0, row: row.id)
                }
            )
            .contentMask()
            .labelsHidden()
            #if os(macOS)
                .toggleStyle(.macCheckbox)
            #else
                .toggleStyle(CheckSquareToggleStyle())
            #endif
            VStack(alignment: .leading, spacing: 2) {
                TextField(
                    TuneFieldLabels.title,
                    text: Binding {
                        row.title
                    } set: {
                        model.setTitle($0, row: row.id)
                    },
                    prompt: Text(TuneFieldLabels.title)
                )
                .contentMask()
                .labelsHidden()
                #if os(macOS)
                    .textFieldStyle(.macField)
                #endif
                .characterLimit(
                    Vocabulary.Limits.Tune.title,
                    text: Binding {
                        row.title
                    } set: {
                        model.setTitle($0, row: row.id)
                    })
                if let note = ImportSheet.note(row) {
                    Text(note)
                        .contentMask()
                        .font(.platform(.footnote))
                        .foregroundStyle(.inkSecondary)
                }
            }
        }
    }
}

#if os(iOS)
    /// A square check, so an included row never reads as a status, whose glyphs are circles.
    private struct CheckSquareToggleStyle: ToggleStyle {
        func makeBody(configuration: Configuration) -> some View {
            Button {
                configuration.isOn.toggle()
            } label: {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .imageScale(.large)
                    .foregroundStyle(configuration.isOn ? AnyShapeStyle(.tint) : .inkSecondary)
            }
            .buttonStyle(.borderless)
            .accessibilityRepresentation {
                Toggle(isOn: configuration.$isOn) { configuration.label }
            }
        }
    }
#endif
