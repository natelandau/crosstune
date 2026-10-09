import CrosstuneVocabulary

/// A property value an event may carry. Every string comes from one of this module's own enums,
/// the vocabulary, or a row's ID, never from text the musician typed.
public enum AnalyticsValue: Sendable, Equatable {
    case string(String)
    case int(Int)
    case bool(Bool)
    case strings([String])
}

/// Something the musician did, named and shaped as `analytics/tracking-plan.json` says. The plan
/// is the contract every client is tested against, so a name or property key changes there
/// first. An ID is a row's own, and an optional one is left out when nil.
public enum AnalyticsEvent: Sendable, Equatable {
    /// A different user signed in, not a launch that restored the same one.
    case signedIn
    case signedOut
    case accountDeleted
    case accountDeletionStarted
    /// The confirmation closed without deleting.
    case accountDeletionCancelled

    case tuneCreated(source: ActionSource, fieldsSet: [TuneField], tuneID: String)
    case tuneEdited(fieldsChanged: [TuneField], tuneID: String)
    case tuneStatusChanged(from: TuneStatus, to: TuneStatus, tuneID: String)
    case tuneArchived(tuneID: String)
    case tuneUnarchived(tuneID: String)
    /// What went with the tune, in buckets.
    case tuneDeleted(tuneID: String, recordings: Int, links: Int, scans: Int)
    /// `fieldsChanged` is nil for an action that writes no fields.
    case bulkEditApplied(action: BulkAction, count: Int, fieldsChanged: [TuneField]?)

    case searchPerformed(resultCount: Int, tookOffer: Bool)
    case catalogFiltered(filter: CatalogFilterKind)
    case catalogSorted(sort: CatalogSort)

    case lyricsOpened(tuneID: String)
    case standOpened(tuneID: String)

    case listCreated(listID: String, count: Int)
    /// Never the name.
    case listRenamed(listID: String)
    case listDeleted(listID: String, count: Int)
    case listReordered(listID: String)
    case tunesAddedToList(listID: String, count: Int)
    case tunesRemovedFromList(listID: String, count: Int)

    case importStarted(entry: ImportEntry)
    case importReviewed(reader: ImportReader, count: Int, duplicates: Int, hasWarnings: Bool)
    /// `added` is the tunes added; `skipped` is the rows not added, unchecked or with a blank title.
    case importCompleted(reader: ImportReader, added: Int, skipped: Int, list: ImportList)

    case recordingStarted(source: ActionSource)
    case microphoneDenied(source: ActionSource)
    /// A take saved with a tune is filed.
    case recordingSaved(seconds: Double, recordingID: String, tuneID: String?)
    case recordingDiscarded(seconds: Double)
    case audioImported(fileCount: Int, format: AudioFormat)
    case archiveRecordingSaved(source: ArchiveSource, recordingID: String, tuneID: String)
    case recordingFiled(from: FiledFrom, origin: RecordingOrigin, recordingID: String, tuneID: String)
    case recordingUnfiled(origin: RecordingOrigin, recordingID: String)
    /// Never the name.
    case recordingRenamed(origin: RecordingOrigin, recordingID: String)
    case recordingDeleted(origin: RecordingOrigin, recordingID: String)
    case recordingTrimmed(recordingID: String)

    case linkAdded(service: LinkService, via: LinkVia, linkID: String, tuneID: String)
    case linkRemoved(service: LinkService, linkID: String)
    case linkOpenedExternally(service: LinkService, linkID: String)
    case findRecordingsUsed(service: LinkService, resultCount: Int?)
    case appleMusicAuthorized(granted: Bool)

    case playbackEnded(PlaybackReport)
    case playlistStarted(shuffle: Bool, repeat: RepeatMode, count: Int, listID: String)
    case practiceEnded(PracticeReport)
    case loopSet(recordingID: String)
    case speedChanged(rate: Double, recordingID: String)
    case pitchChanged(semitones: Int, recordingID: String)

    case scanAdded(via: ScanVia, scanID: String, tuneID: String)
    case scanViewed(tuneID: String)
    case scanDeleted(scanID: String, tuneID: String)
    case scansReordered(tuneID: String)

    case settingChanged(SettingChange)
    /// Sent before sharing stops, so it is the last event a person sends.
    case usageSharingDisabled

    case storageLimitReached(bytesUsed: Int64)
    case uploadFailed(reason: FailureReason, origin: RecordingOrigin)
    case syncFailed(reason: FailureReason)

    case exportCompleted(format: ExportFormat)
    case exportFailed(format: ExportFormat, reason: FailureReason)

