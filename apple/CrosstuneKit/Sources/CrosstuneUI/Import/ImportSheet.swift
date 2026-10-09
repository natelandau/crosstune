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

    public var body: some View {
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
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        // No taller than the Settings window it can open over; the form scrolls.
        .macSheetFrame(MacSheetSize(minHeight: 440, idealHeight: 480))
        .task {
            guard model == nil, let store else { return }
            let model = ImportModel(store: store, analytics: analytics, entry: entry)
            self.model = model
            await model.load()
        }
        .shellSheet()
    }

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

    var body: some View {
        Form {
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
        .formStyle(.grouped)
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
            ToolbarItem(placement: .confirmationAction) {
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

    @ViewBuilder private var pasteStep: some View {
        Section(ImportCopy.pasteLabel) {
            TextEditor(text: $model.text)
                .contentMask()
                .frame(minHeight: 200)
                .accessibilityLabel(ImportCopy.pasteLabel)
                .overlay(alignment: .topLeading) {
                    if model.text.isEmpty {
                        Text(ImportCopy.pastePlaceholder)
                            .foregroundStyle(.tertiary)
                            // The text editor's own text inset, so the placeholder sits where typing starts.
                            #if os(iOS)
                                .padding(.top, 8)
                                .padding(.leading, 5)
                            #else
                                .padding(.leading, 5)
                            #endif
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
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var reviewStep: some View {
        // Status is a segmented control, so it sits apart from the card of rows below it.
        Section(ImportCopy.statusLabel) {
            StatusPicker(status: $model.status)
        }
        Section {
            SuggestionPicker(
                ImportCopy.genreLabel, value: $model.genre, options: Vocabulary.genres, allowsOther: true,
                maxLength: Vocabulary.Limits.Tune.genre)
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
            if model.listKey == .new {
                TextField(ImportCopy.listNameLabel, text: $model.listName, prompt: Text(ImportCopy.listNameLabel))
                    .contentMask()
                    .characterLimit(Vocabulary.Limits.List.name, text: $model.listName)
            }
        }
        if model.review?.dropped ?? 0 > 0 {
            Section {
                Text(ImportCopy.overLimitNote)
                    .foregroundStyle(.secondary)
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

    /// How long Add waits once the review shows: the second press of a double click or double
    /// tap aimed at Continue lands within it.
    private static var armingDelay: Duration {
        #if os(macOS)
            .seconds(NSEvent.doubleClickInterval)
        #else
            .milliseconds(350)
        #endif
    }

    private func add() {
        Task {
            guard let added = try? await model.add(), added > 0 else { return }
            dismiss()
            AccessibilityNotification.Announcement(ImportCopy.addedTunes(added)).post()
        }
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
                .toggleStyle(.checkbox)
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
                        .font(.footnote)
                        .foregroundStyle(.secondary)
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
                    .foregroundStyle(configuration.isOn ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
            }
            .buttonStyle(.borderless)
            .accessibilityRepresentation {
                Toggle(isOn: configuration.$isOn) { configuration.label }
            }
        }
    }
#endif
