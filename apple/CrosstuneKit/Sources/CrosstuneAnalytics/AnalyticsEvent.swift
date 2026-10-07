import CrosstuneVocabulary

/// A property value an event may carry. Every string comes from one of this module's own enums
/// or the vocabulary, never from text the musician typed.
public enum AnalyticsValue: Sendable, Equatable {
    case string(String)
    case int(Int)
    case bool(Bool)
    case strings([String])
}

/// Something the musician did, named and shaped as the product analytics spec's event table
/// says. The table is the contract the web client shares, so a name or property key changes
/// there first.
public enum AnalyticsEvent: Sendable, Equatable {
    /// A different user signed in, not a launch that restored the same one.
    case signedIn
    case signedOut
    case accountDeleted
    case tuneCreated(source: ActionSource, hasKey: Bool, hasTuning: Bool)
    case tuneEdited(fieldsChanged: [TuneField])
    case tuneStatusChanged(from: TuneStatus, to: TuneStatus)
    case searchPerformed(resultCount: Int, tookOffer: Bool)
    case catalogFiltered(filter: CatalogFilterKind)
    case recordingStarted(source: ActionSource)
    case recordingSaved(seconds: Double)
    case recordingDiscarded(seconds: Double)
    case audioImported(fileCount: Int, format: AudioFormat)
    case linkAdded(service: LinkService, via: LinkVia)
    case findRecordingsUsed(service: LinkService, resultCount: Int)
    case playbackStarted(kind: PlaybackKind, source: ActionSource)
    case practiceStarted(source: ActionSource)
    case loopSet
    case speedChanged(rate: Double)
    case pitchChanged(semitones: Int)
    case recordingTrimmed
    case scanAdded(via: ScanVia)
    case scanViewed
    case lyricsOpened
    case listCreated
    case tunesAddedToList(count: Int)
    case bulkEditApplied(count: Int, fieldsChanged: [TuneField])
    case statsViewed
    case standOpened
    case exportCompleted(format: ExportFormat)

    public var name: String {
        switch self {
        case .signedIn: "signed_in"
        case .signedOut: "signed_out"
        case .accountDeleted: "account_deleted"
        case .tuneCreated: "tune_created"
        case .tuneEdited: "tune_edited"
        case .tuneStatusChanged: "tune_status_changed"
        case .searchPerformed: "search_performed"
        case .catalogFiltered: "catalog_filtered"
        case .recordingStarted: "recording_started"
        case .recordingSaved: "recording_saved"
        case .recordingDiscarded: "recording_discarded"
        case .audioImported: "audio_imported"
        case .linkAdded: "link_added"
        case .findRecordingsUsed: "find_recordings_used"
        case .playbackStarted: "playback_started"
        case .practiceStarted: "practice_started"
        case .loopSet: "loop_set"
        case .speedChanged: "speed_changed"
        case .pitchChanged: "pitch_changed"
        case .recordingTrimmed: "recording_trimmed"
        case .scanAdded: "scan_added"
        case .scanViewed: "scan_viewed"
        case .lyricsOpened: "lyrics_opened"
        case .listCreated: "list_created"
        case .tunesAddedToList: "tunes_added_to_list"
        case .bulkEditApplied: "bulk_edit_applied"
        case .statsViewed: "stats_viewed"
        case .standOpened: "stand_opened"
        case .exportCompleted: "export_completed"
        }
    }

