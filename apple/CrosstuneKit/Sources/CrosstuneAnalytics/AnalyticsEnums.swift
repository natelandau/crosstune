/// A destination the musician opened, sent as PostHog's screen event.
public enum Screen: String, CaseIterable, Sendable {
    case welcome
    case catalog
    case tune
    case lists
    case list
    case recordings
    case recording
    case findRecordings = "find_recordings"
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
    case recordingScreen = "recording_screen"
    case dock
    case searchOffer = "search_offer"
    case menu
}

/// Where a recording came from: a take, an imported file, or an archive save.
public enum RecordingOrigin: String, CaseIterable, Sendable {
    case recorded
    case imported
    case slipperyHill = "slippery_hill"
}

/// What played: a recording, by its origin, or a link to someone else's.
public enum PlaybackKind: String, CaseIterable, Sendable {
    case recorded
    case imported
    case slipperyHill = "slippery_hill"
    case link

    public init(_ origin: RecordingOrigin) {
        self =
            switch origin {
            case .recorded: .recorded
            case .imported: .imported
            case .slipperyHill: .slipperyHill
            }
    }
}

/// Whether a play stood alone or was one track of a list played through.
public enum PlaybackQueue: String, CaseIterable, Sendable {
    case single
    case playlist
}

/// What started a play.
public enum PlaybackTrigger: String, CaseIterable, Sendable {
    case tap
    case autoAdvance = "auto_advance"
    case skip
}

/// What ended a play.
public enum PlaybackEnd: String, CaseIterable, Sendable {
    case finished
    case skipped
    case paused
    case closed
}

/// A list's repeat setting as its play started.
public enum RepeatMode: String, CaseIterable, Sendable {
    case off
    case list
    case tune
}

/// Where a recording was filed from.
public enum FiledFrom: String, CaseIterable, Sendable {
    case unfiled
    case otherTune = "other_tune"
}

/// The order the catalog was put in.
public enum CatalogSort: String, CaseIterable, Sendable {
    case title
    case added
    case modified
    case played
}

/// What a bulk edit did to the selected tunes.
public enum BulkAction: String, CaseIterable, Sendable {
    case status
    case edit
    case archive
    case delete
}

/// Why an upload or a sync failed, never the error's own text.
public enum FailureReason: String, CaseIterable, Sendable {
    case network
    case storageFull = "storage_full"
    case authExpired = "auth_expired"
    case serverError = "server_error"
    case other
}

/// The archive a recording was saved from.
public enum ArchiveSource: String, CaseIterable, Sendable {
    case slipperyHill = "slippery_hill"
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
