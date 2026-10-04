import CrosstuneStore

// Keys are snake_case so the shared fixtures in fixtures/stats decode as they do on the web. Each
// row type names only the fields stats reads.

/// Everything stats reads: the device's local day and zone, and the local rows.
public struct StatsInput: Codable, Sendable {
    /// The device's local date, `YYYY-MM-DD`.
    public var today: String
    /// An IANA zone; every instant is read as a local date in it.
    public var timeZone: String
    /// The instruments the musician plays, in the order their tunings show.
    public var instruments: [String]
    public var tunes: [Tune]
    public var userTunes: [UserTune]
    public var recordings: [Recording]
    public var recordingLinks: [Row]
    public var lists: [Row]
    public var scans: [Scan]
    public var scanViews: [ScanView]
    public var playEvents: [PlayEvent]
    public var practiceSessions: [PracticeSession]
    public var statusChanges: [StatusChange]

    enum CodingKeys: String, CodingKey {
        case today, instruments, tunes, recordings, lists, scans
        case timeZone = "time_zone"
        case userTunes = "user_tunes"
        case recordingLinks = "recording_links"
        case scanViews = "scan_views"
        case playEvents = "play_events"
        case practiceSessions = "practice_sessions"
        case statusChanges = "status_changes"
    }

    public init(
        today: String, timeZone: String, instruments: [String], tunes: [Tune], userTunes: [UserTune],
        recordings: [Recording], recordingLinks: [Row], lists: [Row], scans: [Scan], scanViews: [ScanView],
        playEvents: [PlayEvent], practiceSessions: [PracticeSession], statusChanges: [StatusChange]
    ) {
        self.today = today
        self.timeZone = timeZone
        self.instruments = instruments
        self.tunes = tunes
        self.userTunes = userTunes
        self.recordings = recordings
        self.recordingLinks = recordingLinks
        self.lists = lists
        self.scans = scans
        self.scanViews = scanViews
        self.playEvents = playEvents
        self.practiceSessions = practiceSessions
        self.statusChanges = statusChanges
    }

    public struct Tune: Codable, Sendable {
        public var id: String
        public var title: String
        public var key: String?
        /// One per part; the first is the tune's mode.
        public var modes: [String]
        public var tuneType: String?
        public var genre: String?
        public var timeSignature: String?
        public var tunings: JSONValue?
        public var deletedAt: String?

        enum CodingKeys: String, CodingKey {
            case id, title, key, modes, genre, tunings
            case tuneType = "tune_type"
            case timeSignature = "time_signature"
            case deletedAt = "deleted_at"
        }

        public init(
            id: String, title: String, key: String?, modes: [String], tuneType: String?, genre: String?,
            timeSignature: String?, tunings: JSONValue?, deletedAt: String?
        ) {
            self.id = id
            self.title = title
            self.key = key
            self.modes = modes
            self.tuneType = tuneType
            self.genre = genre
            self.timeSignature = timeSignature
            self.tunings = tunings
            self.deletedAt = deletedAt
        }
    }

    public struct UserTune: Codable, Sendable {
        public var id: String
        public var tuneID: String
        public var status: String
        public var learnedFrom: String?
        /// A plain `YYYY-MM-DD`, not an instant.
        public var learnedOn: String?
        public var archivedAt: String?
        public var createdAt: String
        public var deletedAt: String?

        enum CodingKeys: String, CodingKey {
            case id, status
            case tuneID = "tune_id"
            case learnedFrom = "learned_from"
            case learnedOn = "learned_on"
            case archivedAt = "archived_at"
            case createdAt = "created_at"
            case deletedAt = "deleted_at"
        }

        public init(
            id: String, tuneID: String, status: String, learnedFrom: String?, learnedOn: String?,
            archivedAt: String?, createdAt: String, deletedAt: String?
        ) {
            self.id = id
            self.tuneID = tuneID
            self.status = status
            self.learnedFrom = learnedFrom
            self.learnedOn = learnedOn
            self.archivedAt = archivedAt
            self.createdAt = createdAt
            self.deletedAt = deletedAt
        }
    }

