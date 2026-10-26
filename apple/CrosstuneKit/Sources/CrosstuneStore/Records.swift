import Foundation
import GRDB

/// The tables sync carries, named as on the wire: the synced tables, the entitlements row the
/// server writes and the client only pulls, then the insert-only event tables, whose rows the
/// sync pull never carries.
public enum SyncTable: String, CaseIterable, Codable, Sendable {
    case tunes
    case userTunes = "user_tunes"
    case lists
    case listItems = "list_items"
    case recordingLinks = "recording_links"
    case places
    case recordings
    case scans
    case recordingLoops = "recording_loops"
    case userSettings = "user_settings"
    case entitlements
    case playEvents = "play_events"
    case practiceSessions = "practice_sessions"
    case scanViews = "scan_views"

    /// Whether this is an insert-only event table. A queued event row never schedules a sync,
    /// and sign-out drops one still unsent.
    public var isEvent: Bool {
        switch self {
        case .playEvents, .practiceSessions, .scanViews: true
        case .tunes, .userTunes, .lists, .listItems, .recordingLinks, .places, .recordings, .scans,
            .recordingLoops, .userSettings, .entitlements:
            false
        }
    }

    public static let eventTables = allCases.filter(\.isEvent)

    /// The tables whose new rows the server takes only from a Premium account. A refused upsert
    /// is kept local until subscribed rather than reported.
    public static let premiumOnly: Set<SyncTable> = [.recordings, .scans]

    /// The tables whose rows name a recording in `recording_id`, which the server refuses while
    /// it does not have that recording.
    public static let recordingDependents: [SyncTable] = [.recordingLoops, .playEvents, .practiceSessions]
}

/// A local copy of a server row, without its ownership keys, which the server sets from the
/// token.
///
/// Vocabulary fields are plain strings, because a pulled row may carry a value from an API
/// newer than this build. `extra` holds every field of the server row this build does not
/// know, so an edit sends it back unchanged.
public protocol SyncedRecord: Codable, Sendable, Identifiable, FetchableRecord, PersistableRecord
where ID == String {
    associatedtype CodingKeys: CodingKey, CaseIterable
    static var table: SyncTable { get }
    /// The value a field takes when the server's row omits it, keyed by wire name. Covers only
    /// fields the API contract itself declares a default for; every other absent field is
    /// simply optional and decodes to `nil`.
    static var wireDefaults: JSONObject { get }
    var id: String { get }
    var updatedAt: Timestamp { get set }
    var deletedAt: Timestamp? { get set }
    var extra: JSONObject { get set }
}

extension SyncedRecord {
    public static var databaseTableName: String { table.rawValue }
    public static var wireDefaults: JSONObject { [:] }

    public static func databaseJSONEncoder(for column: String) -> JSONEncoder {
        let encoder = JSONEncoder()
        // Stable JSON text, so an unchanged value never looks like a change to observers.
        encoder.outputFormatting = .sortedKeys
        return encoder
    }

    /// Builds a record from a decoded server row object: drops the ownership the server sets
    /// from the token, fills a field the row omits with the contract's declared default, and
    /// keeps every field this build does not model in `extra`.
    public init(wire row: JSONObject) throws {
        var fields = row
        for key in ownershipKeys { fields.removeValue(forKey: key) }

        let known = Set(Self.CodingKeys.allCases.map(\.stringValue))
        var extra: JSONObject = [:]
        for (key, value) in fields where !known.contains(key) {
            extra[key] = value
        }

        for (key, value) in Self.wireDefaults where fields[key] == nil {
            fields[key] = value
        }
        fields["extra"] = .object(extra)

        self = try JSONDecoder().decode(Self.self, from: JSONEncoder().encode(fields))
    }
}

/// Ownership the server sets from the token: a pulled row never keeps it locally, and an edit
/// never sends it back.
let ownershipKeys: Set<String> = ["owner_user_id", "user_id", "added_by_user_id"]

/// Keys a change never carries: bookkeeping the server owns, ownership, and the fields the
/// recording and scan upload pipelines compute. The web client's `toChangeData` strips the
/// same list.
let keysNotInChanges: Set<String> = ownershipKeys.union([
    "id", "updated_at", "deleted_at", "server_seq",
    "state", "duration_ms", "playback_mime", "playback_bytes", "error",
    "source_duration_ms", "playback_start_ms", "playback_end_ms", "playback_rev", "peaks_rev",
    "file_bytes",
])

