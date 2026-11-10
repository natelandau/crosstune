import CrosstuneCommands
import CrosstuneDesign
import CrosstuneStore
import Observation
import SwiftUI

/// The Tune row's search: the whole catalog A to Z while the field is empty, archived tunes
/// included, narrowed as the musician types, with an offer to start a tune by the typed title
/// when nothing matches.
@MainActor
@Observable
final class RecordingTunePickerModel {
    static let searchPrompt = "Search tunes"
    /// How many results show at once; a longer query narrows them.
    static let maxResults = TunePickerModel.maxResults

    /// What the search shows for the current query.
    struct Results: Equatable {
        let rows: [CatalogEntry]
        /// Every match, beyond the rows shown.
        let matches: [CatalogEntry]
        let outcome: SearchOutcome
    }

    /// What Return in the search field asks the editor to do.
    enum Submit: Equatable {
        case nothing
        case pick(tuneID: String)
        case create(title: String)
        case dismissKeyboard
    }

    var query = "" {
        didSet {
            guard query != oldValue else { return }
            refresh()
        }
    }

    /// Nil until the catalog is read, as ``CatalogPickerSearch/find(_:)`` is. Searched as the query
    /// or the catalog changes, not on each redraw.
    private(set) var results: Results?

    /// The whole catalog A to Z while the search field is empty; empty once something is typed,
    /// when ``results`` takes over. Nil until the catalog is read.
    private(set) var idleResults: [CatalogEntry]?

    private let search: CatalogPickerSearch

    init(store: CrosstuneStore) {
        let search = CatalogPickerSearch(store: store)
        self.search = search
        follow()
    }

    /// The instruments the musician plays, for the tunings each row shows.
    var instruments: Set<String> { search.instruments }

    var isIdle: Bool { CatalogPickerSearch.isIdle(query) }

    /// Reads the catalog and fills ``results`` and ``idleResults`` from it, an empty one
    /// included. Later catalog writes arrive through the live query.
    func load() async throws {
        try await search.load()
        refresh()
    }

    /// Refreshes now and again after each catalog change. Tracking is armed in the same
    /// synchronous step as the read, so no change slips between them, and an empty catalog
    /// refreshes like any other.
    private func follow() {
        withObservationTracking {
            refresh()
        } onChange: { [weak self] in
            Task { @MainActor in self?.follow() }
        }
    }

    private func refresh() {
        if let found = search.find(query) {
            let matches = found.matches.map(\.entry)
            results = Results(rows: Array(matches.prefix(Self.maxResults)), matches: matches, outcome: found.outcome)
        } else {
            results = nil
        }
        idleResults = search.entries.map { isIdle ? $0 : [] }
    }

    /// A result row's spoken name. Pickers search archived tunes on purpose, so the name says
    /// which ones they are.
    nonisolated static func rowName(_ entry: CatalogEntry) -> String {
        let add = "Add to \(entry.tune.title)"
        return entry.isArchived ? "\(add), archived" : add
    }

    /// Return files under the only match, or starts a tune when nothing matches.
    func submit() -> Submit {
        guard let results else { return .nothing }
        switch SearchSubmit(query: query, visible: results.matches, outcome: results.outcome) {
        case .open(let tuneID): return .pick(tuneID: tuneID)
        case .create(let title): return .create(title: title)
        case .dismiss: return .dismissKeyboard
        }
    }
}

/// The Tune row's editor: Go to tune and Remove from tune for a filed recording, then the
/// search over the catalog. A pick files the recording and closes.
struct RecordingTuneEditor: View {
    let controls: AttributeEditorControls<String?>
    /// Opens the tune's page; nil leaves Go to tune out.
    let onGoToTune: (() -> Void)?
    /// Starts a tune by the typed title and files the recording under it.
    let onCreate: (String) -> Void

    @Environment(\.store) private var store
    @State private var model: RecordingTunePickerModel?

    /// Tall enough for a few rows in a popover, so the catalog scrolls inside the editor.
    private static let listHeight: CGFloat = 280

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if controls.draft.wrappedValue != nil {
                filedActions
            }
            if let model {
                search(model)
            }
        }
        .task {
            guard model == nil, let store else { return }
            let picker = RecordingTunePickerModel(store: store)
            try? await picker.load()
            model = picker
        }
    }

    @ViewBuilder private var filedActions: some View {
        if let onGoToTune {
            Button(RecordingsListText.goToTune, systemImage: "arrow.right.circle") {
                controls.done()
                onGoToTune()
            }
            .buttonStyle(.text)
        }
        Button(RecordingRowActions.removeFromTune, systemImage: "folder.badge.minus", role: .destructive) {
            controls.pick(nil)
        }
        .buttonStyle(.text)
    }

    private func search(_ model: RecordingTunePickerModel) -> some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 8) {
            #if os(macOS)
                FilterSearchField(
                    prompt: RecordingTunePickerModel.searchPrompt, query: $model.query,
                    isFocused: controls.firstField, onSubmit: { submit(model) })
            #else
                TextField(
                    RecordingTunePickerModel.searchPrompt, text: $model.query,
                    prompt: Text(RecordingTunePickerModel.searchPrompt)
                )
                .contentMask()
                .autocorrectionDisabled()
                .focused(controls.firstField)
                .onSubmit { submit(model) }
            #endif
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    if model.isIdle {
                        ForEach(model.idleResults ?? []) { row($0, model: model) }
                    } else if let results = model.results {
                        ForEach(results.rows) { row($0, model: model) }
                        if let label = results.outcome.addTypedTitleLabel, let title = results.outcome.title {
                            createRow(label: label, title: title)
                        }
                    }
                }
            }
            .frame(height: Self.listHeight)
            .scrollBounceBehavior(.basedOnSize)
        }
    }

    private func row(_ entry: CatalogEntry, model: RecordingTunePickerModel) -> some View {
        Button {
            controls.pick(entry.tune.id)
        } label: {
            HStack(spacing: 8) {
                #if os(macOS)
                    MacPickGlyph(kind: entry.tune.id == controls.draft.wrappedValue ? .done : .addOnHighlight)
                #endif
                TuneRow(tune: entry.tune, userTune: entry.userTune, instruments: model.instruments)
                    .foregroundStyle(.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                SelectionMark(.single(isChosen: entry.tune.id == controls.draft.wrappedValue))
            }
            .contentShape(.rect)
        }
        .buttonStyle(.pickRow)
        #if !os(macOS)
            .padding(.vertical, 4)
        #endif
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(RecordingTunePickerModel.rowName(entry))
        .accessibilityAddTraits(entry.tune.id == controls.draft.wrappedValue ? [.isButton, .isSelected] : .isButton)
    }

    @ViewBuilder private func createRow(label: String, title: String) -> some View {
        #if os(macOS)
            Button {
                create(title)
            } label: {
                HStack(spacing: 8) {
                    MacPickGlyph(kind: .add)
                    Text(label)
                        .contentMask()
                }
            }
            .buttonStyle(.macRow)
        #else
            AddTypedTitleRow(label: label) { create(title) }
        #endif
    }

    private func submit(_ model: RecordingTunePickerModel) {
        switch model.submit() {
        case .nothing: break
        case .pick(let tuneID): controls.pick(tuneID)
        case .create(let title): create(title)
        case .dismissKeyboard: controls.firstField.wrappedValue = false
        }
    }

    /// Closes the editor with nothing to save, then starts the tune, which files the recording.
    private func create(_ title: String) {
        controls.done()
        onCreate(title)
    }
}