    public var name: String {
        switch self {
        case .signedIn: "signed_in"
        case .signedOut: "signed_out"
        case .accountDeleted: "account_deleted"
        case .accountDeletionStarted: "account_deletion_started"
        case .accountDeletionCancelled: "account_deletion_cancelled"
        case .tuneCreated: "tune_created"
        case .tuneEdited: "tune_edited"
        case .tuneStatusChanged: "tune_status_changed"
        case .tuneArchived: "tune_archived"
        case .tuneUnarchived: "tune_unarchived"
        case .tuneDeleted: "tune_deleted"
        case .bulkEditApplied: "bulk_edit_applied"
        case .searchPerformed: "search_performed"
        case .catalogFiltered: "catalog_filtered"
        case .catalogSorted: "catalog_sorted"
        case .lyricsOpened: "lyrics_opened"
        case .standOpened: "stand_opened"
        case .listCreated: "list_created"
        case .listRenamed: "list_renamed"
        case .listDeleted: "list_deleted"
        case .listReordered: "list_reordered"
        case .tunesAddedToList: "tunes_added_to_list"
        case .tunesRemovedFromList: "tunes_removed_from_list"
        case .importStarted: "import_started"
        case .importReviewed: "import_reviewed"
        case .importCompleted: "import_completed"
        case .recordingStarted: "recording_started"
        case .microphoneDenied: "microphone_denied"
        case .recordingSaved: "recording_saved"
        case .recordingDiscarded: "recording_discarded"
        case .audioImported: "audio_imported"
        case .archiveRecordingSaved: "archive_recording_saved"
        case .recordingFiled: "recording_filed"
        case .recordingUnfiled: "recording_unfiled"
        case .recordingRenamed: "recording_renamed"
        case .recordingDeleted: "recording_deleted"
        case .recordingTrimmed: "recording_trimmed"
        case .linkAdded: "link_added"
        case .linkRemoved: "link_removed"
        case .linkOpenedExternally: "link_opened_externally"
        case .findRecordingsUsed: "find_recordings_used"
        case .appleMusicAuthorized: "apple_music_authorized"
        case .playbackEnded: "playback_ended"
        case .playlistStarted: "playlist_started"
        case .practiceEnded: "practice_ended"
        case .loopSet: "loop_set"
        case .speedChanged: "speed_changed"
        case .pitchChanged: "pitch_changed"
        case .scanAdded: "scan_added"
        case .scanViewed: "scan_viewed"
        case .scanDeleted: "scan_deleted"
        case .scansReordered: "scans_reordered"
        case .settingChanged: "setting_changed"
        case .usageSharingDisabled: "usage_sharing_disabled"
        case .storageLimitReached: "storage_limit_reached"
        case .uploadFailed: "upload_failed"
        case .syncFailed: "sync_failed"
        case .exportCompleted: "export_completed"
        case .exportFailed: "export_failed"
        }
    }

