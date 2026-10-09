import CrosstuneVocabulary
import Testing

@testable import CrosstuneAnalytics

private let tuneID = "6f1c2a9e-7d3b-4e0a-9c1f-2b8d4a6e5c70"
private let recordingID = "0b7e4f2a-3c1d-4a9b-8e6f-5d2c1b0a9f83"
private let listID = "3e8b1d7f-6a2c-4f9e-b0d4-1c5a7e9f2b06"

private let linkID = "9d3a6c1e-2f4b-4b7a-a5c8-7e1f0d2b3c94"

@Test func sendsEachPropertyAsItsEnumsRawValue() {
    #expect(
        AnalyticsEvent.tuneCreated(source: .searchOffer, fieldsSet: [.title, .key], tuneID: tuneID).properties == [
            "source": .string("search_offer"), "fields_set": .strings(["title", "key"]), "tune_id": .string(tuneID),
        ])
    #expect(
        AnalyticsEvent.linkAdded(service: .appleMusic, via: .find, linkID: linkID, tuneID: tuneID).properties == [
            "service": .string("apple_music"), "via": .string("find"), "link_id": .string(linkID),
            "tune_id": .string(tuneID),
        ])
    #expect(
        AnalyticsEvent.recordingStarted(source: .recordingScreen).properties == ["source": .string("recording_screen")])
    #expect(AnalyticsEvent.catalogFiltered(filter: .learnedFrom).properties == ["filter": .string("learned_from")])
    #expect(AnalyticsEvent.exportCompleted(format: .zip).properties == ["format": .string("zip")])
    #expect(
        AnalyticsEvent.audioImported(fileCount: 3, format: .flac).properties == [
            "count_bucket": .string("1-9"), "format": .string("flac"),
        ])
    #expect(
        AnalyticsEvent.pitchChanged(semitones: -3, recordingID: recordingID).properties == [
            "semitones": .int(-3), "recording_id": .string(recordingID),
        ])
    #expect(
        AnalyticsEvent.uploadFailed(reason: .authExpired, origin: .slipperyHill).properties == [
            "failure_reason": .string("auth_expired"), "origin": .string("slippery_hill"),
        ])
}

@Test func sendsAStatusChangeAsTheVocabularysValues() {
    let event = AnalyticsEvent.tuneStatusChanged(
        from: TuneStatus("want_to_learn")!, to: TuneStatus("learning")!, tuneID: tuneID)
    #expect(
        event.properties == ["from": .string("want_to_learn"), "to": .string("learning"), "tune_id": .string(tuneID)])
}

@Test func sendsChangedFieldsAsTheirNamesOnly() {
    #expect(
        AnalyticsEvent.tuneEdited(fieldsChanged: [.timeSignature, .alternateTitles], tuneID: tuneID).properties == [
            "fields_changed": .strings(["time_signature", "alternate_titles"]), "tune_id": .string(tuneID),
        ])
    #expect(
        AnalyticsEvent.bulkEditApplied(action: .edit, count: 1, fieldsChanged: [.tuning, .isCrooked]).properties == [
            "action": .string("edit"), "count_bucket": .string("1-9"),
            "fields_changed": .strings(["tuning", "is_crooked"]),
        ])
}

@Test func leavesOutWhatABulkActionOrAnUnfiledTakeDoesNotHave() {
    #expect(
        AnalyticsEvent.bulkEditApplied(action: .archive, count: 3, fieldsChanged: nil).properties == [
            "action": .string("archive"), "count_bucket": .string("1-9"),
        ])
    #expect(
        AnalyticsEvent.recordingSaved(seconds: 10, recordingID: recordingID, tuneID: nil).properties == [
            "duration_bucket": .string("<30s"), "filed": .bool(false), "recording_id": .string(recordingID),
        ])
    #expect(
        AnalyticsEvent.recordingSaved(seconds: 10, recordingID: recordingID, tuneID: tuneID).properties == [
            "duration_bucket": .string("<30s"), "filed": .bool(true), "recording_id": .string(recordingID),
            "tune_id": .string(tuneID),
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
    #expect(AnalyticsEvent.recordingDiscarded(seconds: 150).properties == ["duration_bucket": .string("2-5m")])
    #expect(
        AnalyticsEvent.speedChanged(rate: 1.25, recordingID: recordingID).properties == [
            "speed_bucket": .string(">1"), "recording_id": .string(recordingID),
        ])
    #expect(
        AnalyticsEvent.tunesAddedToList(listID: listID, count: 10).properties == [
            "count_bucket": .string("10-49"), "list_id": .string(listID),
        ])
    #expect(
        AnalyticsEvent.storageLimitReached(bytesUsed: 600_000_000).properties == ["storage_used": .string("500MB+")])
    #expect(
        AnalyticsEvent.tuneDeleted(tuneID: tuneID, recordings: 2, links: 0, scans: 60).properties == [
            "tune_id": .string(tuneID), "recordings_count": .string("1-9"), "links_count": .string("0"),
            "scans_count": .string("50-199"),
        ])
}