extension SyncedRecord {
    /// The client-editable fields of this row, the only thing a pushed upsert carries: every
    /// known field, null included, merged over `extra`.
    public func changeData() throws -> JSONObject {
        var data = extra
        let known = try JSONDecoder().decode(JSONObject.self, from: JSONEncoder().encode(self))
        for key in Self.CodingKeys.allCases.map(\.stringValue) where key != "extra" {
            data[key] = known[key] ?? .null
        }
        for key in keysNotInChanges { data[key] = nil }
        return data
    }
}

public struct Tune: SyncedRecord, Hashable {
    public static let table = SyncTable.tunes

    public var id: String
    public var createdAt: Timestamp
    public var updatedAt: Timestamp
    public var deletedAt: Timestamp?
    public var serverSeq: Int64
    public var title: String
    public var alternateTitles: [String]
    public var composer: String?
    public var genre: String?
    public var tuneType: String?
    public var key: String?
    public var modes: [String]
    public var timeSignature: String?
    public var partStructure: String?
    public var isCrooked: Bool
    public var lyrics: String?
    public var tunings: JSONObject
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case title
        case alternateTitles = "alternate_titles"
        case composer, genre
        case tuneType = "tune_type"
        case key, modes
        case timeSignature = "time_signature"
        case partStructure = "part_structure"
        case isCrooked = "is_crooked"
        case lyrics, tunings, extra
    }

    public static var wireDefaults: JSONObject {
        ["alternate_titles": .array([]), "is_crooked": .bool(false), "tunings": .object([:])]
    }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, title: String, alternateTitles: [String] = [],
        composer: String? = nil, genre: String? = nil, tuneType: String? = nil, key: String? = nil,
        modes: [String] = [], timeSignature: String? = nil, partStructure: String? = nil,
        isCrooked: Bool = false, lyrics: String? = nil, tunings: JSONObject = [:], extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.title = title
        self.alternateTitles = alternateTitles
        self.composer = composer
        self.genre = genre
        self.tuneType = tuneType
        self.key = key
        self.modes = modes
        self.timeSignature = timeSignature
        self.partStructure = partStructure
        self.isCrooked = isCrooked
        self.lyrics = lyrics
        self.tunings = tunings
        self.extra = extra
    }
}

public struct UserTune: SyncedRecord, Hashable {
    public static let table = SyncTable.userTunes

    public var id: String
    public var createdAt: Timestamp
    public var updatedAt: Timestamp
    public var deletedAt: Timestamp?
    public var serverSeq: Int64
    public var tuneID: String
    public var status: String
    public var learnedFrom: String?
    /// A calendar date, `YYYY-MM-DD`, with no time or zone.
    public var learnedOn: String?
    public var notes: String?
    public var archivedAt: Timestamp?
    /// The recording that plays first in a list. At most one of the two pins is set. A pin
    /// counts only while its row exists under this tune.
    public var playRecordingID: String?
    public var playLinkID: String?
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case tuneID = "tune_id"
        case status
        case learnedFrom = "learned_from"
        case learnedOn = "learned_on"
        case notes
        case archivedAt = "archived_at"
        case playRecordingID = "play_recording_id"
        case playLinkID = "play_link_id"
        case extra
    }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, tuneID: String, status: String,
        learnedFrom: String? = nil, learnedOn: String? = nil, notes: String? = nil,
        archivedAt: Timestamp? = nil, playRecordingID: String? = nil, playLinkID: String? = nil,
        extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.tuneID = tuneID
        self.status = status
        self.learnedFrom = learnedFrom
        self.learnedOn = learnedOn
        self.notes = notes
        self.archivedAt = archivedAt
        self.playRecordingID = playRecordingID
        self.playLinkID = playLinkID
        self.extra = extra
    }
}

public struct TuneList: SyncedRecord, Hashable {
    public static let table = SyncTable.lists

    public var id: String
    public var createdAt: Timestamp
    public var updatedAt: Timestamp
    public var deletedAt: Timestamp?
    public var serverSeq: Int64
    public var name: String
    public var position: Int
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case name, position, extra
    }

    public static var wireDefaults: JSONObject { ["position": .integer(0)] }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, name: String, position: Int = 0,
        extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.name = name
        self.position = position
        self.extra = extra
    }
}

public struct ListItem: SyncedRecord, Hashable {
    public static let table = SyncTable.listItems