    public var properties: [String: AnalyticsValue] {
        switch self {
        case .signedIn, .signedOut, .accountDeleted, .accountDeletionStarted, .accountDeletionCancelled,
            .usageSharingDisabled:
            [:]
        case .tuneCreated(let source, let fields, let tuneID):
            ["source": .string(source.rawValue), "fields_set": .fields(fields), "tune_id": .string(tuneID)]
        case .tuneEdited(let fields, let tuneID):
            ["fields_changed": .fields(fields), "tune_id": .string(tuneID)]
        case .tuneStatusChanged(let from, let to, let tuneID):
            ["from": .string(from.rawValue), "to": .string(to.rawValue), "tune_id": .string(tuneID)]
        case .tuneArchived(let tuneID), .tuneUnarchived(let tuneID), .lyricsOpened(let tuneID),
            .standOpened(let tuneID), .scanViewed(let tuneID), .scansReordered(let tuneID):
            ["tune_id": .string(tuneID)]
        case .tuneDeleted(let tuneID, let recordings, let links, let scans):
            [
                "tune_id": .string(tuneID), "recordings_count": .count(recordings), "links_count": .count(links),
                "scans_count": .count(scans),
            ]
        case .bulkEditApplied(let action, let count, let fields):
            ["action": .string(action.rawValue), "count_bucket": .count(count)]
                .adding("fields_changed", fields.map(AnalyticsValue.fields))
        case .searchPerformed(let resultCount, let tookOffer):
            ["result_count_bucket": .count(resultCount), "took_offer": .bool(tookOffer)]
        case .catalogFiltered(let filter):
            ["filter": .string(filter.rawValue)]
        case .catalogSorted(let sort):
            ["sort": .string(sort.rawValue)]
        case .listCreated(let listID, let count), .listDeleted(let listID, let count),
            .tunesAddedToList(let listID, let count), .tunesRemovedFromList(let listID, let count):
            ["list_id": .string(listID), "count_bucket": .count(count)]
        case .listRenamed(let listID), .listReordered(let listID):
            ["list_id": .string(listID)]
        case .importStarted(let entry):
            ["entry": .string(entry.rawValue)]
        case .importReviewed(let reader, let count, let duplicates, let hasWarnings):
            [
                "reader": .string(reader.rawValue), "count_bucket": .count(count),
                "duplicate_bucket": .count(duplicates), "has_warnings": .bool(hasWarnings),
            ]
        case .importCompleted(let reader, let added, let skipped, let list):
            [
                "reader": .string(reader.rawValue), "count_bucket": .count(added),
                "skipped_bucket": .count(skipped), "list": .string(list.rawValue),
            ]
        case .recordingStarted(let source), .microphoneDenied(let source):
            ["source": .string(source.rawValue)]
        case .recordingSaved(let seconds, let recordingID, let tuneID):
            [
                "duration_bucket": .string(Bucket.duration(seconds: seconds)), "filed": .bool(tuneID != nil),
                "recording_id": .string(recordingID),
            ]
            .adding("tune_id", tuneID.map(AnalyticsValue.string))
        case .recordingDiscarded(let seconds):
            ["duration_bucket": .string(Bucket.duration(seconds: seconds))]
        case .audioImported(let fileCount, let format):
            ["count_bucket": .count(fileCount), "format": .string(format.rawValue)]
        case .archiveRecordingSaved(let source, let recordingID, let tuneID):
            [
                "source_archive": .string(source.rawValue), "recording_id": .string(recordingID),
                "tune_id": .string(tuneID),
            ]
        case .recordingFiled(let from, let origin, let recordingID, let tuneID):
            [
                "from": .string(from.rawValue), "origin": .string(origin.rawValue),
                "recording_id": .string(recordingID), "tune_id": .string(tuneID),
            ]
        case .recordingUnfiled(let origin, let recordingID), .recordingRenamed(let origin, let recordingID),
            .recordingDeleted(let origin, let recordingID):
            ["origin": .string(origin.rawValue), "recording_id": .string(recordingID)]
        case .recordingTrimmed(let recordingID), .loopSet(let recordingID):
            ["recording_id": .string(recordingID)]
        case .linkAdded(let service, let via, let linkID, let tuneID):
            [
                "service": .string(service.rawValue), "via": .string(via.rawValue), "link_id": .string(linkID),
                "tune_id": .string(tuneID),
            ]
        case .linkRemoved(let service, let linkID), .linkOpenedExternally(let service, let linkID):
            ["service": .string(service.rawValue), "link_id": .string(linkID)]
        case .findRecordingsUsed(let service, let resultCount):
            ["service": .string(service.rawValue)].adding("result_count_bucket", resultCount.map(AnalyticsValue.count))
        case .appleMusicAuthorized(let granted):
            ["granted": .bool(granted)]
        case .playbackEnded(let report):
            report.properties
        case .playlistStarted(let shuffle, let repeatMode, let count, let listID):
            [
                "shuffle": .bool(shuffle), "repeat": .string(repeatMode.rawValue), "count_bucket": .count(count),
                "list_id": .string(listID),
            ]
        case .practiceEnded(let report):
            report.properties
        case .speedChanged(let rate, let recordingID):
            ["speed_bucket": .string(Bucket.speed(rate)), "recording_id": .string(recordingID)]
        case .pitchChanged(let semitones, let recordingID):
            ["semitones": .int(semitones), "recording_id": .string(recordingID)]
        case .scanAdded(let via, let scanID, let tuneID):
            ["via": .string(via.rawValue), "scan_id": .string(scanID), "tune_id": .string(tuneID)]
        case .scanDeleted(let scanID, let tuneID):
            ["scan_id": .string(scanID), "tune_id": .string(tuneID)]
        case .settingChanged(let change):
            ["setting": .string(change.name), "value": change.value]
        case .storageLimitReached(let bytesUsed):
            ["storage_used": .string(Bucket.bytes(bytesUsed))]
        case .uploadFailed(let reason, let origin):
            ["failure_reason": .string(reason.rawValue), "origin": .string(origin.rawValue)]
        case .syncFailed(let reason):
            ["failure_reason": .string(reason.rawValue)]
        case .exportCompleted(let format):
            ["format": .string(format.rawValue)]
        case .exportFailed(let format, let reason):
            ["format": .string(format.rawValue), "failure_reason": .string(reason.rawValue)]
        }
    }

