import CrosstuneAnalytics
import CrosstuneDesign
import CrosstuneStore
import Observation
import SwiftUI

/// The words the location page shows.
public enum PlaceSearchText {
    public static let current = "Current"
    public static let nearby = "Nearby"
    public static let saved = "Saved locations"
    public static let nameThisLocation = "Name this location…"
    public static let openInMaps = "Open in Maps"
    public static let searchLabel = "Search locations"
    public static let recent = "Recent locations"
    public static let noPlacesFound = "No locations found"
    public static let pickFailed = "Couldn’t find that location. Try another."

    /// A location row's accessible name, `Use <name>, <detail>`, a actionLabel first as the web's
    /// `pickLocationName` says it.
    public static func pick(_ name: String, detail: String?) -> String {
        guard let detail, !detail.isEmpty else { return "Use \(name)" }
        return "Use \(name), \(detail)"
    }
}

/// The location page's state over the edit sheet's: the recording's location now, the places
/// near it, the saved and recent locations, and the search. Every pick goes to the edit sheet,
/// which writes it on Save. Searching waits for two characters, and an answer to a query no
/// longer typed is dropped.
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
    /// Set once a location is picked or cleared, so nothing picks twice.
    private(set) var isDone = false
    /// The venues near the recording, nearest first; nil until the search answers, or for good when it
    /// fails or the recording has no point.
    private var venues: [NearbyPlace]?
    /// Where the page looks for places near the recording: the recording's own point as the page opened,
    /// never the device's.
    private let center: Coordinate?

    @ObservationIgnored private let edit: EditRecordingModel
    @ObservationIgnored private let makeSearch: @MainActor () -> any PlaceSearching
    /// Made at the first search, so a view rebuilt with a new model makes no search it drops.
    @ObservationIgnored private var madeSearch: (any PlaceSearching)?
    @ObservationIgnored private let makeNearby: (@MainActor () -> any NearbySearch)?
    @ObservationIgnored private let analytics: AnalyticsClient
    @ObservationIgnored private let openMaps: @MainActor (String?, Coordinate) -> Void

    init(
        edit: EditRecordingModel, search: @escaping @MainActor () -> any PlaceSearching,
        nearby: (@MainActor () -> any NearbySearch)? = nil, analytics: AnalyticsClient = .noop,
        openMaps: @escaping @MainActor (String?, Coordinate) -> Void = {
            CrosstuneUI.openInMaps(name: $0, coordinate: $1)
        }
    ) {
        self.edit = edit
        makeSearch = search
        makeNearby = nearby
        self.analytics = analytics
        self.openMaps = openMaps
        center = edit.placeCoordinate
    }

    /// The recording's location as the edit sheet holds it, read each time, so a name that
    /// syncs in, or a rename of its saved location, shows while the page is open.
    var current: RecordingPlace? { edit.place }
    var currentAddress: String? { edit.placeAddress }
    /// The point the map shows, nil when the recording has none.
    var mapCoordinate: Coordinate? { edit.placeCoordinate }
    var canClear: Bool { edit.canClearPlace }
    var canName: Bool { edit.canNamePlace }
    var canOpenInMaps: Bool { edit.mapsPoint != nil }
    var recent: [RecordingPlace] { edit.recentPlaces }
    var saved: [SavedPlace] { edit.savedPlaces }

    /// The saved locations within 150 m of the recording, nearest first, then the venues not saved by
    /// ``SavedPlace/existing(for:in:)``'s rule, at most 10 in all. Empty until the venue search answers, and when it fails.
    var nearby: [NearbyRow] {
        guard let center, let venues else { return [] }
        let close = saved.map { ($0, PlaceDistances.meters(center, $0.lat, $0.lon)) }
            .filter { $0.1 <= PlaceDistances.nearbyRadiusM }.sorted { $0.1 < $1.1 }.map(\.0)
        let unsaved = venues.filter { SavedPlace.existing(for: $0.draft, in: saved) == nil }
            .sorted { PlaceDistances.meters(center, $0.lat, $0.lon) < PlaceDistances.meters(center, $1.lat, $1.lon) }
        return Array((close.map(NearbyRow.saved) + unsaved.map(NearbyRow.venue)).prefix(PlaceDistances.nearbyLimit))
    }

    /// The saved locations within 30 m of the recording, nearest first, offered before a new name so
    /// reusing one is one tap.
    var namingCandidates: [SavedPlace] {
        guard let point = edit.placeCoordinate else { return [] }
        return saved.map { ($0, PlaceDistances.meters(point, $0.lat, $0.lon)) }
            .filter { $0.1 <= PlaceDistances.matchRadiusM }.sorted { $0.1 < $1.1 }.map(\.0)
    }

    /// Whether `place` is the recording's place now. A captured place carries an accuracy that
    /// a place used before does not, so they compare by name and point alone.
    func isCurrent(_ place: RecordingPlace) -> Bool {
        edit.linkedPlace == nil && current.map(RecordingSuggestions.picked) == RecordingSuggestions.picked(place)
    }

    /// Whether the recording is linked to `place` now.
    func isLinked(_ place: SavedPlace) -> Bool { edit.linkedPlace?.id == place.id }

    /// Whether the query is too short to search.
    var showsRecent: Bool { trimmedQuery.count < Self.minimumQuery }

    var foundNothing: Bool { !showsRecent && answered == query && completions.isEmpty }

    private var search: any PlaceSearching {
        if let madeSearch { return madeSearch }
        let made = makeSearch()
        madeSearch = made
        return made
    }

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var canPick: Bool { picking == nil && !isDone }

    func setQuery(_ query: String) {
        self.query = query
        failure = nil
    }

    /// Asks once for the venues near the recording. A failure leaves Nearby out and the rest of the
    /// page as it is.
    func loadNearby() async {
        guard let center, venues == nil, let makeNearby else { return }
        venues = try? await makeNearby().places(
            near: center, radiusM: PlaceDistances.nearbyRadiusM, limit: PlaceDistances.nearbyLimit)
    }

    /// Asks for the suggestions for the query as it is now.
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

    /// Resolves `completion` and picks it. True only for the pick that sets the location; false
    /// when it cannot be found, which sets nothing, or while another pick runs or after one landed.
    func pick(_ completion: PlaceCompletion) async -> Bool {
        guard canPick else { return false }
        failure = nil
        picking = completion
        defer { picking = nil }
        guard let picked = await search.resolve(completion) else {
            failure = PlaceSearchText.pickFailed
            return false
        }
        isDone = true
        edit.pickSearch(picked)
        return true
    }

    /// Picks a place used before. False while a search pick runs or after one landed.
    func pickRecent(_ place: RecordingPlace) -> Bool {
        finish { edit.setPlace(place, method: .suggestion) }
    }

    /// Picks a saved location or a venue near the recording.
    func pickNearby(_ row: NearbyRow) -> Bool {
        finish { edit.pickNearby(row) }
    }

    /// Picks a saved location from the list.
    func pickSaved(_ place: SavedPlace) -> Bool {
        finish { edit.pickSaved(place) }
    }

    /// Picks one of the saved locations the naming sheet offers for the spot being named.
    func pickCandidate(_ place: SavedPlace) -> Bool {
        finish { edit.pickSaved(place, whileNaming: true) }
    }

    /// Saves the recording's point under `name` once the edit is saved. False for a name that trims
    /// to nothing.
    func name(_ name: String) -> Bool {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return finish { edit.nameLocation(name) }
    }

    /// Clears the location. False while a pick runs or after one landed.
    func clear() -> Bool {
        finish { edit.clearPlace() }
    }

    /// Opens Apple Maps at the location. The event carries nothing of where it is.
    func openInMaps() {
        guard let point = edit.mapsPoint else { return }
        openMaps(current?.name, point)
        analytics.locationOpenedInMaps()
    }

    private func finish(_ pick: () -> Void) -> Bool {
        guard canPick else { return false }
        isDone = true
        pick()
        return true
    }
}