    public var id: String
    public var createdAt: Timestamp
    public var updatedAt: Timestamp
    public var deletedAt: Timestamp?
    public var serverSeq: Int64
    public var listID: String
    public var userTuneID: String
    public var position: Int
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case listID = "list_id"
        case userTuneID = "user_tune_id"
        case position, extra
    }

    public static var wireDefaults: JSONObject { ["position": .integer(0)] }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, listID: String, userTuneID: String,
        position: Int = 0, extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.listID = listID
        self.userTuneID = userTuneID
        self.position = position
        self.extra = extra
    }
}

public struct RecordingLink: SyncedRecord, Hashable {
    public static let table = SyncTable.recordingLinks

    public var id: String
    public var createdAt: Timestamp
    public var updatedAt: Timestamp
    public var deletedAt: Timestamp?
    public var serverSeq: Int64
    public var tuneID: String
    public var url: String
    public var provider: String
    public var providerRef: String?
    public var title: String?
    public var artworkURL: String?
    public var position: Int
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case tuneID = "tune_id"
        case url, provider
        case providerRef = "provider_ref"
        case title
        case artworkURL = "artwork_url"
        case position, extra
    }

    public static var wireDefaults: JSONObject { ["position": .integer(0)] }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, tuneID: String, url: String, provider: String,
        providerRef: String? = nil, title: String? = nil, artworkURL: String? = nil,
        position: Int = 0, extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.tuneID = tuneID
        self.url = url
        self.provider = provider
        self.providerRef = providerRef
        self.title = title
        self.artworkURL = artworkURL
        self.position = position
        self.extra = extra
    }
}

/// A stretch of a recording's audio the player repeats, in milliseconds on the source timeline.
public struct RecordingLoop: SyncedRecord, Hashable {
    public static let table = SyncTable.recordingLoops

    public var id: String
    public var createdAt: Timestamp
    public var updatedAt: Timestamp
    public var deletedAt: Timestamp?
    public var serverSeq: Int64
    public var recordingID: String
    public var label: String?
    public var startMs: Int64
    public var endMs: Int64
    public var color: Int
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case recordingID = "recording_id"
        case label
        case startMs = "start_ms"
        case endMs = "end_ms"
        case color, extra
    }

    public static var wireDefaults: JSONObject { [:] }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, recordingID: String, label: String? = nil,
        startMs: Int64, endMs: Int64, color: Int, extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.recordingID = recordingID
        self.label = label
        self.startMs = startMs
        self.endMs = endMs
        self.color = color
        self.extra = extra
    }
}

/// How much of a recording's recorded date is known. A partial date is stored as UTC midnight
/// at the start of its year, month, or day.
public enum RecordingPrecision: String, CaseIterable, Codable, Sendable {
    case year, month, day, time
}

/// A location the user saved: a name for a point, which recordings can link to. A recording keeps its own
/// coordinates, so a saved place's point moving never moves a recording.
public struct SavedPlace: SyncedRecord, Hashable {
    public static let table = SyncTable.places

    public var id: String
    public var createdAt: Timestamp
    public var updatedAt: Timestamp
    public var deletedAt: Timestamp?
    public var serverSeq: Int64
    public var name: String
    public var lat: Double
    public var lon: Double
    /// The street address or town line shown under the name.
    public var address: String?
    /// The identifier Apple Maps gave the place, kept so it can be opened there again.
    public var applePlaceID: String?
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case name, lat, lon, address
        case applePlaceID = "apple_place_id"
        case extra
    }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, name: String, lat: Double, lon: Double,
        address: String? = nil, applePlaceID: String? = nil, extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.name = name
        self.lat = lat
        self.lon = lon
        self.address = address
        self.applePlaceID = applePlaceID
        self.extra = extra
    }
}

public struct Recording: SyncedRecord, Hashable {
    public static let table = SyncTable.recordings

