import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneVocabulary
import Foundation
import GRDB
import Observation
import os

/// The device's region as the storefront a recording search covers.
public var deviceCountry: String { storefrontCountry(.current) }

/// `locale`'s region as a storefront, `US` when it names none or names a numeric region such as
/// `419`, which the API refuses.
func storefrontCountry(_ locale: Locale) -> String {
    guard let region = locale.region?.identifier, region.count == 2,
        region.allSatisfy({ $0.isASCII && $0.isLetter })
    else { return "US" }
    return region
}

/// The chosen services this build can search, in the order the list shows them. Every service
/// when there is no settings row.
func chosenSearchProviders(_ settings: UserSettings?) -> [String] {
    // The server refuses a service it does not know, so one only a newer client knows stays home.
    let chosen = Set(settings.flatMap { $0.deletedAt == nil ? $0 : nil }?.searchProviders ?? searchableProviders)
    return searchableProviders.filter(chosen.contains)
}

/// What the tune menu's Find recordings item does, given the musician's chosen services.
public enum FindRecordingsEntry: Equatable, Sendable {
    /// Opens the sheet on the list of services, or straight on `service`'s results.
    case sheet(service: String?)
    /// Opens the one chosen service's own search page, with no sheet.
    case searchPage(String)

    /// One chosen service skips the list: the item names it and goes straight there.
    public init(providers: [String]) {
        guard providers.count == 1, let only = providers.first else {
            self = .sheet(service: nil)
            return
        }
        self = FindRecordingsModel.searchesInApp(only) ? .sheet(service: only) : .searchPage(only)
    }

    public var opensSheet: Bool {
        if case .sheet = self { return true }
        return false
    }

    /// A service's own search page needs no sheet, so only the sheet's absence disables the item.
    public func isDisabled(sheetAvailable: Bool) -> Bool { opensSheet && !sheetAvailable }

    public var label: String {
        switch self {
        case .sheet(nil): "\(FindRecordingsSheet.title)…"
        case .sheet(.some(let service)), .searchPage(let service):
            "\(FindRecordingsSheet.searchService(FindRecordingsSheet.label(service)))…"
        }
    }
}

/// Why a service's own search page could not open.
public struct SearchPageFailure: LocalizedError, Equatable, Sendable {
    public let message: String

    public var errorDescription: String? { message }
}

/// What the Find recordings sheet reads from the store in one go.
struct FindRecordingsSnapshot: Equatable, Sendable {
    /// The tune's title and type, or empty when the tune is gone.
    var prefill: String
    /// The URLs of the tune's active links.
    var linked: Set<String>
    /// The chosen services this build can search, in the order the list shows them.
    var providers: [String]

    static func fetch(_ db: Database, tuneID: String, settingsRow: String) throws -> FindRecordingsSnapshot {
        let tune = try Tune.fetchOne(db, key: tuneID).flatMap { $0.deletedAt == nil ? $0 : nil }
        let links = try RecordingLink.filter(Column("tune_id") == tuneID).fetchAll(db).filter { $0.deletedAt == nil }
        let settings = try UserSettings.fetchOne(db, key: settingsRow)
        return FindRecordingsSnapshot(
            prefill: tune.map(prefill) ?? "", linked: Set(links.map(\.url)),
            providers: chosenSearchProviders(settings))
    }

    /// What a search starts from: the tune's title and type.
    static func prefill(_ tune: Tune) -> String {
        [tune.title, tune.tuneType?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""]
            .filter { !$0.isEmpty }.joined(separator: " ")
    }
}

/// The Find recordings sheet's state: the query, the list of chosen services, the one service
/// whose results show, the one result playing, and the results linked. Nothing is searched until
/// a service is picked, except when the sheet opens straight on one. Nothing found is kept until
/// Link is tapped.
@MainActor
@Observable
public final class FindRecordingsModel {
    /// Searches `providers` for `q` in the `country` storefront.
    public typealias Search =
        @MainActor (_ q: String, _ providers: [String], _ country: String) async -> RecordingSearchOutcome

    public static let searchNeedsConnection = "Search needs a connection"
    public static let searchFailed = "Couldn't search. Try again."
    /// The longest query the search route takes, in Unicode scalars, which the route counts as
    /// code points.
    public static let maxQuery = 200
    /// The services whose results the sheet shows itself. Every other one opens its own search
    /// page, as does one of these whenever the API answers it search-only.
    public nonisolated static let inlineSearch: Set<String> = ["apple_music", "tidal", "internet_archive"]

    /// The services whose link audio the server can fetch and save as a recording: every
    /// recording origin but the user's own.
    public nonisolated static let importable = Set(Vocabulary.recordingOrigins).subtracting(["own"])

    public nonisolated static func searchesInApp(_ provider: String) -> Bool { inlineSearch.contains(provider) }