/// A recording's location page: a map of the spot, the location now with its actions, the
/// places near the recording, the saved and recent locations, and a search. Pushed inside the edit
/// sheet's navigation, and pops on a pick.
/// A recording's location page: a map of the spot, the location now with its actions, the
/// places near the recording, the saved and recent locations, and a search. Pushed inside the edit
/// sheet's navigation, and pops on a pick.
struct PlaceSearchView: View {
    @State private var model: PlaceSearchModel
    @State private var naming = false
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    init(
        edit: EditRecordingModel, search: @escaping @MainActor () -> any PlaceSearching,
        nearby: (any NearbySearch.Type)?, analytics: AnalyticsClient
    ) {
        var makeNearby: (@MainActor () -> any NearbySearch)?
        if let nearby { makeNearby = { nearby.init() } }
        _model = State(
            initialValue: PlaceSearchModel(edit: edit, search: search, nearby: makeNearby, analytics: analytics))
    }

    var body: some View {
        page
            .sheet(isPresented: $naming, onDismiss: { if model.isDone { dismiss() } }) {
                NameLocationSheet(
                    candidates: model.namingCandidates, onPick: { _ = model.pickCandidate($0) },
                    onName: { _ = model.name($0) })
            }
            .task(id: model.query) { await model.refresh() }
            .task { await model.loadNearby() }
            .onAppear {
                // With no location to show, the search is the page's first thing.
                if !model.canClear { focused = true }
            }
    }

