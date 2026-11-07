import CrosstuneAnalytics
import CrosstuneRecording
import CrosstuneStore
import Foundation
import Observation

/// The lists under the location editor's current place, one shown at a time.
enum LocationList: CaseIterable, Hashable {
    case nearby
    case saved
    case recent

    var title: String {
        switch self {
        case .nearby: PlaceSearchText.nearby
        case .saved: PlaceSearchText.saved
        case .recent: PlaceSearchText.recent
        }
    }
}

/// The location editor's state over its edit's: the search, the device's position, the recording's
/// place now, and the places near it, saved, and recent. Every pick is staged in the edit, which
/// writes it when the editor leaves, unless Escape or Cancel discarded it. Searching waits for two
/// characters, and an answer to a query no longer typed is dropped.
@MainActor
@Observable
final class LocationEditorModel {
    static let minimumQuery = 2
    /// How many of the top rows resolve for a distance, kept low since each is a lookup.
    static let resolvedResults = 3
    /// How long the typed text stays unchanged before the full search runs and the top rows
    /// resolve. MapKit throttles lookups per app, cancelled ones included, so a lookup per
    /// keystroke would soon make picks fail.
    static let settleDelay: Duration = .milliseconds(400)

    /// The search as typed. An edit clears the last pick's failure.
    var query = "" {
        didSet { failure = nil }
    }
    /// The suggestions for the query as typed, from anywhere.
    private var suggestions: [PlaceCompletion] = [] {
        didSet { completions = Self.merged(local: local?.results ?? [], suggestions: suggestions) }
    }
    /// The places a full search found around the hint once the typing settled; nil before one
    /// has, and once the query or the hint moves on.
    private var local: LocalResults? {
        didSet { completions = Self.merged(local: local?.results ?? [], suggestions: suggestions) }
    }
    /// The place results as they show: the full search's places first, then the suggestions
    /// that are not one of those places.
    private(set) var completions: [PlaceCompletion] = []
    /// The place each of the top results resolved to, so its row shows a distance and a pick
    /// needs no second lookup. A result that failed to resolve has none.
    private var resolved: [PlaceCompletion: PickedPlace] = [:]
    /// Why the last pick set nothing, cleared at the next edit.
    private(set) var failure: String?
    /// The suggestion being resolved, during which every other pick is ignored.
    private(set) var picking: PlaceCompletion?
    /// Set while Use current location waits for the device, during which every other pick is
    /// ignored.
    private(set) var isLocating = false
    var list: LocationList
    /// Set by Escape or Cancel, so the dismissal that follows writes nothing.
    private(set) var isDiscarded = false
    /// The venues near ``nearbyCenter``, nearest first; nil until the search answers, or for good
    /// when it fails or there is no center.
    private var venues: [NearbyPlace]?
    /// The device's position, read at opening for a recording with no point, and by Use current
    /// location.
    private var deviceFix: Coordinate?
    /// The recording's own coordinates as the editor opened, never the device's.
    private let ownPoint: Coordinate?
    /// Whether the recording was linked to a saved location as the editor opened.
    private let openedLinked: Bool

    /// The edit the picks stage in, which the editor reads the recording's location and the
    /// saved and recent locations from.
    @ObservationIgnored let edit: RecordingLocationEdit
    @ObservationIgnored private let makeSearch: @MainActor (Coordinate?) -> any PlaceSearching
    /// Made at the first search, and again when the hint moves, so a view rebuilt with a new
    /// model makes no search it drops.
    @ObservationIgnored private var madeSearch: (search: any PlaceSearching, near: Coordinate?)?
    @ObservationIgnored private let makeNearby: (@MainActor () -> any NearbySearch)?
    @ObservationIgnored private let access: LocationAccess?
    @ObservationIgnored private let device: (any LocationProvider)?
    @ObservationIgnored private let analytics: AnalyticsClient
    @ObservationIgnored private let distanceText: DistanceText
    /// The Nearby rows as last built, and what they were built from, since building them
    /// measures every row and matches every venue against the saved locations.
    @ObservationIgnored private var builtNearby: (from: NearbyInputs, rows: [NearbyEntry])?
    @ObservationIgnored private let openMaps: @MainActor (String?, Coordinate) -> Void
    @ObservationIgnored private let sleep: @MainActor (Duration) async throws -> Void
    /// The rename Settings > Saved locations uses, so it writes and reports the same way.
    @ObservationIgnored private lazy var renamer = SavedLocationsModel(store: edit.store, analytics: analytics)
    /// The pick started from a row that is still running, so leaving waits for it.
    @ObservationIgnored private var inFlight: Task<Void, Never>?