    /// A wait under a second still reads as one, since "0 seconds" invites an instant retry.
    public static func tooManySearches(_ seconds: Int) -> String {
        let wait = max(1, seconds)
        return "Too many searches. Try again in \(wait) \(wait == 1 ? "second" : "seconds")."
    }

    /// Why a search showed nothing, or nil when it answered.
    static func message(_ outcome: RecordingSearchOutcome) -> String? {
        switch outcome {
        case .ok: nil
        case .offline: searchNeedsConnection
        case .rateLimited(let seconds): tooManySearches(seconds)
        case .failed: searchFailed
        }
    }

    /// `provider`'s own search page for `query`, or nil when there is nothing to search for. The
    /// client never builds a service's search URL itself, so the search route answers it, at no
    /// cost upstream for a service the app does not search.
    public static func searchPage(
        for provider: String, query: String, country: String = deviceCountry, search: Search?
    ) async -> Result<URL, SearchPageFailure>? {
        let q = trimmed(query)
        guard !q.isEmpty else { return nil }
        let outcome = await search?(q, [provider], country) ?? .offline
        if case .ok(let groups) = outcome,
            let url = groups.first(where: { $0.provider == provider }).flatMap({ URL(string: $0.searchURL) })
        {
            return .success(url)
        }
        return .failure(SearchPageFailure(message: message(outcome) ?? searchFailed))
    }

    public let tuneID: String
    /// Whether the sheet opened straight on one service, with no list to go back to.
    public let isDirect: Bool
    /// The search field's text: the tune's name until the musician types.
    public var query: String { typed ?? stored.value?.prefill ?? "" }
    /// The service whose results show, or nil for the list of services.
    public private(set) var shown: String?
    /// The shown service's answer to the last search.
    public private(set) var group: SearchGroup?
    /// Whether a search is waiting on the server.
    public private(set) var isSearching = false
    /// Why the last search, or the last service's own search page, found nothing to show.
    public private(set) var failure: String?
    /// Why the last link failed, cleared by the next one.
    public private(set) var linkFailure: String?
    /// The URL of the result whose player is open.
    public private(set) var playing: String?