    private var searchField: some View {
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
        #if os(macOS)
            .labelsHidden()
            .textFieldStyle(.macField)
        #endif
        .autocorrectionDisabled()
        .focused($focused)
    }

    /// A row that picks a location, with a checkmark when it is the recording's now.
    private func locationButton(
        name: String, address: String?, isCurrent: Bool, pick: @escaping () -> Bool
    ) -> some View {
        Button {
            if pick() { dismiss() }
        } label: {
            LocationRow(name: name, address: address, isCurrent: isCurrent)
        }
        #if os(macOS)
            .buttonStyle(.macPickRow)
        #else
            .buttonStyle(.plain)
        #endif
        .disabled(model.picking != nil)
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }

    private func nearbyButton(_ row: NearbyRow) -> some View {
        let isCurrent = if case .saved(let place) = row { model.isLinked(place) } else { false }
        return locationButton(name: row.name, address: row.address, isCurrent: isCurrent) {
            model.pickNearby(row)
        }
    }

    private func savedButton(_ place: SavedPlace) -> some View {
        locationButton(name: place.name, address: place.address, isCurrent: model.isLinked(place)) {
            model.pickSaved(place)
        }
    }

    private func recentButton(_ place: RecordingPlace) -> some View {
        locationButton(name: place.name, address: nil, isCurrent: model.isCurrent(place)) {
            model.pickRecent(place)
        }
    }

    private func resultButton(_ completion: PlaceCompletion) -> some View {
        Button {
            Task { if await model.pick(completion) { dismiss() } }
        } label: {
            HStack(spacing: 8) {
                #if os(macOS)
                    MacPickGlyph(kind: .none)
                #endif
                VStack(alignment: .leading, spacing: LocationRow.lineSpacing) {
                    Text(completion.title)
                        .contentMask()
                    if !completion.subtitle.isEmpty {
                        Text(completion.subtitle)
                            .contentMask()
                            .font(.platform(.body, mac: .secondary))
                            .foregroundStyle(.textSecondary)
                    }
                }
                #if os(macOS)
                    .padding(.vertical, 4)
                #endif
                Spacer(minLength: 0)
                if model.picking == completion {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(PlaceSearchText.pick(completion.title, detail: completion.subtitle))
        }
        #if os(macOS)
            .buttonStyle(.macPickRow)
        #else
            .buttonStyle(.plain)
        #endif
        .disabled(model.picking != nil)
    }

    #if os(macOS)
        /// Drawn on the edit sheet's scaffold, with Back in the cancel slot so Escape pops it. The
        /// lists show before a search as a picker's catalog does, and the results replace them.
        private var page: some View {
            MacSheet(
                title: EditRecordingText.place, size: EditRecordingSheet.macSize,
                cancel: .cancel(FindRecordingsSheet.back) { dismiss() }, primary: nil
            ) {
                MacFormScroll {
                    if let coordinate = model.mapCoordinate {
                        LocationMap(coordinate: coordinate, accuracyM: coordinate.accuracyM)
                            .clipShape(.rect(cornerRadius: MacForm.cardRadius))
                    }
                    if model.canClear {
                        macCurrentSection
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        searchField
                        if let failure = model.failure { FailureText(failure) }
                    }
                    if model.showsRecent {
                        macList(PlaceSearchText.nearby, model.nearby, id: \.self, row: nearbyButton)
                        macList(PlaceSearchText.saved, model.saved, id: \.id, row: savedButton)
                        macList(PlaceSearchText.recent, model.recent, id: \.self, row: recentButton)
                    } else {
                        VStack(alignment: .leading, spacing: 2) {
                            if model.foundNothing {
                                Text(PlaceSearchText.noPlacesFound)
                                    .font(MacStyle.body)
                                    .foregroundStyle(Palette.textSecondary)
                                    .padding(.horizontal, 8)
                            }
                            ForEach(model.completions, id: \.self, content: resultButton)
                        }
                    }
                    MacLocationAccessNote()
                }
            }
            .toolbar(.hidden)
            .navigationBarBackButtonHidden()
        }

        /// The location now, then its actions on a row of their own.
        private var macCurrentSection: some View {
            MacFormSection(PlaceSearchText.current) {
                if let current = model.current {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(current.name)
                            .contentMask()
                            .font(MacStyle.body)
                            .foregroundStyle(Palette.textPrimary)
                        if let address = model.currentAddress {
                            Text(address)
                                .contentMask()
                                .font(MacStyle.secondary)
                                .foregroundStyle(Palette.textSecondary)
                        }
                    }
                    .lineLimit(1)
                    .padding(.vertical, 4)
                }
                HStack(spacing: 8) {
                    if model.canName {
                        Button(PlaceSearchText.nameThisLocation) { naming = true }
                            .buttonStyle(.mac(.secondary, size: .small))
                            .disabled(model.picking != nil)
                    }
                    if model.canOpenInMaps {
                        Button(PlaceSearchText.openInMaps) { model.openInMaps() }
                            .buttonStyle(.mac(.secondary, size: .small))
                    }
                    Spacer(minLength: 8)
                    Button(EditRecordingText.clearPlace) {
                        if model.clear() { dismiss() }
                    }
                    .buttonStyle(.mac(.plain, size: .small))
                    .disabled(model.picking != nil)
                }
            }
        }

        @ViewBuilder private func macList<Item, ID: Hashable, Row: View>(
            _ title: String, _ items: [Item], id: KeyPath<Item, ID>, row: @escaping (Item) -> Row
        ) -> some View {
            if !items.isEmpty {
                MacFormSection(title, card: false) {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(items, id: id, content: row)
                    }
                }
            }
        }
    #else
        private var page: some View {
            GroupedForm {
                if let coordinate = model.mapCoordinate {
                    Section {
                        LocationMap(coordinate: coordinate, accuracyM: coordinate.accuracyM)
                            .listRowInsets(EdgeInsets())
                    }
                }
                if model.canClear {
                    currentSection
                }
                listSection(PlaceSearchText.nearby, model.nearby, id: \.self, row: nearbyButton)
                listSection(PlaceSearchText.saved, model.saved, id: \.id, row: savedButton)
                listSection(PlaceSearchText.recent, model.recent, id: \.self, row: recentButton)
                Section {
                    searchField
                } footer: {
                    if let failure = model.failure {
                        Text(failure)
                            .foregroundStyle(Palette.danger)
                    }
                }
                if !model.showsRecent {
                    Section {
                        if model.foundNothing {
                            Text(PlaceSearchText.noPlacesFound)
                                .foregroundStyle(.textSecondary)
                        }
                        ForEach(model.completions, id: \.self, content: resultButton)
                    }
                }
                LocationAccessSection()
            }
            .navigationTitle(EditRecordingText.place)
        }

