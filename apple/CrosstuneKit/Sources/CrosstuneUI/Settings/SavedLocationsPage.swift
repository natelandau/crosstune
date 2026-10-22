import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import GRDB
import SwiftUI

/// The words of Settings > Saved locations.
enum SavedLocationsText {
    static let title = "Saved locations"
    static let help = "Locations you have named. A recording made at one shows its name instead of its address."
    static let emptyTitle = "No saved locations"
    static let emptyHint =
        "Open a recording's location and choose \"\(NameLocationText.title)\", or pick a nearby place."
    static let nameLabel = "Name"
    static let nameHelp = "Recordings at this location show this name."
    static let delete = "Delete"
    static let deleteLocation = "Delete location"
    static let deleteMessage = "Its recordings keep their location and show their street address."
    static let gone = "Location not found"

    static func recordingsCount(_ count: Int) -> String {
        count == 1 ? "1 recording" : "\(count) recordings"
    }

    /// `Delete "Town Hall"?`
    static func deleteTitle(_ name: String) -> String {
        "Delete \"\(name)\"?"
    }
}

/// A saved location and the live recordings linked to it.
struct SavedLocationRow: Hashable, Sendable, Identifiable {
    let place: SavedPlace
    let recordings: Int

    var id: String { place.id }
}

/// The saved locations, sorted by name, and the two things Settings does with one: rename and delete.
/// Neither event carries any part of the location.
@MainActor
@Observable
final class SavedLocationsModel {
    /// Nil until the first read.
    var rows: [SavedLocationRow]? { query.value }
    /// Why the last rename or delete failed, cleared by the next one.
    private(set) var failure: String?
    /// The location a Delete confirmation is open for.
    private(set) var pendingDelete: String?

    private let store: CrosstuneStore
    private let analytics: AnalyticsClient
    @ObservationIgnored private var lastRename: Task<Bool, Never>?
    @ObservationIgnored private let query: LiveQuery<[SavedLocationRow]?>

    init(store: CrosstuneStore, analytics: AnalyticsClient = .noop) {
        self.store = store
        self.analytics = analytics
        query = LiveQuery(store, initial: nil) { db in
            let places = try SavedPlace.fetchAll(db).filter { $0.deletedAt == nil }
            let counted = try Row.fetchAll(
                db,
                sql: """
                    SELECT place_id, COUNT(*) AS n FROM recordings
                    WHERE deleted_at IS NULL AND place_id IS NOT NULL GROUP BY place_id
                    """)
            let counts = Dictionary(
                counted.map { ($0["place_id"] as String, $0["n"] as Int) }, uniquingKeysWith: { first, _ in first })
            return
                places
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                .map { SavedLocationRow(place: $0, recordings: counts[$0.id] ?? 0) }
        }
    }

    func clearFailure() {
        failure = nil
    }

    /// Saves `name` as the location's name. A name that trims and cuts to what is stored writes
    /// nothing and reports nothing, so a name committed twice in a row is saved once. Calls run
    /// one at a time.
    /// Returns whether the stored name now matches.
    func rename(_ placeID: String, to name: String) async -> Bool {
        failure = nil
        let previous = lastRename
        let task = Task { [self] in
            _ = await previous?.value
            return await save(placeID, name: name)
        }
        lastRename = task
        return await task.value
    }

    private func save(_ placeID: String, name: String) async -> Bool {
        let cleanName = savedPlaceName(name)
        let store = store
        do {
            let stored = try await store.read { db in try SavedPlace.fetchOne(db, key: placeID) }
            if let stored, stored.deletedAt == nil, stored.name == cleanName { return true }
            try await Commands(store: store).renameSavedPlace(placeID, name: name)
        } catch {
            failure = failureMessage(error)
            return false
        }
        analytics.send(.savedLocationRenamed)
        return true
    }

    /// Asks to delete a location. Nothing is deleted until ``confirmDelete()``.
    func askDelete(_ placeID: String) {
        pendingDelete = placeID
    }

    func cancelDelete() {
        pendingDelete = nil
    }

    /// Deletes the location asked about, and nothing without a prior ask.
    @discardableResult
    func confirmDelete() -> Task<Bool, Never> {
        guard let placeID = pendingDelete else { return Task { false } }
        pendingDelete = nil
        return Task { await delete(placeID) }
    }

    func delete(_ placeID: String) async -> Bool {
        failure = nil
        let store = store
        do {
            try await Commands(store: store).deleteSavedPlace(placeID)
        } catch {
            failure = failureMessage(error)
            return false
        }
        analytics.send(.savedLocationDeleted)
        return true
    }
}

/// A row of the page opens the location with this id.
struct SavedLocationRoute: Hashable {
    let id: String
}

/// Settings > Saved locations: each saved location with a thumbnail, its name and address, and
/// how many recordings use it. A row opens the location.
struct SavedLocationsPage: View {
    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @State private var model: SavedLocationsModel?

    var body: some View {
        Form {
            if let model, let rows = model.rows, !rows.isEmpty {
                Section {
                    ForEach(rows) { row in
                        NavigationLink(value: SavedLocationRoute(id: row.id)) {
                            SavedLocationRowView(row: row)
                        }
                    }
                } header: {
                    SettingsHelp(SavedLocationsText.help)
                }
            }
        }
        .formStyle(.grouped)
        .overlay {
            if model?.rows?.isEmpty == true {
                ContentUnavailableView {
                    Label(SavedLocationsText.emptyTitle, systemImage: SettingsCategory.savedLocations.systemImage)
                } description: {
                    Text(SavedLocationsText.emptyHint)
                }
            }
        }
        .navigationDestination(for: SavedLocationRoute.self) { route in
            if let model { SavedLocationDetail(model: model, placeID: route.id) }
        }
        .navigationTitle(SavedLocationsText.title)
        .task(id: store.map(ObjectIdentifier.init)) {
            model = store.map { SavedLocationsModel(store: $0, analytics: analytics) }
        }
    }
}

private struct SavedLocationRowView: View {
    let row: SavedLocationRow

    var body: some View {
        HStack(spacing: 12) {
            LocationThumbnail(coordinate: Coordinate(lat: row.place.lat, lon: row.place.lon), accuracyM: nil)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.place.name).contentMask()
                if let address = row.place.address {
                    Text(address)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .contentMask()
                }
                Text(SavedLocationsText.recordingsCount(row.recordings))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