    public var properties: [String: AnalyticsValue] {
        switch self {
        case .signedIn, .signedOut, .accountDeleted, .loopSet, .recordingTrimmed, .scanViewed, .lyricsOpened,
            .listCreated, .statsViewed, .standOpened:
            [:]
        case .tuneCreated(let source, let hasKey, let hasTuning):
            ["source": .string(source.rawValue), "has_key": .bool(hasKey), "has_tuning": .bool(hasTuning)]
        case .tuneEdited(let fields):
            ["fields_changed": .strings(fields.map(\.rawValue))]
        case .tuneStatusChanged(let from, let to):
            ["from": .string(from.rawValue), "to": .string(to.rawValue)]
        case .searchPerformed(let resultCount, let tookOffer):
            ["result_count_bucket": .string(Bucket.count(resultCount)), "took_offer": .bool(tookOffer)]
        case .catalogFiltered(let filter):
            ["filter": .string(filter.rawValue)]
        case .recordingStarted(let source), .practiceStarted(let source):
            ["source": .string(source.rawValue)]
        case .recordingSaved(let seconds), .recordingDiscarded(let seconds):
            ["duration_bucket": .string(Bucket.duration(seconds: seconds))]
        case .audioImported(let fileCount, let format):
            ["count_bucket": .string(Bucket.count(fileCount)), "format": .string(format.rawValue)]
        case .linkAdded(let service, let via):
            ["service": .string(service.rawValue), "via": .string(via.rawValue)]
        case .findRecordingsUsed(let service, let resultCount):
            ["service": .string(service.rawValue), "result_count_bucket": .string(Bucket.count(resultCount))]
        case .playbackStarted(let kind, let source):
            ["kind": .string(kind.rawValue), "source": .string(source.rawValue)]
        case .speedChanged(let rate):
            ["speed_bucket": .string(Bucket.speed(rate))]
        case .pitchChanged(let semitones):
            ["semitones": .int(semitones)]
        case .scanAdded(let via):
            ["via": .string(via.rawValue)]
        case .tunesAddedToList(let count):
            ["count_bucket": .string(Bucket.count(count))]
        case .bulkEditApplied(let count, let fields):
            ["count_bucket": .string(Bucket.count(count)), "fields_changed": .strings(fields.map(\.rawValue))]
        case .exportCompleted(let format):
            ["format": .string(format.rawValue)]
        }
    }
}

/// A destination the musician opened, sent as PostHog's screen event.
public enum Screen: String, Sendable {
    case catalog
    case tune
    case list
    case lists
    case recordings
    case recording
    case settings
    case stats
    case stand
}

/// Where an action started, for a feature with more than one way in.
public enum ActionSource: String, CaseIterable, Sendable {
    case catalog
    case tune
    case list
    case recordingsList = "recordings_list"
    /// A recording's own screen.
    case recording
    case dock
    case stand
    case searchOffer = "search_offer"
    case keyboardShortcut = "keyboard_shortcut"
    case menu
}

/// What started playing: a recording of the musician's own or a link to someone else's.
public enum PlaybackKind: String, CaseIterable, Sendable {
    case recording
    case link
}

/// The service a link points at, one per provider the API knows.
public enum LinkService: String, CaseIterable, Sendable {
    case youtube
    case spotify
    case appleMusic = "apple_music"
    case bandcamp
    case soundcloud
    case tidal
    case internetArchive = "internet_archive"
    case slipperyHill = "slippery_hill"
    case other
}

/// How a link was added: pasted, or picked from Find recordings.
public enum LinkVia: String, CaseIterable, Sendable {
    case paste
    case find
}

/// How a scan came in.
public enum ScanVia: String, CaseIterable, Sendable {
    case camera
    case documentScanner = "document_scanner"
    case photoLibrary = "photo_library"
    case file
}

/// What the data export produced.
public enum ExportFormat: String, CaseIterable, Sendable {
    case zip
}

/// The container of an imported audio file.
public enum AudioFormat: String, CaseIterable, Sendable {
    case m4a
    case mp3
    case wav
    case aiff
    case flac
    case other

    public init(pathExtension: String) {
        self =
            switch pathExtension.lowercased() {
            case "m4a": .m4a
            case "mp3": .mp3
            case "wav": .wav
            case "aif", "aiff": .aiff
            case "flac": .flac
            default: .other
            }
    }
}

/// A tune field by name only, never its value. A tuning or a capo is one field whatever the
/// instrument.
public enum TuneField: String, CaseIterable, Sendable {
    case title
    case alternateTitles = "alternate_titles"
    case status
    case key
    case mode
    case tuning
    case capo
    case genre
    case tuneType = "tune_type"
    case timeSignature = "time_signature"
    case partStructure = "part_structure"
    case composer
    case isCrooked = "is_crooked"
    case lyrics
    case notes
    case learnedFrom = "learned_from"
    case learnedOn = "learned_on"
}

/// The kind of filter the catalog applied, never the value it filters on. A tuning is one kind
/// whatever the instrument.
public enum CatalogFilterKind: String, CaseIterable, Sendable {
    case status
    case key
    case tuneType = "tune_type"
    case mode
    case tuning
    case genre
    case composer
    case learnedFrom = "learned_from"
    case archived
    case unheard
    case missing
}

/// One of the vocabulary's tune statuses. The app keeps a status as a string, so this checks
/// it against the vocabulary rather than keeping a second list of statuses.
public struct TuneStatus: Sendable, Equatable {
    public let rawValue: String

    public init?(_ rawValue: String) {
        guard Vocabulary.statuses.contains(rawValue) else { return nil }
        self.rawValue = rawValue
    }
}