    public var id: String
    public var createdAt: Timestamp
    public var updatedAt: Timestamp
    public var deletedAt: Timestamp?
    public var serverSeq: Int64
    public var tuneID: String?
    public var source: String
    /// Where the recording came from: `own`, or the import source's name.
    public var origin: String
    /// The page an imported recording came from.
    public var originURL: String?
    /// When the recording was added to the library. Fixed once the server has the row.
    public var addedAt: Timestamp
    /// When the music was played, nil when unknown. Set exactly when `recordedPrecision` is.
    public var recordedAt: Timestamp?
    /// How much of `recordedAt` is known, as a ``RecordingPrecision`` raw value.
    public var recordedPrecision: String?
    public var label: String?
    public var position: Int
    /// The upload pipeline's fields: read here, never sent in a change.
    public var state: String
    public var durationMs: Int64?
    public var playbackMime: String?
    public var playbackBytes: Int64?
    public var error: String?
    /// The trim and re-encode pipeline's fields: read here, never sent in a change.
    public var sourceDurationMs: Int64?
    public var playbackStartMs: Int64?
    public var playbackEndMs: Int64?
    public var playbackRev: String?
    public var peaksRev: String?
    public var trimStartMs: Int64
    public var trimEndMs: Int64?
    public var speedPercent: Int
    public var pitchCents: Int
    public var notes: String?
    public var players: String?
    /// Where it was played. The coordinates are set together; `placeAccuracyM` only for a
    /// captured fix. See ``place``.
    public var placeName: String?
    public var placeLat: Double?
    public var placeLon: Double?
    public var placeAccuracyM: Int?
    /// The saved location the recording is linked to, if any. The link never changes how the
    /// coordinates were obtained, which `placeOrigin` records.
    public var placeID: String?
    /// How the coordinates were obtained, as a ``PlaceOrigin`` raw value; nil exactly when
    /// there are no coordinates.
    public var placeOrigin: String?
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case tuneID = "tune_id"
        case source, origin
        case originURL = "origin_url"
        case addedAt = "added_at"
        case recordedAt = "recorded_at"
        case recordedPrecision = "recorded_precision"
        case label, position, state
        case durationMs = "duration_ms"
        case playbackMime = "playback_mime"
        case playbackBytes = "playback_bytes"
        case error
        case sourceDurationMs = "source_duration_ms"
        case playbackStartMs = "playback_start_ms"
        case playbackEndMs = "playback_end_ms"
        case playbackRev = "playback_rev"
        case peaksRev = "peaks_rev"
        case trimStartMs = "trim_start_ms"
        case trimEndMs = "trim_end_ms"
        case speedPercent = "speed_percent"
        case pitchCents = "pitch_cents"
        case notes, players
        case placeName = "place_name"
        case placeLat = "place_lat"
        case placeLon = "place_lon"
        case placeAccuracyM = "place_accuracy_m"
        case placeID = "place_id"
        case placeOrigin = "place_origin"
        case extra
    }

    public static var wireDefaults: JSONObject {
        [
            "origin": .string("own"), "position": .integer(0), "trim_start_ms": .integer(0),
            "trim_end_ms": .null, "speed_percent": .integer(100), "pitch_cents": .integer(0),
        ]
    }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, tuneID: String?, source: String,
        origin: String = "own", originURL: String? = nil, addedAt: Timestamp? = nil,
        recordedAt: Timestamp? = nil, recordedPrecision: String? = nil, label: String? = nil,
        position: Int = 0, state: String = "pending_upload",
        durationMs: Int64? = nil, playbackMime: String? = nil, playbackBytes: Int64? = nil,
        error: String? = nil, sourceDurationMs: Int64? = nil, playbackStartMs: Int64? = nil,
        playbackEndMs: Int64? = nil, playbackRev: String? = nil, peaksRev: String? = nil,
        trimStartMs: Int64 = 0, trimEndMs: Int64? = nil, speedPercent: Int = 100, pitchCents: Int = 0,
        notes: String? = nil, players: String? = nil, placeName: String? = nil, placeLat: Double? = nil,
        placeLon: Double? = nil, placeAccuracyM: Int? = nil, placeID: String? = nil, placeOrigin: String? = nil,
        extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.tuneID = tuneID
        self.source = source
        self.origin = origin
        self.originURL = originURL
        self.addedAt = addedAt ?? createdAt
        self.recordedAt = recordedAt
        self.recordedPrecision = recordedPrecision
        self.label = label
        self.position = position
        self.state = state
        self.durationMs = durationMs
        self.playbackMime = playbackMime
        self.playbackBytes = playbackBytes
        self.error = error
        self.sourceDurationMs = sourceDurationMs
        self.playbackStartMs = playbackStartMs
        self.playbackEndMs = playbackEndMs
        self.playbackRev = playbackRev
        self.peaksRev = peaksRev
        self.trimStartMs = trimStartMs
        self.trimEndMs = trimEndMs
        self.speedPercent = speedPercent
        self.pitchCents = pitchCents
        self.notes = notes
        self.players = players
        self.placeName = placeName
        self.placeLat = placeLat
        self.placeLon = placeLon
        self.placeAccuracyM = placeAccuracyM
        self.placeID = placeID
        self.placeOrigin = placeOrigin
        self.extra = extra
    }

    /// The named place, nil unless the name and both coordinates are set. A coordinate alone,
    /// as a capture stores it, is not shown.
    public var place: RecordingPlace? {
        guard let placeName, let placeLat, let placeLon else { return nil }
        return RecordingPlace(
            name: placeName, coordinate: Coordinate(lat: placeLat, lon: placeLon, accuracyM: placeAccuracyM))
    }

    /// The precision of `recordedAt`, nil when the date is unknown or carries a precision newer
    /// than this build.
    public var precision: RecordingPrecision? { recordedPrecision.flatMap(RecordingPrecision.init) }

    /// When the music was played and how much of it is known, nil when unknown. A precision newer
    /// than this build reads as unknown, so sorting and display agree on which dates they trust.
    public var knownRecordedDate: (at: Timestamp, precision: RecordingPrecision)? {
        guard let recordedAt, let precision else { return nil }
        return (recordedAt, precision)
    }
}

