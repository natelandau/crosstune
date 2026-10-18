import CrosstuneAnalytics
import CrosstuneStore
import Observation
import SwiftUI

/// The words the place search shows.
public enum PlaceSearchText {
    public static let searchLabel = "Search places"
    public static let recent = "Recent places"
    public static let noPlacesFound = "No places found"
    public static let pickFailed = "Couldn’t find that place. Try another."
}

/// The place search's state: the typed query, its suggestions, and the places used before.
/// Searching waits for two characters, and an answer to a query no longer typed is dropped.
@MainActor
@Observable
final class PlaceSearchModel {
    static let minimumQuery = 2

    private(set) var query = ""
    private(set) var completions: [PlaceCompletion] = []
    /// The query ``completions`` answer, so nothing reads as not found while a search runs.
    private var answered: String?
    /// Why the last pick set nothing, cleared at the next edit.
    private(set) var failure: String?
    /// The suggestion being resolved, during which every other pick is ignored.
    private(set) var picking: PlaceCompletion?
    /// Set once a place is picked or cleared, so nothing picks twice.
    private(set) var isDone = false
    let recent: [RecordingPlace]
    let current: RecordingPlace?

    @ObservationIgnored private let makeSearch: @MainActor () -> any PlaceSearching
    /// Made at the first search, so a view rebuilt with a new model makes no search it drops.
    @ObservationIgnored private var madeSearch: (any PlaceSearching)?
    @ObservationIgnored private let onPick: (RecordingPlace, PlaceMethod) -> Void
    @ObservationIgnored private let onClear: () -> Void

    init(
        search: @escaping @MainActor () -> any PlaceSearching, recent: [RecordingPlace], current: RecordingPlace?,
        onPick: @escaping (RecordingPlace, PlaceMethod) -> Void, onClear: @escaping () -> Void
    ) {
        makeSearch = search
        self.recent = recent
        self.current = current
        self.onPick = onPick
        self.onClear = onClear
    }

    /// Whether the query is too short to search, so the places used before show instead.
    var showsRecent: Bool { trimmedQuery.count < Self.minimumQuery }

    var foundNothing: Bool { !showsRecent && answered == query && completions.isEmpty }

    private var search: any PlaceSearching {
        if let madeSearch { return madeSearch }
        let made = makeSearch()
        madeSearch = made
        return made
    }

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    func setQuery(_ query: String) {
        self.query = query
        failure = nil
    }

    /// Asks for the suggestions for the query as it stands.
    func refresh() async {
        let asked = query
        guard !showsRecent else {
            completions = []
            return
        }
        let found = await search.completions(for: trimmedQuery)
        guard asked == query else { return }
        completions = found
        answered = asked
    }

    /// Resolves `completion` and picks it. True only for the pick that sets the place; false
    /// when it cannot be found, which sets nothing, or while another pick runs or after one landed.
    func pick(_ completion: PlaceCompletion) async -> Bool {
        guard picking == nil, !isDone else { return false }
        failure = nil
        picking = completion
        defer { picking = nil }
        guard let place = await search.resolve(completion) else {
            failure = PlaceSearchText.pickFailed
            return false
        }
        isDone = true
        onPick(place, .search)
        return true
    }

    /// Picks a place used before. False while a search pick runs or after one landed.
    func pickRecent(_ place: RecordingPlace) -> Bool {
        guard picking == nil, !isDone else { return false }
        isDone = true
        onPick(place, .suggestion)
        return true
    }

    /// Clears the place. False while a pick runs or after one landed.
    func clear() -> Bool {
        guard picking == nil, !isDone else { return false }
        isDone = true
        onClear()
        return true
    }
}

/// Picks a recording's place: a search field, the places used before until something is typed,
/// and the suggestions after. Pushed inside the edit sheet's navigation, and pops on a pick.
struct PlaceSearchView: View {
    @State private var model: PlaceSearchModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    init(
        search: @escaping @MainActor () -> any PlaceSearching, recent: [RecordingPlace], current: RecordingPlace?,
        onPick: @escaping (RecordingPlace, PlaceMethod) -> Void, onClear: @escaping () -> Void
    ) {
        _model = State(
            initialValue: PlaceSearchModel(
                search: search, recent: recent, current: current, onPick: onPick, onClear: onClear))
    }

    var body: some View {
        Form {
            Section {
                TextField(
                    PlaceSearchText.searchLabel,
                    text: Binding {
                        model.query
                    } set: {
                        model.setQuery($0)
                    },
                    prompt: Text(PlaceSearchText.searchLabel)
                )
                .contentMask()
                .autocorrectionDisabled()
                .focused($focused)
            } footer: {
                if let failure = model.failure {
                    Text(failure)
                        .foregroundStyle(.red)
                }
            }
            if model.showsRecent {
                recentSection
            } else {
                resultsSection
            }
            if model.current != nil {
                Section {
                    Button(EditRecordingText.clearPlace) {
                        if model.clear() { dismiss() }
                    }
                    .disabled(model.picking != nil)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(EditRecordingText.place)
        .task(id: model.query) { await model.refresh() }
        .onAppear { focused = true }
    }

    @ViewBuilder private var recentSection: some View {
        if !model.recent.isEmpty {
            Section(PlaceSearchText.recent) {
                ForEach(model.recent, id: \.self) { place in
                    Button {
                        if model.pickRecent(place) { dismiss() }
                    } label: {
                        Text(place.name)
                            .contentMask()
                            .choiceRow()
                    }
                    .buttonStyle(.plain)
                    .disabled(model.picking != nil)
                }
            }
        }
    }

    private var resultsSection: some View {
        Section {
            if model.foundNothing {
                Text(PlaceSearchText.noPlacesFound)
                    .foregroundStyle(.secondary)
            }
            ForEach(model.completions, id: \.self) { completion in
                Button {
                    Task { if await model.pick(completion) { dismiss() } }
                } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(completion.title)
                                .contentMask()
                            if !completion.subtitle.isEmpty {
                                Text(completion.subtitle)
                                    .contentMask()
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if model.picking == completion {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }
                    .choiceRow()
                }
                .buttonStyle(.plain)
                .disabled(model.picking != nil)
            }
        }
    }
}

extension View {
    /// A whole form row that picks, rather than a bordered button on the Mac.
    fileprivate func choiceRow() -> some View {
        frame(maxWidth: .infinity, alignment: .leading).contentShape(.rect)
    }
}