    /// - Parameters:
    ///   - search: Makes a place search that ranks results near the point it is given.
    ///   - device: Where the device is; nil leaves Use current location inert.
    init(
        edit: RecordingLocationEdit, search: @escaping @MainActor (Coordinate?) -> any PlaceSearching,
        nearby: (@MainActor () -> any NearbySearch)? = nil, locationAccess: LocationAccess? = nil,
        device: (any LocationProvider)? = nil, analytics: AnalyticsClient = .noop, locale: Locale = .current,
        openMaps: @escaping @MainActor (String?, Coordinate) -> Void = {
            CrosstuneUI.openInMaps(name: $0, coordinate: $1)
        },
        sleep: @escaping @MainActor (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.edit = edit
        makeSearch = search
        makeNearby = nearby
        access = locationAccess
        self.device = device
        self.analytics = analytics
        distanceText = DistanceText(locale: locale)
        self.openMaps = openMaps
        self.sleep = sleep
        ownPoint = edit.placeCoordinate
        openedLinked = edit.linkedPlace != nil || edit.storedLinkPoint != nil
        list = ownPoint != nil || openedLinked || locationAccess?.status == .allowed ? .nearby : .saved
    }

    /// Opens the editor on the recording as stored, with its saved and recent locations read;
    /// nil when the recording is gone, so the editor closes. ``start()`` then reads where the
    /// device is.
    ///
    /// - Parameters:
    ///   - placeSearch: The place search the editor's searches are made from.
    ///   - nearbySearch: The venue search Nearby is made from; nil leaves Nearby empty.
    static func open(
        recordingID: String, store: CrosstuneStore, placeSearch: any PlaceSearching.Type,
        nearbySearch: (any NearbySearch.Type)?, locationAccess: LocationAccess?, device: (any LocationProvider)?,
        analytics: AnalyticsClient
    ) async -> LocationEditorModel? {
        let read = try? await store.read { db in try Recording.fetchOne(db, key: recordingID) }
        guard let recording = read ?? nil, recording.deletedAt == nil else { return nil }
        let edit = RecordingLocationEdit(store: store, recording: recording, analytics: analytics)
        await edit.load()
        var makeNearby: (@MainActor () -> any NearbySearch)?
        if let nearbySearch { makeNearby = { nearbySearch.init() } }
        return LocationEditorModel(
            edit: edit, search: { placeSearch.init(near: $0) }, nearby: makeNearby, locationAccess: locationAccess,
            device: device, analytics: analytics)
    }

    /// Whether Use current location is inert: location access is off, or nothing reads where the
    /// device is.
    var isCurrentLocationOff: Bool { device == nil || access?.isOff == true }

    /// The recording's point as the editor opened: its own coordinates, else the point of the saved
    /// location it is linked to, never the device's.
    private var recordingPoint: Coordinate? { ownPoint ?? edit.storedLinkPoint }

    /// Where Nearby looks and distances count from: the recording's point, else the device's.
    private var nearbyCenter: Coordinate? { recordingPoint ?? deviceFix }

    /// The device's position, while location access allows reading it.
    private var allowedDeviceFix: Coordinate? { access?.status == .allowed ? deviceFix : nil }

    /// The point the search ranks results near.
    private var hint: Coordinate? {
        SearchHint.pick(
            recording: recordingPoint, device: allowedDeviceFix, latestPlaced: edit.latestPlaced,
            countryCenter: edit.countryCenter)
    }

    /// Where the pin map opens: the recording's point, the device's, the area of the typed search,
    /// the latest placed recording's, or the account country's center; nil for the whole world.
    var pinStart: Coordinate? {
        let searchArea = completions.lazy.compactMap { self.resolved[$0]?.place.coordinate }.first
        return PinStart.pick(
            recording: recordingPoint, device: allowedDeviceFix, searchArea: searchArea,
            latestPlaced: edit.latestPlaced, countryCenter: edit.countryCenter)
    }

    /// The saved locations within 150 m of the center and the venues not saved by
    /// ``SavedPlace/existing(for:in:)``'s rule, nearest first, at most 7 in all. Empty until the venue search
    /// answers, when it fails, and with no center.
    var nearby: [NearbyEntry] {
        guard let center = nearbyCenter, let venues else { return [] }
        let inputs = NearbyInputs(center: center, venues: venues, saved: edit.savedPlaces)
        if let builtNearby, builtNearby.from == inputs { return builtNearby.rows }
        let close = inputs.saved.map { (row: NearbyRow.saved($0), meters: meters(center, $0.point)) }
            .filter { $0.meters <= PlaceDistances.nearbyRadiusM }
        let unsaved = venues.filter { SavedPlace.existing(for: $0.draft, in: inputs.saved) == nil }
            .map { (row: NearbyRow.venue($0), meters: meters(center, NearbyRow.venue($0).point)) }
        let rows = (close + unsaved).sorted { $0.meters < $1.meters }.prefix(PlaceDistances.nearbyLimit)
            .map { NearbyEntry(row: $0.row, distance: distanceText.format(meters: $0.meters)) }
        builtNearby = (inputs, rows)
        return rows
    }

    private func meters(_ center: Coordinate, _ point: Coordinate) -> Double {
        PlaceDistances.meters(center, point.lat, point.lon)
    }

    /// How far `point` lies from the center, nil with no center or no point.
    func distance(to point: Coordinate?) -> String? {
        guard let center = nearbyCenter, let point else { return nil }
        return distanceText.format(meters: meters(center, point))
    }

    /// The point the place `completion` names, nil until it resolves.
    func point(of completion: PlaceCompletion) -> Coordinate? {
        resolved[completion]?.place.coordinate
    }

    /// The saved locations within 30 m of the place's point, nearest first, offered before a new
    /// name so reusing one is one tap.
    var namingCandidates: [SavedPlace] {
        guard let point = edit.placeCoordinate else { return [] }
        return edit.savedPlaces.map { ($0, PlaceDistances.meters(point, $0.lat, $0.lon)) }
            .filter { $0.1 <= PlaceDistances.matchRadiusM }.sorted { $0.1 < $1.1 }.map(\.0)
    }

    /// Whether `place` is the recording's place now. A captured place carries an accuracy that
    /// a place used before does not, so they compare by name and point alone.
    func isCurrent(_ place: RecordingPlace) -> Bool {
        edit.linkedPlace == nil && edit.place.map(RecordingSuggestions.picked) == RecordingSuggestions.picked(place)
    }

    /// Whether the recording is linked to `place` now.
    func isLinked(_ place: SavedPlace) -> Bool { edit.linkedPlace?.id == place.id }

    /// Whether the search field holds text, so its rows show in place of everything under it.
    var showsResults: Bool { !trimmedQuery.isEmpty }

    /// The saved locations whose name holds the typed text, by name.
    var savedMatches: [SavedPlace] {
        guard showsResults else { return [] }
        return edit.savedPlaces.filter { $0.name.localizedStandardContains(trimmedQuery) }
    }

    /// `local` then the suggestions that name none of its places.
    private static func merged(local: [PlaceCompletion], suggestions: [PlaceCompletion]) -> [PlaceCompletion] {
        guard !local.isEmpty else { return suggestions }
        let keys = local.map(SameKey.init)
        let titles = Set(keys.map(\.title))
        let titlesAlone = Set(keys.filter { $0.firstLine == nil }.map(\.title))
        let titledLines = Set(keys.filter { $0.firstLine != nil })
        return local
            + suggestions.filter { suggestion in
                let key = SameKey(suggestion)
                let isListed =
                    titlesAlone.contains(key.title)
                    || (key.firstLine == nil ? titles.contains(key.title) : titledLines.contains(key))
                return !isListed
            }
    }

    /// Whether two results name the same place: the same title, and the same first address line
    /// when both have one, in any case.
    static func isSame(_ one: PlaceCompletion, _ other: PlaceCompletion) -> Bool {
        let (mine, theirs) = (SameKey(one), SameKey(other))
        guard mine.title == theirs.title else { return false }
        guard let line = mine.firstLine, let otherLine = theirs.firstLine else { return true }
        return line == otherLine
    }

    private var search: any PlaceSearching {
        let near = hint
        if let madeSearch, madeSearch.near == near { return madeSearch.search }
        let made = makeSearch(near)
        madeSearch = (made, near)
        return made
    }

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var canPick: Bool { picking == nil && !isLocating }

    /// Reads the device's position for a recording with no point while access is on, then asks
    /// once for the venues near the center. With no center the lists open on Saved.
    func start() async {
        if recordingPoint == nil, access?.status == .allowed, let device {
            deviceFix = await device.currentLocation()
        }
        if nearbyCenter == nil, list == .nearby { list = .saved }
        await loadNearby()
    }

    /// Asks once for the venues near the center. A failure leaves Nearby empty and the rest of
    /// the editor as it is.
    private func loadNearby() async {
        guard let center = nearbyCenter, venues == nil, let makeNearby else { return }
        venues = try? await makeNearby().places(
            near: center, radiusM: PlaceDistances.nearbyRadiusM, limit: PlaceDistances.nearbyLimit)
    }

    /// Asks for the suggestions for the query as it is now.
    func refresh() async {
        let asked = query
        guard trimmedQuery.count >= Self.minimumQuery else {
            suggestions = []
            local = nil
            return
        }
        let searched = search
        let near = hint
        let found = await searched.completions(for: trimmedQuery)
        guard asked == query else { return }
        suggestions = found
        if let local, near != local.near || !trimmedQuery.lowercased().hasPrefix(local.query.lowercased()) {
            self.local = nil
        }
        // A cancelled wait means the text changed, and the next refresh takes over, so a fast
        // typist sends one full search per settled query.
        guard near != nil || nearbyCenter != nil, (try? await sleep(Self.settleDelay)) != nil, asked == query
        else { return }
        if near != nil {
            let places = await searched.localResults(for: trimmedQuery)
            guard !Task.isCancelled, asked == query else { return }
            for result in places { resolved[result.completion] = result.picked }
            local = LocalResults(results: places.map(\.completion), query: trimmedQuery, near: near)
        }
        if nearbyCenter != nil { await resolveTop(with: searched, asked: asked) }
    }

    /// Resolves the suggestions among the top rows through the search that found them, all at
    /// once, for the distance on their rows. The full search's places carry theirs already. A
    /// suggestion that fails to resolve shows none.
    private func resolveTop(with searched: any PlaceSearching, asked: String) async {
        let targets = completions.prefix(Self.resolvedResults).filter { resolved[$0] == nil }
        let lookups = targets.map { completion in Task { await searched.resolve(completion) } }
        await withTaskCancellationHandler {
            defer { for lookup in lookups { lookup.cancel() } }
            for (completion, lookup) in zip(targets, lookups) {
                let place = await lookup.value
                guard !Task.isCancelled, asked == query else { return }
                if let place { resolved[completion] = place }
            }
        } onCancel: {
            for lookup in lookups { lookup.cancel() }
        }
    }

    /// Resolves `completion` and stages it, which ends the search. True only for the pick that
    /// stages the location; false when it cannot be found, which sets nothing, or while another
    /// pick runs.
    func pick(_ completion: PlaceCompletion) async -> Bool {
        guard canPick else { return false }
        failure = nil
        picking = completion
        defer { picking = nil }
        let picked: PickedPlace?
        if let cached = resolved[completion] {
            picked = cached
        } else {
            picked = await (madeSearch?.search ?? search).resolve(completion)
        }
        guard !isDiscarded, !Task.isCancelled else { return false }
        guard let picked else {
            failure = PlaceSearchText.pickFailed
            return false
        }
        edit.pickSearch(picked)
        endSearch()
        return true
    }

    /// Stages the device's position with its accuracy. False while access is off, while another
    /// pick runs, or when the device gives no position.
    func useCurrentLocation() async -> Bool {
        guard canPick, !isCurrentLocationOff, let device else { return false }
        failure = nil
        isLocating = true
        defer { isLocating = false }
        let fix = await device.currentLocation()
        guard !isDiscarded, !Task.isCancelled else { return false }
        guard let fix else {
            failure = PlaceSearchText.noCurrentLocation
            return false
        }
        deviceFix = fix
        edit.useCurrentLocation(fix)
        endSearch()
        await loadNearby()
        return true
    }

    /// Stages a point picked on the pin map. False while another pick runs.
    func usePin(_ pin: DroppedPin) -> Bool {
        stage { edit.pickPin(pin) }
    }

    /// Stages a place used before. False while another pick runs.
    func pickRecent(_ place: RecordingPlace) -> Bool {
        stage { edit.setPlace(place, method: .suggestion) }
    }

    /// Stages a saved location or a venue near the recording.
    func pickNearby(_ row: NearbyRow) -> Bool {
        stage { edit.pickNearby(row) }
    }

    /// Stages a saved location from the list or a search.
    func pickSaved(_ place: SavedPlace) -> Bool {
        stage { edit.pickSaved(place) }
    }

    /// Stages one of the saved locations the naming sheet offers for the spot being named.
    func pickCandidate(_ place: SavedPlace) -> Bool {
        stage { edit.pickSaved(place, whileNaming: true) }
    }

    /// Saves the place's point under `name` once the edit is saved. False for a name that trims
    /// to nothing.
    func name(_ name: String) -> Bool {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return stage { edit.nameLocation(name) }
    }

    /// Renames the saved location the recording is linked to, for every recording linked to it.
    /// True once the new name is stored.
    func renameLinked(_ name: String) async -> Bool {
        guard let placeID = edit.linkedPlace?.id else { return false }
        return await renamer.rename(placeID, to: name)
    }

    /// Stages no location. False while another pick runs.
    func clear() -> Bool {
        stage { edit.clearPlace() }
    }

    /// Opens Apple Maps at the location. The event carries nothing of where it is.
    func openInMaps() {
        guard let point = edit.mapsPoint else { return }
        openMaps(edit.place?.name, point)
        analytics.locationOpenedInMaps()
    }

    /// Starts resolving and staging `completion`, which ``leave()`` waits for.
    func startPick(_ completion: PlaceCompletion) {
        track { _ = await self.pick(completion) }
    }

    /// Starts reading and staging the device's position, which ``leave()`` waits for.
    func startUsingCurrentLocation() {
        track { _ = await self.useCurrentLocation() }
    }

    /// Drops the staged pick and any pick still running, for Escape or Cancel: the editor
    /// writes nothing as it leaves.
    func discard() {
        isDiscarded = true
        inFlight?.cancel()
    }

    /// Writes the staged pick as the editor leaves, after any pick still running lands, unless
    /// it was discarded. Why the write failed, or nil when it landed or there was nothing to
    /// write.
    func leave() async -> String? {
        await inFlight?.value
        guard !isDiscarded, edit.isEdited else { return nil }
        return await edit.save() ? nil : edit.failure
    }

    /// Runs `work` as the pick in flight. A start while one runs is dropped, as the pick itself
    /// would refuse it, so ``leave()`` always waits for the pick that can land.
    private func track(_ work: @escaping @MainActor () async -> Void) {
        guard canPick, inFlight == nil else { return }
        inFlight = Task {
            await work()
            inFlight = nil
        }
    }

    private func stage(_ pick: () -> Void) -> Bool {
        guard canPick else { return false }
        pick()
        endSearch()
        return true
    }

    /// Empties the search, so the staged place shows.
    private func endSearch() {
        query = ""
        suggestions = []
        local = nil
        failure = nil
    }
}

/// A Nearby row with how far it lies from the center.
struct NearbyEntry: Hashable {
    let row: NearbyRow
    let distance: String

    var name: String { row.name }
}

/// What the Nearby rows are built from.
private struct NearbyInputs: Equatable {
    let center: Coordinate
    let venues: [NearbyPlace]
    let saved: [SavedPlace]
}

/// A result's title and first address line, trimmed and in lowercase, which two results naming
/// the same place share.
private struct SameKey: Hashable {
    let title: String
    let firstLine: String?

    init(_ completion: PlaceCompletion) {
        title = Self.key(Substring(completion.title))
        firstLine = completion.subtitle.split(separator: ",").first.map(Self.key).flatMap { $0.isEmpty ? nil : $0 }
    }

    private static func key(_ text: Substring) -> String {
        text.trimmingCharacters(in: .whitespaces).lowercased()
    }
}

/// The places a full search found, and what they answer: the trimmed query, which they outlast
/// while the text only grows from it, so a nearby place never drops out between keystrokes, and
/// the hint they were found near, so a moved hint never keeps them.
private struct LocalResults {
    let results: [PlaceCompletion]
    let query: String
    let near: Coordinate?
}
