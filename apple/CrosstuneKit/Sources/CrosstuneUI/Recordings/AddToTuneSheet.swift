import CrosstuneCommands
import CrosstuneStore
import GRDB
import Observation
import SwiftUI
import os

/// The add to tune sheet's state: a search over the whole catalog, archived tunes included, that
/// files one recording under the tune picked, or offers to start a tune by the typed title.
@MainActor
@Observable
public final class AddToTuneModel {
    /// A filing under a tune started from the sheet, which fails after the sheet has gone.
    nonisolated public static let failed = "The recording could not be added to this tune."
    /// How many results show at once; a longer query narrows them.
    public static let maxResults = TunePickerModel.maxResults

    /// What the search shows for the current query.
    public struct Results: Equatable {
        public let rows: [CatalogEntry]
        /// Every match, beyond the rows shown.
        public let matches: [CatalogEntry]
        public let outcome: SearchOutcome
    }

    /// What Return in the search field asks the sheet to do.
    public enum Submit: Equatable {
        case nothing
        /// The recording is filed; the sheet closes.
        case filed
        case create(title: String)
        case dismissKeyboard
    }

    public let recordingID: String
    public var query = ""
    /// The last pick's failure, cleared by the next pick.
    public private(set) var failure: String?
    /// True from a pick until it lands or fails, so a second pick files nothing more.
    public private(set) var isFiling = false

    private let store: CrosstuneStore
    private let entries: LiveQuery<[CatalogEntry]?>
    private let storedInstruments: LiveQuery<Set<String>?>
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "add-to-tune")

    public init(store: CrosstuneStore, recordingID: String) {
        self.store = store
        self.recordingID = recordingID
        entries = LiveQuery(store, initial: nil, fetch: CatalogModel.fetchEntries)
        let settingsRow = settingsID(clerkUserID: store.userID)
        storedInstruments = LiveQuery(store, initial: nil) { db in
            guard let row = try UserSettings.fetchOne(db, key: settingsRow), row.deletedAt == nil else { return [] }
            return Set(row.instruments)
        }
    }

    /// The instruments the musician plays, for the tunings each row shows.
    public var instruments: Set<String> { storedInstruments.value ?? [] }

    /// Whether the search field is empty, when the sheet says what it is for.
    public var isIdle: Bool { query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Nil until the catalog is read: an unread catalog looks like one holding no such tune, and
    /// would offer to start a tune that is already there.
    public var results: Results? {
        guard let entries = entries.value else { return nil }
        let matches = isIdle ? [] : CatalogSearch.filter(entries, by: CatalogFilters(archived: true), query: query)
        return Results(
            rows: Array(matches.prefix(Self.maxResults)), matches: matches,
            outcome: SearchOutcome(entries: entries, visible: matches, query: query, archivedShown: true))
    }

    /// A result row's spoken name. Pickers search archived tunes on purpose, so the name says
    /// which ones they are.
    nonisolated public static func rowName(_ entry: CatalogEntry) -> String {
        let add = "Add to \(entry.tune.title)"
        return entry.isArchived ? "\(add), archived" : add
    }

    /// Files the recording under the picked tune. True once it lands.
    public func pick(_ entry: CatalogEntry) async -> Bool {
        guard !isFiling else { return false }
        isFiling = true
        failure = nil
        let recordingID = recordingID
        do {
            try await Commands(store: store).updateRecording(recordingID, tuneID: .value(entry.tune.id))
            return true
        } catch {
            Self.logger.warning("A recording could not be filed: \(error)")
            failure = ListModel.message(error)
            isFiling = false
            return false
        }
    }

    /// Return files under the only match, or starts a tune when nothing matches.
    public func submit() async -> Submit {
        guard let results else { return .nothing }
        switch SearchSubmit(query: query, visible: results.matches, outcome: results.outcome) {
        case .open(let tuneID):
            guard let entry = results.matches.first(where: { $0.tune.id == tuneID }) else { return .nothing }
            return await pick(entry) ? .filed : .nothing
        case .create(let title):
            return .create(title: title)
        case .dismiss:
            return .dismissKeyboard
        }
    }
}

/// Searches for the tune a recording belongs to, or starts a new one to file it under. Reads the
/// store from the environment.
public struct AddToTuneSheet: View {
    public static let title = "Add to a tune"
    public static let searchPrompt = "Search tunes"

    private let recordingID: String
    private let onCreate: (_ title: String) -> Void

    @Environment(\.store) private var store
    @State private var model: AddToTuneModel?

    /// - Parameter onCreate: The musician chose to start a tune by this title; the sheet is
    ///   closing, and the caller opens the tune form once it has gone.
    public init(recordingID: String, onCreate: @escaping (_ title: String) -> Void) {
        self.recordingID = recordingID
        self.onCreate = onCreate
    }

    public var body: some View {
        NavigationStack {
            Group {
                if let model {
                    AddToTuneContent(model: model, onCreate: onCreate)
                } else {
                    Color.clear
                }
            }
            .navigationTitle(Self.title)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 480, minHeight: 480, idealHeight: 560)
        #endif
        .task {
            guard model == nil, let store else { return }
            model = AddToTuneModel(store: store, recordingID: recordingID)
        }
        .shellSheet()
    }
}

private struct AddToTuneContent: View {
    @Bindable var model: AddToTuneModel
    let onCreate: (_ title: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var searchFocused: Bool

    var body: some View {
        List {
            if let failure = model.failure {
                Text(failure)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            if let results = model.results {
                ForEach(results.rows) { entry in
                    row(entry)
                }
                if let offer = results.outcome.offerLabel, let title = results.outcome.title {
                    SearchOfferRow(label: offer) { create(title) }
                }
            }
        }
        .listStyle(.plain)
        .searchable(text: $model.query, placement: Self.searchPlacement, prompt: AddToTuneSheet.searchPrompt)
        .searchFocused($searchFocused)
        .onSubmit(of: .search) {
            Task {
                switch await model.submit() {
                case .nothing: searchFocused = true
                case .filed: dismiss()
                case .create(let title): create(title)
                case .dismissKeyboard: searchFocused = false
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(TuneFormSheet.cancel) { dismiss() }
                    .disabled(model.isFiling)
            }
        }
        .interactiveDismissDisabled(model.isFiling)
        .onAppear { searchFocused = true }
        #if os(iOS)
            // The screen under this sheet stands its Find down, so Command-F reaches this search.
            .focusedSceneValue(\.findAction, MenuAction { searchFocused = true })
        #endif
    }

    private static var searchPlacement: SearchFieldPlacement {
        #if os(iOS)
            .navigationBarDrawer(displayMode: .always)
        #else
            .automatic
        #endif
    }

    private func row(_ entry: CatalogEntry) -> some View {
        Button {
            Task {
                if await model.pick(entry) { dismiss() }
            }
        } label: {
            TuneRow(tune: entry.tune, userTune: entry.userTune, instruments: model.instruments)
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(model.isFiling)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(AddToTuneModel.rowName(entry))
        .accessibilityAddTraits(.isButton)
    }

    private func create(_ title: String) {
        onCreate(title)
        dismiss()
    }
}
