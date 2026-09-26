import Foundation
import GRDB

/// The tables the API syncs, named as on the wire.
public enum SyncTable: String, CaseIterable, Codable, Sendable {
    case tunes
    case userTunes = "user_tunes"
    case lists
    case listItems = "list_items"
    case recordingLinks = "recording_links"
    case recordings
    case userSettings = "user_settings"
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
/// recording upload pipeline computes. The web client's `toChangeData` strips the same list.
let keysNotInChanges: Set<String> = ownershipKeys.union([
    "id", "updated_at", "deleted_at", "server_seq",
    "state", "duration_ms", "playback_mime", "playback_bytes", "error",
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
        case extra
    }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, tuneID: String, status: String,
        learnedFrom: String? = nil, learnedOn: String? = nil, notes: String? = nil,
        archivedAt: Timestamp? = nil, extra: JSONObject = [:]
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
    public var label: String?
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
        case title, label
        case artworkURL = "artwork_url"
        case position, extra
    }

    public static var wireDefaults: JSONObject { ["position": .integer(0)] }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, tuneID: String, url: String, provider: String,
        providerRef: String? = nil, title: String? = nil, label: String? = nil, artworkURL: String? = nil,
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
        self.label = label
        self.artworkURL = artworkURL
        self.position = position
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
    public var recordedAt: Timestamp
    public var label: String?
    public var position: Int
    /// The upload pipeline's fields: read here, never sent in a change.
    public var state: String
    public var durationMs: Int64?
    public var playbackMime: String?
    public var playbackBytes: Int64?
    public var error: String?
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case tuneID = "tune_id"
        case source
        case recordedAt = "recorded_at"
        case label, position, state
        case durationMs = "duration_ms"
        case playbackMime = "playback_mime"
        case playbackBytes = "playback_bytes"
        case error, extra
    }

    public static var wireDefaults: JSONObject { ["position": .integer(0)] }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, tuneID: String?, source: String,
        recordedAt: Timestamp, label: String? = nil, position: Int = 0, state: String = "pending_upload",
        durationMs: Int64? = nil, playbackMime: String? = nil, playbackBytes: Int64? = nil,
        error: String? = nil, extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.tuneID = tuneID
        self.source = source
        self.recordedAt = recordedAt
        self.label = label
        self.position = position
        self.state = state
        self.durationMs = durationMs
        self.playbackMime = playbackMime
        self.playbackBytes = playbackBytes
        self.error = error
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
    public var extra: JSONObject

    public enum CodingKeys: String, CodingKey, CaseIterable, ColumnExpression {
        case id
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case deletedAt = "deleted_at"
        case serverSeq = "server_seq"
        case audioQuality = "audio_quality"
        case instruments, extra
    }

    public static var wireDefaults: JSONObject {
        ["audio_quality": .string("standard"), "instruments": .array([])]
    }

    public init(
        id: String = newID(), createdAt: Timestamp = .now, updatedAt: Timestamp? = nil,
        deletedAt: Timestamp? = nil, serverSeq: Int64 = 0, audioQuality: String = "standard",
        instruments: [String] = [], extra: JSONObject = [:]
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.deletedAt = deletedAt
        self.serverSeq = serverSeq
        self.audioQuality = audioQuality
        self.instruments = instruments
        self.extra = extra
    }
}