    public struct Recording: Codable, Sendable {
        public var id: String
        public var tuneID: String?
        public var recordedAt: String
        public var durationMs: Int?
        public var trimStartMs: Int
        public var trimEndMs: Int?
        public var deletedAt: String?

        enum CodingKeys: String, CodingKey {
            case id
            case tuneID = "tune_id"
            case recordedAt = "recorded_at"
            case durationMs = "duration_ms"
            case trimStartMs = "trim_start_ms"
            case trimEndMs = "trim_end_ms"
            case deletedAt = "deleted_at"
        }

        public init(
            id: String, tuneID: String?, recordedAt: String, durationMs: Int?, trimStartMs: Int, trimEndMs: Int?,
            deletedAt: String?
        ) {
            self.id = id
            self.tuneID = tuneID
            self.recordedAt = recordedAt
            self.durationMs = durationMs
            self.trimStartMs = trimStartMs
            self.trimEndMs = trimEndMs
            self.deletedAt = deletedAt
        }
    }

    /// A list or a recording link, which stats only counts.
    public struct Row: Codable, Sendable {
        public var id: String
        public var deletedAt: String?

        enum CodingKeys: String, CodingKey {
            case id
            case deletedAt = "deleted_at"
        }

        public init(id: String, deletedAt: String?) {
            self.id = id
            self.deletedAt = deletedAt
        }
    }

    public struct Scan: Codable, Sendable {
        public var id: String
        public var tuneID: String
        public var deletedAt: String?

        enum CodingKeys: String, CodingKey {
            case id
            case tuneID = "tune_id"
            case deletedAt = "deleted_at"
        }

        public init(id: String, tuneID: String, deletedAt: String?) {
            self.id = id
            self.tuneID = tuneID
            self.deletedAt = deletedAt
        }
    }

    public struct ScanView: Codable, Sendable {
        public var id: String
        public var startedAt: String

        enum CodingKeys: String, CodingKey {
            case id
            case startedAt = "started_at"
        }

        public init(id: String, startedAt: String) {
            self.id = id
            self.startedAt = startedAt
        }
    }

    public struct PlayEvent: Codable, Sendable {
        public var id: String
        public var startedAt: String
        public var listenedMs: Int

        enum CodingKeys: String, CodingKey {
            case id
            case startedAt = "started_at"
            case listenedMs = "listened_ms"
        }

        public init(id: String, startedAt: String, listenedMs: Int) {
            self.id = id
            self.startedAt = startedAt
            self.listenedMs = listenedMs
        }
    }

    public struct PracticeSession: Codable, Sendable {
        public var id: String
        public var startedAt: String
        public var durationMs: Int

        enum CodingKeys: String, CodingKey {
            case id
            case startedAt = "started_at"
            case durationMs = "duration_ms"
        }

        public init(id: String, startedAt: String, durationMs: Int) {
            self.id = id
            self.startedAt = startedAt
            self.durationMs = durationMs
        }
    }

    public struct StatusChange: Codable, Sendable {
        public var id: String
        public var fromStatus: String?
        public var changedAt: String

        enum CodingKeys: String, CodingKey {
            case id
            case fromStatus = "from_status"
            case changedAt = "changed_at"
        }

        public init(id: String, fromStatus: String?, changedAt: String) {
            self.id = id
            self.fromStatus = fromStatus
            self.changedAt = changedAt
        }
    }
}

/// Everything the stats page shows.
public struct Stats: Codable, Equatable, Sendable {
    public var counts: Counts
    public var recorded: Recorded
    public var equivalence: Equivalence?
    public var months: Months
    public var heatmap: Heatmap
    public var onThisDay: [OnThisDay]
    public var breakdowns: Breakdowns
    public var rarities: [Rarity]

    enum CodingKeys: String, CodingKey {
        case counts, recorded, equivalence, months, heatmap, breakdowns, rarities
        case onThisDay = "on_this_day"
    }

