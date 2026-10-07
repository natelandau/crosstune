import CrosstuneVocabulary
import Testing

@testable import CrosstuneAnalytics

/// One event of every kind, in the order of the spec's event table.
private let samples: [AnalyticsEvent] = [
    .signedIn,
    .signedOut,
    .accountDeleted,
    .tuneCreated(source: .catalog, hasKey: true, hasTuning: false),
    .tuneEdited(fieldsChanged: [.title, .key]),
    .tuneStatusChanged(from: TuneStatus("learning")!, to: TuneStatus("known")!),
    .searchPerformed(resultCount: 12, tookOffer: false),
    .catalogFiltered(filter: .key),
    .recordingStarted(source: .dock),
    .recordingSaved(seconds: 95),
    .recordingDiscarded(seconds: 4),
    .audioImported(fileCount: 2, format: .mp3),
    .linkAdded(service: .youtube, via: .paste),
    .findRecordingsUsed(service: .slipperyHill, resultCount: 3),
    .playbackStarted(kind: .recording, source: .tune),
    .practiceStarted(source: .recordingsList),
    .loopSet,
    .speedChanged(rate: 0.8),
    .pitchChanged(semitones: -2),
    .recordingTrimmed,
    .scanAdded(via: .camera),
    .scanViewed,
    .lyricsOpened,
    .listCreated,
    .tunesAddedToList(count: 5),
    .bulkEditApplied(count: 60, fieldsChanged: [.status]),
    .statsViewed,
    .standOpened,
    .exportCompleted(format: .zip),
]

/// The spec's event table, every row but `screen_viewed` and the site's `waitlist_joined`:
/// each event's name and property keys, copied verbatim.
private let table: [(name: String, keys: Set<String>)] = [
    ("signed_in", []),
    ("signed_out", []),
    ("account_deleted", []),
    ("tune_created", ["source", "has_key", "has_tuning"]),
    ("tune_edited", ["fields_changed"]),
    ("tune_status_changed", ["from", "to"]),
    ("search_performed", ["result_count_bucket", "took_offer"]),
    ("catalog_filtered", ["filter"]),
    ("recording_started", ["source"]),
    ("recording_saved", ["duration_bucket"]),
    ("recording_discarded", ["duration_bucket"]),
    ("audio_imported", ["count_bucket", "format"]),
    ("link_added", ["service", "via"]),
    ("find_recordings_used", ["service", "result_count_bucket"]),
    ("playback_started", ["kind", "source"]),
    ("practice_started", ["source"]),
    ("loop_set", []),
    ("speed_changed", ["speed_bucket"]),
    ("pitch_changed", ["semitones"]),
    ("recording_trimmed", []),
    ("scan_added", ["via"]),
    ("scan_viewed", []),
    ("lyrics_opened", []),
    ("list_created", []),
    ("tunes_added_to_list", ["count_bucket"]),
    ("bulk_edit_applied", ["count_bucket", "fields_changed"]),
    ("stats_viewed", []),
    ("stand_opened", []),
    ("export_completed", ["format"]),
]

@Test func coversEveryEventInTheSpecsTable() {
    #expect(samples.count == 29)
    #expect(table.count == 29)
    #expect(Set(samples.map(\.name)).count == samples.count)
}

@Test(arguments: zip(samples, table))
func namesEachEventAndItsPropertiesAsTheSpecDoes(event: AnalyticsEvent, row: (name: String, keys: Set<String>)) {
    #expect(event.name == row.name)
    #expect(Set(event.properties.keys) == row.keys)
}

