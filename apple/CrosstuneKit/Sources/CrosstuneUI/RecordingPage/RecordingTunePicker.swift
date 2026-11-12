import CrosstuneDesign
import CrosstuneStore
import Observation
import SwiftUI

/// The Tune row's search: the whole catalog A to Z while the field is empty, archived tunes
/// included, narrowed as the musician types, with an offer to start a tune by the typed title
/// when nothing matches. A pick files the recording under the tune.
@MainActor
@Observable
final class RecordingTunePickerModel: TunePickerSource {
    var query = ""

    /// The tune the recording is filed under, nil for none.
    let chosenID: String?

    private let search: CatalogPickerSearch
    @ObservationIgnored private let onPick: @MainActor (_ tuneID: String) async -> Void
    @ObservationIgnored private let onCreate: @MainActor (_ title: String) async -> Void

    /// - Parameters:
    ///   - onPick: Files the recording under the picked tune.
    ///   - onCreate: Starts a tune by the typed title and files the recording under it.
    init(
        store: CrosstuneStore, chosenID: String?,
        onPick: @escaping @MainActor (_ tuneID: String) async -> Void = { _ in },
        onCreate: @escaping @MainActor (_ title: String) async -> Void = { _ in }
    ) {
        self.chosenID = chosenID
        self.onPick = onPick
        self.onCreate = onCreate
        search = CatalogPickerSearch(store: store)
    }

    /// The instruments the musician plays, for the tunings each row shows.
    var instruments: Set<String> { search.instruments }

    var isIdle: Bool { CatalogPickerSearch.isIdle(query) }

    /// The recording page shows a failed filing, so the sheet has none of its own.
    var failure: String? { nil }

    var showsHint: Bool { false }

    /// Nil until the catalog is read, as ``CatalogPickerSearch/find(_:)`` is.
    var results: TunePickerResults? {
        guard let found = search.find(query) else { return nil }
        let matches = found.matches.map(\.entry)
        return TunePickerResults(
            rows: matches.prefix(TunePickerModel.maxResults).map(row), matches: matches, outcome: found.outcome)
    }

    /// The whole catalog A to Z while the search field is empty; empty once something is typed,
    /// when ``results`` takes over. Nil until the catalog is read.
    var idleResults: [TunePickerRow]? {
        guard let entries = search.entries else { return nil }
        return isIdle ? entries.map(row) : []
    }

    /// Reads the catalog, so the sheet shows it without waiting on the live query. Later
    /// catalog writes arrive through the live query.
    func load() async throws {
        try await search.load()
    }

    private func row(_ entry: CatalogEntry) -> TunePickerRow {
        TunePickerRow(
            entry: entry, state: entry.tune.id == chosenID ? .chosen : .open, action: "Add to",
            instruments: instruments)
    }

    func pick(_ entry: CatalogEntry) async {
        await onPick(entry.tune.id)
    }

    func create(_ title: String) async {
        await onCreate(title)
    }

    /// Return files under the only match, or starts a tune when nothing matches.
    func submit() async -> TunePickerSubmit {
        guard let results else { return .nothing }
        switch SearchSubmit(query: query, visible: results.matches, outcome: results.outcome) {
        case .open(let tuneID):
            await onPick(tuneID)
            return .picked
        case .create(let title): return .create(title: title)
        case .dismiss: return .dismissKeyboard
        }
    }
}

/// The Tune row's sheet: Go to tune and Remove from tune for a filed recording, then the search
/// over the catalog. A pick files the recording and closes.
struct RecordingTuneSheet: View {
    let title: String
    /// The tune the recording is filed under, nil for none.
    let tuneID: String?
    let model: RecordingAttributeModel
    /// Opens the tune's page; nil leaves Go to tune out.
    let onGoToTune: (() -> Void)?

    @Environment(\.store) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var picker: RecordingTunePickerModel?

    var body: some View {
        TunePicker(title: title, selection: .one, model: picker) { filedActions }
            .task { await openPicker() }
            .shellSheet()
    }

    @ViewBuilder private var filedActions: some View {
        if tuneID != nil {
            if onGoToTune != nil {
                Button(RecordingsListText.goToTune, systemImage: "arrow.right.circle", action: goToTune)
                    .buttonStyle(.text)
            }
            Button(
                RecordingRowActions.removeFromTune, systemImage: "folder.badge.minus", role: .destructive,
                action: removeFromTune
            )
            .buttonStyle(.text)
        }
    }

    private func openPicker() async {
        guard picker == nil, let store else { return }
        let model = model
        let opened = RecordingTunePickerModel(
            store: store, chosenID: tuneID,
            onPick: { await model.file($0) },
            onCreate: { await model.fileUnderNewTune($0) })
        // Shown before the read, so the search field is in place as the sheet opens.
        picker = opened
        try? await opened.load()
    }

    private func goToTune() {
        dismiss()
        onGoToTune?()
    }

    private func removeFromTune() {
        dismiss()
        Task { await model.file(nil) }
    }
}