@Test func sendsAPlayAsItsListenedBucketNeverItsLength() {
    let report = PlaybackReport(
        source: .tune, queue: .single, trigger: .tap, kind: .recorded, service: nil, listenedMs: 12_345,
        completed: false, endedBy: .paused, systemControlled: true, tuneID: tuneID,
        recordingID: recordingID, linkID: nil, listID: nil)
    #expect(
        AnalyticsEvent.playbackEnded(report).properties == [
            "source": .string("tune"), "queue": .string("single"), "trigger": .string("tap"),
            "kind": .string("recorded"), "listened_bucket": .string("10-30s"), "completed": .bool(false),
            "ended_by": .string("paused"), "system_controlled": .bool(true), "tune_id": .string(tuneID),
            "recording_id": .string(recordingID),
        ])
}

@Test func sendsAPracticeVisitAsItsDurationBucketAndTools() {
    let report = PracticeReport(
        source: .dock, durationMs: 400_000, usedLoops: false, usedSpeed: true, usedPitch: false, kind: .imported,
        recordingID: recordingID, tuneID: nil)
    #expect(
        AnalyticsEvent.practiceEnded(report).properties == [
            "source": .string("dock"), "duration_bucket": .string("5m+"), "used_loops": .bool(false),
            "used_speed": .bool(true), "used_pitch": .bool(false), "kind": .string("imported"),
            "recording_id": .string(recordingID),
        ])
}

@Test func instrumentsTheVocabularyLacksAreLeftOut() {
    #expect(SettingChange.instruments(["violin", "theremin"]).value == .strings(["violin"]))
}

@Test func aSettingChangeSetsItsOwnPersonProperty() {
    let event = AnalyticsEvent.settingChanged(.searchProviders([.youtube, .appleMusic]))
    #expect(
        event.properties == ["setting": .string("search_providers"), "value": .strings(["youtube", "apple_music"])])
    #expect(event.personProperties == ["setting_search_providers": .strings(["youtube", "apple_music"])])
}

@Test func playsARecordingAsItsOrigin() {
    #expect(PlaybackKind(.recorded) == .recorded)
    #expect(PlaybackKind(.imported) == .imported)
    #expect(PlaybackKind(.slipperyHill) == .slipperyHill)
}

@Test func acceptsOnlyTheVocabularysStatuses() {
    for status in Vocabulary.statuses {
        #expect(TuneStatus(status)?.rawValue == status)
    }
    #expect(TuneStatus("mastered") == nil)
    #expect(TuneStatus("") == nil)
}

@Test func acceptsOnlyTheVocabularysAudioQualities() {
    for quality in Vocabulary.audioQualities {
        #expect(AudioQuality(quality)?.rawValue == quality)
    }
    #expect(AudioQuality("lossless") == nil)
    #expect(AudioQuality("") == nil)
}

@Test func acceptsOnlyTheVocabularysPlayFirstChoices() {
    for choice in Vocabulary.playFirsts {
        #expect(PlayFirst(choice)?.rawValue == choice)
    }
    #expect(PlayFirst("links") == nil)
    #expect(PlayFirst("") == nil)
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
            "catalog", "tune", "list", "recordings_list", "recording_screen", "dock", "search_offer", "menu",
        ])
}