/// One image attached to a tune: written music, a lyric sheet, or notes. Its file lives on the
/// device as a ``ScanFile``.
public struct ScanRecord: SyncedRecord, Hashable {
    public static let table = SyncTable.scans

    public var id: String
    public var createdAt: Timestamp
    public var updatedAt: Timestamp
    public var deletedAt: Timestamp?
    public var serverSeq: Int64
    public var tuneID: String
    public var position: Int
    /// The image's size in pixels, so a scan lays out before its file is on the device.
    public var width: Int
    public var height: Int
    /// The upload pipeline's fields: read here, never sent in a change.
    public var state: String
    public var fileBytes: Int64?
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case tuneID = "tune_id"
        case position, width, height, state
        case fileBytes = "file_bytes"
        case extra
    }

    public static let pendingUpload = "pending_upload"
    public static let ready = "ready"

    public static var wireDefaults: JSONObject { ["position": .integer(0)] }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, tuneID: String, position: Int = 0, width: Int,
        height: Int, state: String = pendingUpload, fileBytes: Int64? = nil, extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.tuneID = tuneID
        self.position = position
        self.width = width
        self.height = height
        self.state = state
        self.fileBytes = fileBytes
        self.extra = extra
    }
}

public struct UserSettings: SyncedRecord, Hashable {
    public static let table = SyncTable.userSettings

    public var id: String
    public var createdAt: Timestamp
    public var updatedAt: Timestamp
    public var deletedAt: Timestamp?
    public var serverSeq: Int64
    public var audioQuality: String
    public var instruments: [String]
    /// The services a tune's recording search covers. Plain strings, like every vocabulary
    /// field, so a service from a newer API survives this build's writes.
    public var searchProviders: [String]
    /// Which version a list plays when a tune has both and none is pinned. One of
    /// ``Vocabulary/playFirsts``; kept as a plain string like every vocabulary field.
    public var playFirst: String
    /// The genre a new tune starts with; nil starts it with none.
    public var newTuneGenre: String?
    /// The status a new tune starts with. One of ``Vocabulary/statuses``, kept as a plain string
    /// like every vocabulary field.
    public var newTuneStatus: String
    /// The frequency the tuner takes A4 to be, in hertz.
    public var tunerA4Hz: Int
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case tunerA4Hz = "tuner_a4_hz"
        case audioQuality = "audio_quality"
        case searchProviders = "search_providers"
        case playFirst = "play_first"
        case newTuneGenre = "new_tune_genre"
        case newTuneStatus = "new_tune_status"
        case instruments, extra
    }

    /// Every searchable service, in the order results group: services that play inline, then
    /// search-only ones. What a user who never chose searches.
    public static let defaultSearchProviders = [
        "apple_music", "tidal", "internet_archive", "slippery_hill", "youtube", "spotify", "bandcamp", "soundcloud",
    ]

    public static let playFirstRecordings = "recordings"
    public static let playFirstAppleMusic = "apple_music"
    public static let defaultPlayFirst = playFirstRecordings
    public static let defaultNewTuneStatus = "want_to_learn"
    public static let defaultTunerA4Hz = 440

    public static var wireDefaults: JSONObject {
        [
            "audio_quality": .string("standard"), "instruments": .array([]),
            "search_providers": .array(defaultSearchProviders.map(JSONValue.string)),
            "play_first": .string(defaultPlayFirst), "new_tune_genre": .null,
            "new_tune_status": .string(defaultNewTuneStatus), "tuner_a4_hz": .integer(Int64(defaultTunerA4Hz)),
        ]
    }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, audioQuality: String = "standard",
        instruments: [String] = [], searchProviders: [String] = defaultSearchProviders,
        playFirst: String = defaultPlayFirst, newTuneGenre: String? = nil,
        newTuneStatus: String = defaultNewTuneStatus, tunerA4Hz: Int = defaultTunerA4Hz,
        extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.audioQuality = audioQuality
        self.instruments = instruments
        self.searchProviders = searchProviders
        self.playFirst = playFirst
        self.newTuneGenre = newTuneGenre
        self.newTuneStatus = newTuneStatus
        self.tunerA4Hz = tunerA4Hz
        self.extra = extra
    }
}