        private var currentSection: some View {
            Section(PlaceSearchText.current) {
                if let current = model.current {
                    VStack(alignment: .leading) {
                        Text(current.name)
                            .contentMask()
                        if let address = model.currentAddress {
                            Text(address)
                                .contentMask()
                                .foregroundStyle(.textSecondary)
                        }
                    }
                }
                if model.canName {
                    Button(PlaceSearchText.nameThisLocation) { naming = true }
                        .disabled(model.picking != nil)
                }
                if model.canOpenInMaps {
                    Button(PlaceSearchText.openInMaps) { model.openInMaps() }
                }
                Button(EditRecordingText.clearPlace) {
                    if model.clear() { dismiss() }
                }
                .disabled(model.picking != nil)
            }
        }

        @ViewBuilder private func listSection<Item, ID: Hashable, Row: View>(
            _ title: String, _ items: [Item], id: KeyPath<Item, ID>, row: @escaping (Item) -> Row
        ) -> some View {
            if !items.isEmpty {
                Section(title) {
                    ForEach(items, id: id, content: row)
                }
            }
        }
    #endif
}

/// A location to pick: its name, the address under it when there is one, and a mark when it is
/// the recording's now. On the Mac the mark leads in a picker's glyph slot; on iPhone and iPad a
/// checkmark trails.
struct LocationRow: View {
    let name: String
    let address: String?
    let isCurrent: Bool

    /// The gap between a name and its address: tight on the Mac's small type, the stack's own on
    /// iPhone and iPad.
    static var lineSpacing: CGFloat? {
        #if os(macOS)
            1
        #else
            nil
        #endif
    }

    var body: some View {
        HStack(spacing: 8) {
            #if os(macOS)
                MacPickGlyph(kind: isCurrent ? .done : .none)
            #endif
            VStack(alignment: .leading, spacing: Self.lineSpacing) {
                Text(name)
                    .contentMask()
                if let address {
                    Text(address)
                        .contentMask()
                        .font(.platform(.body, mac: .secondary))
                        .foregroundStyle(.textSecondary)
                }
            }
            #if os(macOS)
                .lineLimit(1)
                .padding(.vertical, address == nil ? 0 : 4)
            #endif
            Spacer(minLength: 0)
            #if os(iOS)
                if isCurrent {
                    Image(systemName: "checkmark")
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)
                }
            #endif
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(PlaceSearchText.pick(name, detail: address))
    }
}