    private let store: CrosstuneStore
    private let analytics: AnalyticsClient
    private let search: Search?
    private let country: String
    private let stopPlayer: @MainActor () -> Void
    private let stored: LiveQuery<FindRecordingsSnapshot?>
    /// Results linked from this sheet, so a second tap adds nothing before the store reports
    /// the first.
    private var claimed: Set<String> = []
    /// What the musician typed, after which the tune's name no longer fills the field.
    private var typed: String?
    /// Whether this opening's one automatic search has run or been overtaken by the musician.
    @ObservationIgnored private var openingDone: Bool
    /// A Return pressed before the store was read, searched once it is.
    @ObservationIgnored private var submitPending = false
    /// Bumped by every search, every Back, and ``cancel()``, so only the latest answer lands.
    @ObservationIgnored private var request = 0
    @ObservationIgnored private var inFlight: Task<RecordingSearchOutcome, Never>?
    /// A search the store's first answer started, not yet running.
    @ObservationIgnored private var deferred: Task<Void, Never>?
    /// Set as the sheet closes; nothing searches after it.
    @ObservationIgnored private var closed = false
    @ObservationIgnored private var following: Task<Void, Never>?
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "find-recordings")

    /// - Parameters:
    ///   - service: Opens straight on this service's results and searches it once, with no list
    ///     to go back to.
    ///   - search: Nil when there is no server to ask, which answers as offline does.
    ///   - country: The storefront searched.
    ///   - stopPlayer: Stops the app's own player, so one thing plays at a time.
    public init(
        store: CrosstuneStore, tuneID: String, service: String? = nil, search: Search?,
        country: String = deviceCountry, stopPlayer: @escaping @MainActor () -> Void = {},
        analytics: AnalyticsClient = .noop
    ) {
        self.store = store
        self.analytics = analytics
        self.tuneID = tuneID
        self.shown = service
        self.isDirect = service != nil
        self.openingDone = service == nil
        self.search = search
        self.country = country
        self.stopPlayer = stopPlayer
        let settingsRow = settingsID(clerkUserID: store.userID)
        stored = LiveQuery(store, initial: nil) { db in
            try FindRecordingsSnapshot.fetch(db, tuneID: tuneID, settingsRow: settingsRow)
        }
        let stored = stored
        following = Task { [weak self] in
            for await _ in Observations({ @MainActor in stored.value }) {
                self?.storeChanged()
            }
        }
    }

    isolated deinit {
        following?.cancel()
        deferred?.cancel()
        inFlight?.cancel()
    }

    /// Whether the tune and the settings have been read.
    public var isLoaded: Bool { stored.value != nil }

    /// Whether the musician has chosen no service to search.
    public var hasNoServices: Bool { stored.value?.providers.isEmpty ?? false }

    /// The chosen services, in the order the list shows them.
    public var providers: [String] { stored.value?.providers ?? [] }

    /// The results that show as linked: the tune's own links and those linked here.
    public var linkedURLs: Set<String> { claimed.union(stored.value?.linked ?? []) }

    /// Takes the field's text as typed.
    public func setQuery(_ text: String) {
        typed = text
        // Typing before the opening search starts is the musician's own search, so the tune's
        // name, arriving later, starts none.
        openingDone = true
    }

    /// Searches the shown service again for the query, trimmed and capped. Does nothing on the
    /// list of services.
    public func submit() async {
        openingDone = true
        guard let shown else { return }
        guard stored.value != nil else {
            submitPending = true
            return
        }
        await run(shown)
    }

    /// Opens a service from the list: one the app searches shows its results here, and any
    /// other answers its own search page for the caller to open, keeping the list.
    public func pick(_ provider: String) async -> URL? {
        failure = nil
        guard !closed else { return nil }
        if Self.searchesInApp(provider) {
            shown = provider
            await run(provider)
            return nil
        }
        request += 1
        let id = request
        let page = await Self.searchPage(for: provider, query: query, country: country, search: search)
        guard id == request else { return nil }
        switch page {
        case .success(let url):
            analytics.send(.findRecordingsUsed(service: LinkService(provider: provider), resultCount: nil))
            return url
        case .failure(let reason): failure = reason.message
        case nil: break
        }
        return nil
    }

    /// Returns to the list of services, keeping the text and dropping the search in flight.
    public func back() {
        request += 1
        inFlight?.cancel()
        inFlight = nil
        isSearching = false
        shown = nil
        group = nil
        failure = nil
        playing = nil
    }

    /// Opens a result's player, closing whichever was open, or closes its own.
    public func play(_ result: SearchResult) {
        if playing == result.url {
            playing = nil
            return
        }
        guard Self.embed(for: result) != nil else { return }
        stopPlayer()
        playing = result.url
    }

    /// Adds the result to the tune as a link, once. Its player keeps playing.
    public func link(_ result: SearchResult) async {
        guard !linkedURLs.contains(result.url) else { return }
        claimed.insert(result.url)
        linkFailure = nil
        let input = LinkInput(
            url: result.url, provider: result.provider, providerRef: result.providerRef, title: result.title,
            artworkURL: result.artworkURL)
        do {
            let linkID = try await Commands(store: store).addLink(tuneID: tuneID, link: input)
            analytics.send(
                .linkAdded(service: LinkService(provider: input.provider), via: .find, linkID: linkID, tuneID: tuneID))
        } catch {
            Self.logger.warning("A found recording's link failed: \(error)")
            claimed.remove(result.url)
            linkFailure = failureMessage(error)
        }
    }

    /// Drops the search in flight, and any about to start, as the sheet closes, so nothing
    /// searched changes the sheet again.
    public func cancel() {
        closed = true
        request += 1
        submitPending = false
        isSearching = false
        deferred?.cancel()
        deferred = nil
        inFlight?.cancel()
        inFlight = nil
    }

    /// A result's own player, or nil when it can only open elsewhere.
    nonisolated static func embed(for result: SearchResult) -> Embed? {
        Embed.for(
            provider: result.provider, providerRef: result.providerRef, url: result.url, autoplay: true,
            title: result.title)
    }

    private func storeChanged() {
        guard !closed, stored.value != nil, let shown else { return }
        if submitPending {
            submitPending = false
            deferred = Task { await run(shown) }
            return
        }
        guard !openingDone, !Self.trimmed(query).isEmpty else { return }
        openingDone = true
        deferred = Task { await run(shown) }
    }

    private func run(_ provider: String) async {
        let q = Self.trimmed(query)
        guard !closed, !Task.isCancelled, !q.isEmpty else { return }
        inFlight?.cancel()
        request += 1
        let id = request
        isSearching = true
        group = nil
        failure = nil
        playing = nil
        let search = search
        let country = country
        let task = Task { await search?(q, [provider], country) ?? .offline }
        inFlight = task
        let outcome = await task.value
        guard id == request else { return }
        inFlight = nil
        isSearching = false
        if case .ok(let found) = outcome {
            group = found.first { $0.provider == provider }
            analytics.send(
                .findRecordingsUsed(service: LinkService(provider: provider), resultCount: group?.results.count ?? 0))
        } else {
            failure = Self.message(outcome)
        }
    }

    private static func trimmed(_ text: String) -> String {
        let scalars = text.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars
        return String(String.UnicodeScalarView(scalars.prefix(maxQuery)))
    }
}