@Test func sendsEachPropertyAsItsEnumsRawValue() {
    #expect(
        AnalyticsEvent.tuneCreated(source: .searchOffer, hasKey: true, hasTuning: false).properties == [
            "source": .string("search_offer"), "has_key": .bool(true), "has_tuning": .bool(false),
        ])
    #expect(
        AnalyticsEvent.linkAdded(service: .appleMusic, via: .find).properties == [
            "service": .string("apple_music"), "via": .string("find"),
        ])
    #expect(
        AnalyticsEvent.playbackStarted(kind: .link, source: .keyboardShortcut).properties == [
            "kind": .string("link"), "source": .string("keyboard_shortcut"),
        ])
    #expect(AnalyticsEvent.scanAdded(via: .documentScanner).properties == ["via": .string("document_scanner")])
    #expect(AnalyticsEvent.catalogFiltered(filter: .learnedFrom).properties == ["filter": .string("learned_from")])
    #expect(AnalyticsEvent.exportCompleted(format: .zip).properties == ["format": .string("zip")])
    #expect(
        AnalyticsEvent.audioImported(fileCount: 3, format: .flac).properties == [
            "count_bucket": .string("1-9"), "format": .string("flac"),
        ])
    #expect(AnalyticsEvent.pitchChanged(semitones: -3).properties == ["semitones": .int(-3)])
}

@Test func sendsAStatusChangeAsTheVocabularysValues() {
    let event = AnalyticsEvent.tuneStatusChanged(from: TuneStatus("want_to_learn")!, to: TuneStatus("learning")!)
    #expect(event.properties == ["from": .string("want_to_learn"), "to": .string("learning")])
}

@Test func sendsChangedFieldsAsTheirNamesOnly() {
    #expect(
        AnalyticsEvent.tuneEdited(fieldsChanged: [.timeSignature, .alternateTitles]).properties == [
            "fields_changed": .strings(["time_signature", "alternate_titles"])
        ])
    #expect(
        AnalyticsEvent.bulkEditApplied(count: 1, fieldsChanged: [.tuning, .isCrooked]).properties == [
            "count_bucket": .string("1-9"), "fields_changed": .strings(["tuning", "is_crooked"]),
        ])
}

@Test func bucketsCountsDurationsAndSpeedsInsideTheEvent() {
    #expect(
        AnalyticsEvent.searchPerformed(resultCount: 0, tookOffer: true).properties == [
            "result_count_bucket": .string("0"), "took_offer": .bool(true),
        ])
    #expect(
        AnalyticsEvent.findRecordingsUsed(service: .slipperyHill, resultCount: 250).properties == [
            "service": .string("slippery_hill"), "result_count_bucket": .string("200+"),
        ])
    #expect(AnalyticsEvent.recordingSaved(seconds: 150).properties == ["duration_bucket": .string("2-5m")])
    #expect(AnalyticsEvent.recordingDiscarded(seconds: 10).properties == ["duration_bucket": .string("<30s")])
    #expect(AnalyticsEvent.speedChanged(rate: 1.25).properties == ["speed_bucket": .string(">1")])
    #expect(AnalyticsEvent.tunesAddedToList(count: 10).properties == ["count_bucket": .string("10-49")])
}

@Test func acceptsOnlyTheVocabularysStatuses() {
    for status in Vocabulary.statuses {
        #expect(TuneStatus(status)?.rawValue == status)
    }
    #expect(TuneStatus("mastered") == nil)
    #expect(TuneStatus("") == nil)
}

@Test func namesEveryLinkServiceTheVocabularyHas() {
    #expect(LinkService.allCases.map(\.rawValue) == Vocabulary.providers)
}

@Test func readsAnImportsFormatFromItsExtension() {
    #expect(AudioFormat(pathExtension: "m4a") == .m4a)
    #expect(AudioFormat(pathExtension: "MP3") == .mp3)
    #expect(AudioFormat(pathExtension: "wav") == .wav)
    #expect(AudioFormat(pathExtension: "aif") == .aiff)
    #expect(AudioFormat(pathExtension: "aiff") == .aiff)
    #expect(AudioFormat(pathExtension: "flac") == .flac)
    #expect(AudioFormat(pathExtension: "ogg") == .other)
    #expect(AudioFormat(pathExtension: "") == .other)
}

@Test func usesTheSnakeCaseNamesForEveryActionSource() {
    #expect(
        ActionSource.allCases.map(\.rawValue) == [
            "catalog", "tune", "list", "recordings_list", "recording", "dock", "stand", "search_offer",
            "keyboard_shortcut", "menu",
        ])
}
