import CrosstuneRecording
import CrosstuneStore

@testable import CrosstuneUI

/// A place search that answers from what a test sets. A query or a completion's title in `held`
/// waits for ``release(_:)``, so a test can land an older answer after a newer one, or hold a pick.
@MainActor final class FakePlaceSearch: PlaceSearching {
    var results: [String: [PlaceCompletion]] = [:]
    /// The place each completion resolves to, by its title. A title missing here fails to resolve.
    var places: [String: RecordingPlace] = [:]
    /// The saved location a resolved completion makes, by its title; none for a town.
    var saving: [String: SavedPlaceDraft] = [:]
    var held: Set<String> = []
    /// The places the full search finds, by query; a query missing here finds none, as a failed
    /// search does.
    var local: [String: [LocalPlaceResult]] = [:]
    /// The point the search ranks results near, as it was made.
    let near: Coordinate?

    private(set) var queries: [String] = []
    private(set) var resolves: [String] = []
    private(set) var localQueries: [String] = []
    private var waiting: [String: CheckedContinuation<Void, Never>] = [:]

    init(near: Coordinate? = nil) {
        self.near = near
    }

    func completions(for query: String) async -> [PlaceCompletion] {
        queries.append(query)
        if held.contains(query) {
            await withCheckedContinuation { waiting[query] = $0 }
        }
        return results[query] ?? []
    }

    func resolve(_ completion: PlaceCompletion) async -> PickedPlace? {
        resolves.append(completion.title)
        if held.contains(completion.title) {
            await withCheckedContinuation { waiting[completion.title] = $0 }
        }
        return places[completion.title].map { PickedPlace(place: $0, saving: saving[completion.title]) }
    }

    func localResults(for query: String) async -> [LocalPlaceResult] {
        localQueries.append(query)
        return local[query] ?? []
    }

    func release(_ query: String) {
        held.remove(query)
        waiting.removeValue(forKey: query)?.resume()
    }

    static func completion(_ title: String, _ subtitle: String = "") -> PlaceCompletion {
        PlaceCompletion(title: title, subtitle: subtitle, token: title)
    }

    /// A place the full search finds, named `title` at `point`.
    static func local(_ title: String, _ subtitle: String, at point: Coordinate) -> LocalPlaceResult {
        LocalPlaceResult(
            completion: PlaceCompletion(title: title, subtitle: subtitle, token: "local:\(title)"),
            picked: PickedPlace(place: RecordingPlace(name: title, coordinate: point), saving: nil))
    }
}

/// A completer that answers only when a test says, counting each fragment it is given.
@MainActor final class FakePlaceCompleter: PlaceCompleting {
    var queryFragment = "" {
        didSet { fragments.append(queryFragment) }
    }
    var completions: [PlaceCompletion] = []
    var onAnswer: ((String, Bool) -> Void)?
    private(set) var fragments: [String] = []

    /// Answers the current fragment, or `fragment` when given, as a late answer for an older one.
    func answer(_ titles: [String], for fragment: String? = nil) {
        completions = titles.map { FakePlaceSearch.completion($0) }
        onAnswer?(fragment ?? queryFragment, true)
    }

    func fail() {
        onAnswer?(queryFragment, false)
    }
}

/// Makes one ``FakePlaceSearch`` for every search the editor asks for, keeping where each was
/// asked to rank results near.
@MainActor final class FakePlaceSearches {
    let search: FakePlaceSearch
    private(set) var asked: [Coordinate?] = []

    init(_ search: FakePlaceSearch = FakePlaceSearch()) {
        self.search = search
    }

    func make(near: Coordinate?) -> any PlaceSearching {
        asked.append(near)
        return search
    }
}

/// Nearby places that answer from what a test sets, or fail with ``failure``.
@MainActor final class FakeNearbySearch: NearbySearch {
    var found: [NearbyPlace] = []
    var failure: (any Error)?
    private(set) var asked: [(center: Coordinate, radiusM: Double, limit: Int)] = []

    init() {}

    func places(near center: Coordinate, radiusM: Double, limit: Int) async throws -> [NearbyPlace] {
        asked.append((center, radiusM, limit))
        if let failure { throw failure }
        return found
    }
}
