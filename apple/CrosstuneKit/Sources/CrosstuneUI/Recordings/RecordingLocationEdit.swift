import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneDesign
import CrosstuneStore
import Foundation
import GRDB
import Observation
import os

/// The saved location a fix links: one saved already, or one made on Save with how it came to be.
enum SavedLink: Sendable {
    case existing(SavedPlace)
    case create(SavedPlaceDraft, made: SavedLocationMethod)
}

/// A location picked in the location editor, held until Save.
enum StagedPlace: Sendable {
    /// No location, coordinates and all.
    case cleared
    /// A place used before, or one set by hand, linked to no saved location.
    case place(RecordingPlace)
    /// A search result, with the saved location it makes when it is a venue or a street address.
    case search(RecordingPlace, saving: SavedPlaceDraft?)
    /// A saved location that exists already, linked over the place picked before it, whose point
    /// the recording moves to, or over the recording's own point when `over` is nil. `saving` is the search
    /// result's own saved location, made should the linked one go.
    case link(SavedPlace, over: RecordingPlace?, saving: SavedPlaceDraft? = nil)
    /// A saved location made on Save and then linked, with how it came to be, over the place
    /// picked before it as for ``link(_:over:)``.
    case create(SavedPlaceDraft, made: SavedLocationMethod, over: RecordingPlace?)
    /// A point with no name of its own, named by the server unless it links a saved location: the
    /// device's position with its accuracy, or a point picked on a map.
    case fix(Coordinate, link: SavedLink?, kind: Fix)

    /// Where a ``fix(_:link:kind:)`` came from.
    enum Fix: Sendable {
        case device
        case pin
    }

    /// The place picked here whose point the recording moves to, nil when it keeps its own or
    /// moves to the device's.
    var pending: RecordingPlace? {
        switch self {
        case .place(let place), .search(let place, _): place
        case .link(_, let over, _), .create(_, _, let over): over
        case .cleared, .fix: nil
        }
    }

    /// How the saved location this pick makes came to be, nil when it makes none.
    var made: SavedLocationMethod? {
        switch self {
        case .search(_, let saving): saving == nil ? nil : .search
        case .create(_, let made, _): made
        case .fix(_, .create(_, let made), _): made
        case .cleared, .place, .link, .fix: nil
        }
    }
}

/// A recording's location as the location editor edits it, and the one save it makes. A location
/// picked here, and any saved location the pick makes, is written only on ``save()``, and only
/// when it changed, so a location left alone keeps its captured accuracy. The save writes the
/// location alone, so an edit to another field that syncs in meanwhile survives it.
@MainActor
@Observable
public final class RecordingLocationEdit {
    public let recordingID: String
    /// The location picked or cleared here, nil while the recording's own is kept.
    private var stagedPick: StagedPlace?
    /// How the location was picked, nil until one is or once it is cleared.
    public private(set) var placeMethod: PlaceMethod?
    /// The recording as stored, followed so a name or a link that syncs in while the edit is
    /// open shows.
    private let stored: LiveQuery<Recording?>
    /// The live saved locations, followed so a rename on another device shows; nil until read.
    private let saved: LiveQuery<SavedPlaces?>
    /// The places on the musician's recordings, this one's included, most recent first; empty
    /// until ``load()``.
    public private(set) var recentPlaces: [RecordingPlace] = []
    /// The point of the musician's latest recording with one, nil until ``load()`` or with none.
    public private(set) var latestPlaced: Coordinate?
    /// A point inside the account's country, nil until ``load()`` or while the country is unknown.
    public private(set) var countryCenter: Coordinate?
    /// The saved locations as ``load()`` read them, by id.
    private var loadedByID: [String: SavedPlace] = [:]
    public private(set) var isSaving = false
    /// Set once a save lands, so a second press saves nothing more.
    public private(set) var isSaved = false
    /// The last save's failure, cleared at the next edit.
    public private(set) var failure: String?