    /// The person properties the event sets as it is sent: a setting change keeps the person's
    /// current choice, and every other event sets none.
    public var personProperties: [String: AnalyticsValue] {
        guard case .settingChanged(let change) = self else { return [:] }
        return [change.personProperty: change.value]
    }
}

/// One play, reported as it ends so its time listened is known.
public struct PlaybackReport: Sendable, Equatable {
    public var source: ActionSource
    public var queue: PlaybackQueue
    public var trigger: PlaybackTrigger
    public var kind: PlaybackKind
    /// A link's service; nil for a recording.
    public var service: LinkService?
    /// Sent only as its bucket.
    public var listenedMs: Int64
    public var completed: Bool
    public var endedBy: PlaybackEnd
    /// Whether any play, pause, skip, or seek in this play came from outside the app.
    public var systemControlled: Bool
    public var tuneID: String?
    public var recordingID: String?
    public var linkID: String?
    public var listID: String?

    public init(
        source: ActionSource, queue: PlaybackQueue, trigger: PlaybackTrigger, kind: PlaybackKind,
        service: LinkService?, listenedMs: Int64, completed: Bool, endedBy: PlaybackEnd,
        systemControlled: Bool, tuneID: String?, recordingID: String?, linkID: String?, listID: String?
    ) {
        self.source = source
        self.queue = queue
        self.trigger = trigger
        self.kind = kind
        self.service = service
        self.listenedMs = listenedMs
        self.completed = completed
        self.endedBy = endedBy
        self.systemControlled = systemControlled
        self.tuneID = tuneID
        self.recordingID = recordingID
        self.linkID = linkID
        self.listID = listID
    }

    var properties: [String: AnalyticsValue] {
        [
            "source": .string(source.rawValue), "queue": .string(queue.rawValue), "trigger": .string(trigger.rawValue),
            "kind": .string(kind.rawValue), "listened_bucket": .string(Bucket.listened(ms: listenedMs)),
            "completed": .bool(completed), "ended_by": .string(endedBy.rawValue),
            "system_controlled": .bool(systemControlled),
        ]
        .adding("service", service.map { .string($0.rawValue) })
        .adding("tune_id", tuneID.map(AnalyticsValue.string))
        .adding("recording_id", recordingID.map(AnalyticsValue.string))
        .adding("link_id", linkID.map(AnalyticsValue.string))
        .adding("list_id", listID.map(AnalyticsValue.string))
    }
}

/// One visit to a recording's screen, reported as it closes.
public struct PracticeReport: Sendable, Equatable {
    public var source: ActionSource
    /// Sent only as its bucket.
    public var durationMs: Int64
    public var usedLoops: Bool
    public var usedSpeed: Bool
    public var usedPitch: Bool
    public var kind: PlaybackKind
    public var recordingID: String
    public var tuneID: String?

    public init(
        source: ActionSource, durationMs: Int64, usedLoops: Bool, usedSpeed: Bool, usedPitch: Bool,
        kind: PlaybackKind, recordingID: String, tuneID: String?
    ) {
        self.source = source
        self.durationMs = durationMs
        self.usedLoops = usedLoops
        self.usedSpeed = usedSpeed
        self.usedPitch = usedPitch
        self.kind = kind
        self.recordingID = recordingID
        self.tuneID = tuneID
    }

    var properties: [String: AnalyticsValue] {
        [
            "source": .string(source.rawValue),
            "duration_bucket": .string(Bucket.duration(seconds: Double(durationMs) / 1000)),
            "used_loops": .bool(usedLoops), "used_speed": .bool(usedSpeed), "used_pitch": .bool(usedPitch),
            "kind": .string(kind.rawValue), "recording_id": .string(recordingID),
        ]
        .adding("tune_id", tuneID.map(AnalyticsValue.string))
    }
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

extension AnalyticsValue {
    fileprivate static func count(_ n: Int) -> AnalyticsValue { .string(Bucket.count(n)) }
    fileprivate static func fields(_ fields: [TuneField]) -> AnalyticsValue { .strings(fields.map(\.rawValue)) }
}

extension [String: AnalyticsValue] {
    /// These properties with `key` set to `value`, or left out when it is nil.
    fileprivate func adding(_ key: String, _ value: AnalyticsValue?) -> Self {
        var properties = self
        properties[key] = value
        return properties
    }
}