    public init(
        counts: Counts, recorded: Recorded, equivalence: Equivalence?, months: Months, heatmap: Heatmap,
        onThisDay: [OnThisDay], breakdowns: Breakdowns, rarities: [Rarity]
    ) {
        self.counts = counts
        self.recorded = recorded
        self.equivalence = equivalence
        self.months = months
        self.heatmap = heatmap
        self.onThisDay = onThisDay
        self.breakdowns = breakdowns
        self.rarities = rarities
    }

    public struct Counts: Codable, Equatable, Sendable {
        public var known: Int
        public var learning: Int
        public var wantToLearn: Int
        public var tunes: Int
        public var archived: Int
        public var lists: Int
        public var recordings: Int
        public var links: Int
        /// Live scans on live, non-archived tunes.
        public var scans: Int
        /// The distinct tunes holding the counted scans.
        public var scanTunes: Int

        enum CodingKeys: String, CodingKey {
            case known, learning, tunes, archived, lists, recordings, links, scans
            case wantToLearn = "want_to_learn"
            case scanTunes = "scan_tunes"
        }

        public init(
            known: Int, learning: Int, wantToLearn: Int, tunes: Int, archived: Int, lists: Int, recordings: Int,
            links: Int, scans: Int, scanTunes: Int
        ) {
            self.known = known
            self.learning = learning
            self.wantToLearn = wantToLearn
            self.tunes = tunes
            self.archived = archived
            self.lists = lists
            self.recordings = recordings
            self.links = links
            self.scans = scans
            self.scanTunes = scanTunes
        }
    }

    public struct Recorded: Codable, Equatable, Sendable {
        public var count: Int
        public var totalMs: Int

        enum CodingKeys: String, CodingKey {
            case count
            case totalMs = "total_ms"
        }

        public init(count: Int, totalMs: Int) {
            self.count = count
            self.totalMs = totalMs
        }
    }

    public enum EquivalenceID: String, Codable, Sendable, CaseIterable {
        case tune
        case lpSide = "lp_side"
        case bostonDublin = "boston_dublin"
        case workWeek = "work_week"
        case crossCountry = "cross_country"
    }

    public struct Equivalence: Codable, Equatable, Sendable {
        public var id: EquivalenceID
        public var n: Int
        /// The tune of a `tune` equivalence.
        public var tuneID: String?

        enum CodingKeys: String, CodingKey {
            case id, n
            case tuneID = "tune_id"
        }

        public init(id: EquivalenceID, n: Int, tuneID: String? = nil) {
            self.id = id
            self.n = n
            self.tuneID = tuneID
        }
    }

    public struct Month: Codable, Equatable, Sendable {
        /// `YYYY-MM`.
        public var month: String
        public var tunesAdded: Int
        public var recordings: Int

        enum CodingKeys: String, CodingKey {
            case month, recordings
            case tunesAdded = "tunes_added"
        }

        public init(month: String, tunesAdded: Int, recordings: Int) {
            self.month = month
            self.tunesAdded = tunesAdded
            self.recordings = recordings
        }
    }

    public struct Months: Codable, Equatable, Sendable {
        public var last12: [Month]
        public var allTime: [Month]
        public var hasAllTime: Bool

        enum CodingKeys: String, CodingKey {
            case last12
            case allTime = "all_time"
            case hasAllTime = "has_all_time"
        }

        public init(last12: [Month], allTime: [Month], hasAllTime: Bool) {
            self.last12 = last12
            self.allTime = allTime
            self.hasAllTime = hasAllTime
        }
    }

    public struct Day: Codable, Equatable, Sendable {
        /// `YYYY-MM-DD`.
        public var date: String
        public var musicMs: Int
        public var plays: Int
        public var practiceSessions: Int
        public var scanViews: Int
        public var tunesAdded: Int
        public var recordings: Int
        public var statusChanges: Int
        /// 0 for a day with nothing, then 1 through 4 by quartile of music.
        public var level: Int