    let store: CrosstuneStore
    private let analytics: AnalyticsClient
    private let recording: Recording
    private let now: () -> Timestamp
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "recording-location")

    /// `now` stamps the save.
    public init(
        store: CrosstuneStore, recording: Recording, now: @escaping () -> Timestamp = { .now },
        analytics: AnalyticsClient = .noop
    ) {
        self.store = store
        self.analytics = analytics
        self.recording = recording
        self.now = now
        recordingID = recording.id
        let id = recording.id
        stored = LiveQuery(store, initial: recording) { db in try Recording.fetchOne(db, key: id) }
        saved = LiveQuery(store, initial: nil) { db in
            SavedPlaces(try SavedPlace.fetchAll(db).filter { $0.deletedAt == nil })
        }
    }

    /// The recording as it is in the store, or as opened once it is gone.
    private var current: Recording { stored.value ?? recording }

    private var savedByID: [String: SavedPlace] { saved.value?.byID ?? [:] }

    /// The live saved locations, by name.
    public var savedPlaces: [SavedPlace] { saved.value?.byName ?? [] }

    /// The pick held for Save. A link to a saved location deleted meanwhile falls back to the
    /// place it was picked over, with the location that search pick makes, or to no pick, so the
    /// recording's own location shows and saves. A fix keeps its point and drops the link.
    private var staged: StagedPlace? {
        guard fellBack else { return stagedPick }
        switch stagedPick {
        case .link(_, let over, let saving): return over.map { .search($0, saving: saving) }
        case .fix(let point, _, let kind): return .fix(point, link: nil, kind: kind)
        default: return stagedPick
        }
    }

    /// Whether the staged link names a saved location deleted meanwhile.
    private var fellBack: Bool {
        let linked: SavedPlace? =
            switch stagedPick {
            case .link(let place, _, _), .fix(_, .existing(let place), _): place
            default: nil
            }
        guard let linked, let live = saved.value else { return false }
        return live.byID[linked.id] == nil
    }

    /// Where the recording will be once saved, with the fix's accuracy: the point picked here, else its
    /// own.
    private func recordingPoint(_ staged: StagedPlace?) -> Coordinate? {
        if case .fix(let point, _, _) = staged { return point }
        if let pending = staged?.pending { return pending.coordinate }
        return current.placePoint
    }

    /// The saved location the recording is linked to, as stored or as picked here, read live.
    public var linkedPlace: SavedPlace? { linkedPlace(staged) }

    private func linkedPlace(_ staged: StagedPlace?) -> SavedPlace? {
        switch staged {
        case nil: current.placeID.flatMap { savedByID[$0] }
        case .link(let place, _, _), .fix(_, .existing(let place), _):
            savedByID[place.id] ?? place
        case .cleared, .place, .search, .create, .fix: nil
        }
    }

    /// The location to show and save: its name and the point it marks. A linked recording
    /// shows its saved location's name, read once the saved locations are, so its own name never
    /// flashes first.
    public var place: RecordingPlace? {
        let staged = staged
        switch staged {
        case nil:
            guard let point = recordingPoint(staged), current.placeID == nil || saved.value != nil,
                let name = shownPlaceName(current, places: savedByID)
            else { return nil }
            return RecordingPlace(name: name, coordinate: point)
        case .cleared:
            return nil
        case .place(let place), .search(let place, _):
            return place
        case .link:
            guard let live = linkedPlace(staged) else { return nil }
            return RecordingPlace(name: live.name, coordinate: recordingPoint(staged) ?? live.point)
        case .create(let draft, _, _):
            return RecordingPlace(
                name: draft.name, coordinate: recordingPoint(staged) ?? Coordinate(lat: draft.lat, lon: draft.lon))
        case .fix(let point, .existing, _):
            return linkedPlace(staged).map { RecordingPlace(name: $0.name, coordinate: point) }
        case .fix(let point, .create(let draft, _), _):
            return RecordingPlace(name: draft.name, coordinate: point)
        case .fix(_, nil, _):
            // The server names the spot once the edit syncs.
            return nil
        }
    }

    /// The line under the location's name: a saved location's address, when it says more than
    /// the name does.
    public var placeAddress: String? {
        let staged = staged
        let address: String? =
            switch staged {
            case nil, .link, .fix(_, .existing, _): linkedPlace(staged)?.address
            case .create(let draft, _, _), .fix(_, .create(let draft, _), _): draft.address
            case .cleared, .place, .search, .fix(_, nil, _): nil
            }
        return address == place?.name ? nil : address
    }

    /// The point the map shows, with the recording's accuracy, named or not. Nil with no location.
    public var placeCoordinate: Coordinate? { placeCoordinate(staged) }

    private func placeCoordinate(_ staged: StagedPlace?) -> Coordinate? {
        switch staged {
        case nil: recordingPoint(staged)
        case .cleared: nil
        case .place(let place), .search(let place, _): place.coordinate
        case .link(let place, _, _): recordingPoint(staged) ?? place.point
        case .create(let draft, _, _): recordingPoint(staged) ?? Coordinate(lat: draft.lat, lon: draft.lon)
        case .fix(let point, _, _): point
        }
    }

    /// The point of the saved location the recording is stored as linked to, nil when it is linked to
    /// none. Read from the places loaded by ``load()`` while the followed ones are not read yet.
    var storedLinkPoint: Coordinate? {
        guard let id = current.placeID else { return nil }
        return (savedByID[id] ?? loadedByID[id])?.point
    }

    /// Where Open in Maps goes: the saved location's own point when the recording is linked to
    /// one, else the recording's.
    public var mapsPoint: Coordinate? {
        let staged = staged
        if let linked = linkedPlace(staged) { return linked.point }
        switch staged {
        case .create(let draft, _, _), .fix(_, .create(let draft, _), _):
            return Coordinate(lat: draft.lat, lon: draft.lon)
        default: break
        }
        return placeCoordinate(staged).map { Coordinate(lat: $0.lat, lon: $0.lon) }
    }

    /// Whether Clear has a location to clear: a named one, or coordinates with no name yet.
    public var canClearPlace: Bool { placeCoordinate != nil }

    /// Whether the point is precise enough to save under a typed name, so a vague fix never
    /// becomes a saved location that pulls in its neighbors.
    public var canNamePlace: Bool {
        linkedPlace == nil && (placeCoordinate.map { PlaceDistances.isPrecise(accuracyM: $0.accuracyM) } ?? false)
    }

    /// Whether the place is a saved location, which is renamed rather than named again.
    public var canRenamePlace: Bool { linkedPlace != nil }

    /// Reads the recent locations from the store. A failed read leaves them empty. The saved
    /// locations are read here too, since the followed ones may not have been read yet, and a
    /// recent place linked to one is left out.
    public func load() async {
        let read = try? await store.read { db in
            let live = Recording.filter(Recording.CodingKeys.deletedAt == nil)
            let placed = live.filter(Recording.CodingKeys.placeLat != nil && Recording.CodingKeys.placeLon != nil)
            return (
                named: try placed.filter(Recording.CodingKeys.placeName != nil).fetchAll(db),
                latest: try placed.order(Recording.CodingKeys.addedAt.desc).fetchOne(db),
                places: try SavedPlace.fetchAll(db),
                countryCenter: try MetaKey.countryCenter.value(in: db, as: Coordinate?.self) ?? nil
            )
        }
        guard let read else { return }
        let byID = Dictionary(read.places.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        loadedByID = byID.filter { $0.value.deletedAt == nil }
        recentPlaces = RecordingSuggestions.recentPlaces(read.named, saved: byID)
        latestPlaced = read.latest?.placePoint.map { Coordinate(lat: $0.lat, lon: $0.lon) }
        countryCenter = read.countryCenter
    }

    /// Whether the edit holds a location change that is not saved.
    public var isEdited: Bool {
        guard let staged else { return false }
        let stored = current
        switch staged {
        case .cleared:
            return stored.placeLat != nil || stored.placeLon != nil || stored.placeName != nil
        case .place(let place):
            return stored.placeID != nil
                || stored.place.map(RecordingSuggestions.picked) != RecordingSuggestions.picked(place)
        case .link(let place, let over, _):
            return over != nil || stored.placeID != place.id
        case .search, .create, .fix:
            return true
        }
    }

    /// Sets a place used before, or one given by hand, and how it was picked.
    public func setPlace(_ place: RecordingPlace, method: PlaceMethod) {
        stage(.place(place), method: method)
    }

    /// Sets a search result, which saves its venue or street address as a location on Save. A
    /// location saved already is linked rather than saved twice.
    public func pickSearch(_ picked: PickedPlace) {
        if let saving = picked.saving, let existing = SavedPlace.existing(for: saving, in: saved.value?.live ?? []) {
            stage(.link(existing, over: picked.place, saving: saving), method: .search)
        } else {
            stage(.search(picked.place, saving: picked.saving), method: .search)
        }
    }

    /// Sets the device's position, `point`, with its accuracy, linked to the one saved location
    /// at that spot as a captured recording is. With none, or a fix too loose to match, the server
    /// names the spot.
    public func useCurrentLocation(_ point: Coordinate) {
        let near = (saved.value?.live ?? []).filter {
            PlaceDistances.meters(point, $0.lat, $0.lon) <= PlaceDistances.matchRadiusM
        }
        let link = PlaceDistances.isPrecise(accuracyM: point.accuracyM) && near.count == 1 ? near.first : nil
        stage(.fix(point, link: link.map(SavedLink.existing), kind: .device), method: .currentLocation)
    }

    /// Sets a point picked on a map, with no accuracy, named by its street address when the
    /// server gave one, else named by the server once the edit syncs. A typed name saves the
    /// point as a location on Save, with the server's whole address under it, and links the
    /// recording.
    func pickPin(_ pin: DroppedPin) {
        let point = pin.coordinate
        let draft = pin.savedName.map {
            SavedPlaceDraft(
                name: $0, address: pin.address ?? pin.name, lat: point.lat, lon: point.lon, applePlaceID: nil)
        }
        let staged: StagedPlace
        if let name = pin.name {
            let place = RecordingPlace(name: name, coordinate: point)
            staged = draft.map { .create($0, made: .custom, over: place) } ?? .search(place, saving: nil)
        } else {
            staged = .fix(point, link: draft.map { .create($0, made: .custom) }, kind: .pin)
        }
        stage(staged, method: .pin)
    }

    /// Links a place near the recording. A venue not yet saved is saved at its own point on Save, and
    /// the recording keeps its own coordinates.
    func pickNearby(_ row: NearbyRow) {
        switch row {
        case .saved(let place):
            stage(linking(.existing(place)) { .link(place, over: $0) }, method: .nearby)
        case .venue(let venue):
            stage(
                linking(.create(venue.draft, made: .nearby)) { .create(venue.draft, made: .nearby, over: $0) },
                method: .nearby)
        }
    }

    /// Links a saved location. From the saved list the recording keeps its own coordinates; while
    /// naming, it moves to the point picked here, as the name would.
    public func pickSaved(_ place: SavedPlace, whileNaming: Bool = false) {
        let staged = whileNaming ? linking(.existing(place)) { .link(place, over: $0) } : .link(place, over: nil)
        stage(staged, method: .saved)
    }

    /// A link made over the pick staged now: over a fix it keeps that point and its accuracy,
    /// else `over` builds it on the place picked before.
    private func linking(_ link: SavedLink, over: (RecordingPlace?) -> StagedPlace) -> StagedPlace {
        if case .fix(let point, _, let kind) = staged { return .fix(point, link: link, kind: kind) }
        return over(staged?.pending)
    }

    /// Saves `name` as a new location at the recording's own point on Save, with the recording's own street
    /// address under it, and links this recording alone. A name that trims to nothing does nothing.
    /// A place picked here keeps how it was picked, since naming it keeps its point.
    public func nameLocation(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let point = placeCoordinate else { return }
        let street = streetLine
        let draft = SavedPlaceDraft(
            name: trimmed, address: street == trimmed ? nil : street, lat: point.lat, lon: point.lon,
            applePlaceID: nil)
        stage(
            linking(.create(draft, made: .custom)) { .create(draft, made: .custom, over: $0) },
            method: placeMethod ?? .saved)
    }

    /// The street address line of where the recording will be, nil when it is not known: a name the
    /// server gave the recording's own fix, or the address of the saved location or search result
    /// picked. A name picked by hand, such as `Venue, street, town`, is not one.
    private var streetLine: String? {
        let staged = staged
        switch staged {
        case nil:
            let origin = current.placeOrigin.flatMap(PlaceOrigin.init(rawValue:))
            if origin == .device || origin == .file, let own = current.placeName { return own }
            return linkedPlace(staged)?.address
        case .search(let place, _) where placeMethod == .pin:
            // A pin is named by its street address.
            return place.name
        case .search(let place, let saving):
            // A street address result saves under its own address line, with no address under it.
            return saving.flatMap { $0.address ?? ($0.name == place.name ? $0.name : nil) }
        case .link, .fix(_, .existing, _):
            return linkedPlace(staged)?.address
        case .create(let draft, _, _), .fix(_, .create(let draft, _), _):
            return draft.address
        case .cleared, .place, .fix(_, nil, _):
            return nil
        }
    }

    public func clearPlace() {
        stagedPick = .cleared
        placeMethod = nil
        failure = nil
    }

    private func stage(_ place: StagedPlace, method: PlaceMethod) {
        stagedPick = place
        placeMethod = method
        failure = nil
    }

    /// Saves the location when it changed, in one write with any saved location the pick makes.
    /// True once the save lands, or when there is nothing to save, a recording deleted meanwhile
    /// included: that writes nothing and fails nothing.
    public func save() async -> Bool {
        guard !isSaving, !isSaved else { return false }
        guard isEdited else { return true }
        let time = now()
        isSaving = true
        failure = nil
        defer { isSaving = false }
        let recordingID = recordingID
        let staged = self.staged
        // A link fallen back writes the search pick under it, so the event names that.
        let method: PlaceMethod? =
            switch (fellBack, staged) {
            case (true, .search): .search
            default: placeMethod
            }
        let replaced = current.place != nil || current.placeID != nil
        // A place set by hand, or none, is written as the recording's own; every other pick links.
        let handPlace: RecordingPlace?? =
            switch staged {
            case .cleared: .some(nil)
            case .place(let place): .some(RecordingSuggestions.picked(place))
            case nil, .search, .link, .create, .fix: nil
            }
        do {
            let created: Bool? = try await store.write { writer in
                guard let live = try Recording.fetchOne(writer.db, key: recordingID), live.deletedAt == nil else {
                    return nil
                }
                if let handPlace {
                    try writer.updateRecording(recordingID, place: .value(handPlace), at: time)
                    return false
                }
                return try Self.link(recordingID, to: staged, method: method, in: writer, at: time)
            }
            isSaved = true
            guard let created else { return true }
            if let staged {
                if case .cleared = staged {
                    analytics.recordingPlaceCleared(recording)
                } else if let method {
                    analytics.recordingPlaceSet(recording, method: method, replaced: replaced)
                }
                if created, let made = staged.made { analytics.savedLocationCreated(made) }
            }
            return true
        } catch {
            Self.logger.warning("A location edit failed: \(error)")
            failure = failureMessage(error)
            return false
        }
    }

    /// Writes a pick that links a saved location, making the location first when the pick does.
    /// True when it made one. A location saved already, by ``SavedPlace/existing(for:in:)``, is
    /// linked rather than saved twice, checked here since the saved locations may have changed, or
    /// not been read, since the pick.
    nonisolated private static func link(
        _ recordingID: String, to staged: StagedPlace?, method: PlaceMethod?, in writer: StoreWriter,
        at time: Timestamp
    ) throws -> Bool {
        func linked(_ place: SavedPlace, over: RecordingPlace?) -> PlacePick {
            // A link over a place picked here moves the recording to that place's point, as a search
            // pick does; otherwise the recording keeps its own.
            if let over { return .search(RecordingSuggestions.picked(over), savedPlaceID: place.id) }
            return method == .nearby ? .nearby(place) : .saved(place)
        }
        func create(_ draft: SavedPlaceDraft) throws -> SavedPlace {
            try writer.createSavedPlace(
                name: draft.name, lat: draft.lat, lon: draft.lon, address: draft.address,
                applePlaceID: draft.applePlaceID, at: time)
        }
        func savedAlready(_ draft: SavedPlaceDraft) throws -> SavedPlace? {
            SavedPlace.existing(for: draft, in: try SavedPlace.fetchAll(writer.db))
        }
        switch staged {
        case .search(let place, let saving):
            let existing = try saving.flatMap(savedAlready)
            let made = existing == nil ? try saving.map(create) : nil
            try writer.setRecordingPlace(
                recordingID, pick: .search(RecordingSuggestions.picked(place), savedPlaceID: (existing ?? made)?.id),
                at: time)
            return made != nil
        case .link(let place, let over, _):
            try writer.setRecordingPlace(recordingID, pick: linked(place, over: over), at: time)
            return false
        case .create(let draft, _, let over):
            let saved = try savedAlready(draft)
            try writer.setRecordingPlace(recordingID, pick: linked(try saved ?? create(draft), over: over), at: time)
            return saved == nil
        case .fix(let point, let link, let kind):
            var saved: SavedPlace?
            var made = false
            switch link {
            case .existing(let place):
                saved = place
            case .create(let draft, _):
                saved = try savedAlready(draft)
                if saved == nil {
                    saved = try create(draft)
                    made = true
                }
            case nil:
                break
            }
            let pick: PlacePick =
                switch kind {
                case .device: .current(point, savedPlaceID: saved?.id)
                case .pin: .point(point, savedPlaceID: saved?.id)
                }
            try writer.setRecordingPlace(recordingID, pick: pick, at: time)
            return made
        case nil, .cleared, .place:
            return false
        }
    }
}

/// The live saved locations as read, indexed once per read rather than on each use.
private struct SavedPlaces: Sendable {
    /// In the store's order.
    let live: [SavedPlace]
    let byName: [SavedPlace]
    let byID: [String: SavedPlace]

    init(_ live: [SavedPlace]) {
        self.live = live
        byName = live.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        byID = Dictionary(live.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }
}
