import CrosstuneStore

@testable import CrosstuneUI

/// A place search that answers from what a test sets. A query or a completion's title in `held`
/// waits for ``release(_:)``, so a test can land an older answer after a newer one, or hold a pick.
@MainActor final class FakePlaceSearch: PlaceSearching {
    var results: [String: [PlaceCompletion]] = [:]
    /// The place each completion resolves to, by its title. A title missing here fails to resolve.
    var places: [String: RecordingPlace] = [:]
    var held: Set<String> = []

    private(set) var queries: [String] = []
    private(set) var resolves: [String] = []
    private var waiting: [String: CheckedContinuation<Void, Never>] = [:]

    init() {}

    func completions(for query: String) async -> [PlaceCompletion] {
        queries.append(query)
        if held.contains(query) {
            await withCheckedContinuation { waiting[query] = $0 }
        }
        return results[query] ?? []
    }

    func resolve(_ completion: PlaceCompletion) async -> RecordingPlace? {
        resolves.append(completion.title)
        if held.contains(completion.title) {
            await withCheckedContinuation { waiting[completion.title] = $0 }
        }
        return places[completion.title]
    }

    func release(_ query: String) {
        held.remove(query)
        waiting.removeValue(forKey: query)?.resume()
    }

    static func completion(_ title: String, _ subtitle: String = "") -> PlaceCompletion {
        PlaceCompletion(title: title, subtitle: subtitle, token: title)
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