        enum CodingKeys: String, CodingKey {
            case date, plays, recordings, level
            case musicMs = "music_ms"
            case practiceSessions = "practice_sessions"
            case scanViews = "scan_views"
            case tunesAdded = "tunes_added"
            case statusChanges = "status_changes"
        }

        public init(
            date: String, musicMs: Int, plays: Int, practiceSessions: Int, scanViews: Int, tunesAdded: Int,
            recordings: Int, statusChanges: Int, level: Int
        ) {
            self.date = date
            self.musicMs = musicMs
            self.plays = plays
            self.practiceSessions = practiceSessions
            self.scanViews = scanViews
            self.tunesAdded = tunesAdded
            self.recordings = recordings
            self.statusChanges = statusChanges
            self.level = level
        }
    }

    public struct Heatmap: Codable, Equatable, Sendable {
        public var visible: Bool
        /// The Sunday the first column starts on.
        public var start: String
        public var days: [Day]

        public init(visible: Bool, start: String, days: [Day]) {
            self.visible = visible
            self.start = start
            self.days = days
        }
    }

    public enum OnThisDayKind: String, Codable, Sendable {
        case firstTune = "first_tune"
        case firstRecording = "first_recording"
        case tuneAdded = "tune_added"
        case recording
        case learned
    }

    public struct OnThisDay: Codable, Equatable, Sendable {
        public var kind: OnThisDayKind
        /// A tune ID for a tune line, a recording ID for a recording line.
        public var id: String
        public var years: Int

        public init(kind: OnThisDayKind, id: String, years: Int) {
            self.kind = kind
            self.id = id
            self.years = years
        }
    }

    public struct Value: Codable, Equatable, Sendable {
        public var value: String
        public var count: Int

        public init(value: String, count: Int) {
            self.value = value
            self.count = count
        }
    }

    public struct KeyRow: Codable, Equatable, Sendable {
        public var key: String
        public var count: Int
        public var modes: [Value]

        public init(key: String, count: Int, modes: [Value]) {
            self.key = key
            self.count = count
            self.modes = modes
        }
    }

    public struct TuningRow: Codable, Equatable, Sendable {
        public var instrument: String
        public var values: [Value]

        public init(instrument: String, values: [Value]) {
            self.instrument = instrument
            self.values = values
        }
    }

    public struct Breakdowns: Codable, Equatable, Sendable {
        public var key: [KeyRow]
        public var tuneType: [Value]
        public var genre: [Value]
        public var timeSignature: [Value]
        public var learnedFrom: [Value]
        public var tunings: [TuningRow]

        enum CodingKeys: String, CodingKey {
            case key, genre, tunings
            case tuneType = "tune_type"
            case timeSignature = "time_signature"
            case learnedFrom = "learned_from"
        }

        public init(
            key: [KeyRow], tuneType: [Value], genre: [Value], timeSignature: [Value], learnedFrom: [Value],
            tunings: [TuningRow]
        ) {
            self.key = key
            self.tuneType = tuneType
            self.genre = genre
            self.timeSignature = timeSignature
            self.learnedFrom = learnedFrom
            self.tunings = tunings
        }
    }

    public enum RarityAttribute: String, Codable, Sendable, CaseIterable {
        // Declared in the order rarities are picked.
        case keyMode = "key_mode"
        case timeSignature = "time_signature"
        case tuning
        case tuneType = "tune_type"
        case genre
    }

    public struct Rarity: Codable, Equatable, Sendable {
        public var attribute: RarityAttribute
        public var value: String
        /// The instrument of a `tuning` rarity.
        public var instrument: String?
        public var tuneID: String

        enum CodingKeys: String, CodingKey {
            case attribute, value, instrument
            case tuneID = "tune_id"
        }

        public init(attribute: RarityAttribute, value: String, instrument: String? = nil, tuneID: String) {
            self.attribute = attribute
            self.value = value
            self.instrument = instrument
            self.tuneID = tuneID
        }
    }
}