/// One store's subscription on the entitlements row, judged against the clock as the reported
/// grant is.
public struct PaidGrant: Codable, Hashable, Sendable {
    /// `apple` or `stripe`.
    public var source: String
    public var expiresAt: Timestamp?
    public var autoRenews: Bool

    public init(source: String, expiresAt: Timestamp? = nil, autoRenews: Bool = false) {
        self.source = source
        self.expiresAt = expiresAt
        self.autoRenews = autoRenews
    }

    enum CodingKeys: String, CodingKey {
        case source
        case expiresAt = "expires_at"
        case autoRenews = "auto_renews"
    }
}

/// What the account's grants allow, as the server resolved them: one row per user, pulled and
/// stored, never written here and never pushed. ``Plan`` judges it against the device clock.
public struct Entitlement: SyncedRecord, Hashable {
    public static let table = SyncTable.entitlements
    public static var wireDefaults: JSONObject { ["paid_grants": .array([])] }

    public var id: String
    public var createdAt: Timestamp
    public var updatedAt: Timestamp
    public var deletedAt: Timestamp?
    public var serverSeq: Int64
    /// Where the reported Premium grant came from: `trial`, `apple`, `stripe`, or `comp`. Nil
    /// when no Premium grant was live when the row was written.
    public var premiumSource: String?
    /// When the reported grant ends, nil when it never does.
    public var premiumExpiresAt: Timestamp?
    public var autoRenews: Bool
    /// When the account's trial began, nil when it never had one.
    public var trialStartsAt: Timestamp?
    public var trialEndsAt: Timestamp?
    public var premiumQuotaBytes: Int64
    /// Each store's longest live paid grant, which the reported grant alone can hide.
    public var paidGrants: [PaidGrant]
    public var recordingNoticeSeenAt: Timestamp?
    public var trialReminderSeenAt: Timestamp?
    public var trialEndSeenAt: Timestamp?
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case premiumSource = "premium_source"
        case premiumExpiresAt = "premium_expires_at"
        case autoRenews = "auto_renews"
        case trialStartsAt = "trial_starts_at"
        case trialEndsAt = "trial_ends_at"
        case premiumQuotaBytes = "premium_quota_bytes"
        case paidGrants = "paid_grants"
        case recordingNoticeSeenAt = "recording_notice_seen_at"
        case trialReminderSeenAt = "trial_reminder_seen_at"
        case trialEndSeenAt = "trial_end_seen_at"
        case extra
    }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, premiumSource: String? = nil,
        premiumExpiresAt: Timestamp? = nil, autoRenews: Bool = false, trialStartsAt: Timestamp? = nil,
        trialEndsAt: Timestamp? = nil, premiumQuotaBytes: Int64,
        paidGrants: [PaidGrant] = [], recordingNoticeSeenAt: Timestamp? = nil, trialReminderSeenAt: Timestamp? = nil,
        trialEndSeenAt: Timestamp? = nil, extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.premiumSource = premiumSource
        self.premiumExpiresAt = premiumExpiresAt
        self.autoRenews = autoRenews
        self.trialStartsAt = trialStartsAt
        self.trialEndsAt = trialEndsAt
        self.premiumQuotaBytes = premiumQuotaBytes
        self.paidGrants = paidGrants
        self.recordingNoticeSeenAt = recordingNoticeSeenAt
        self.trialReminderSeenAt = trialReminderSeenAt
        self.trialEndSeenAt = trialEndSeenAt
        self.extra = extra
    }
}
