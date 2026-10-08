import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneAnalytics

/// The tracking plan every client is checked against, read from the repository root.
private struct Plan: Decodable {
    struct Property: Decodable {
        let type: String
        let `enum`: String?
        let bucket: String?
        let format: String?
        let required: Bool?
    }

    struct Event: Decodable {
        let clients: [String]
        let builtin: Bool?
        let properties: [String: Property]?
    }

    struct SuperProperty: Decodable {
        let type: String
        let `enum`: String?
        let clients: [String]
    }

    let buckets: [String: [String]]
    let enums: [String: [String]]
    let events: [String: Event]
    let superProperties: [String: SuperProperty]
    let personProperties: [String: Property]
    let settings: [String: Property]

    enum CodingKeys: String, CodingKey {
        case buckets, enums, events, settings
        case superProperties = "super_properties"
        case personProperties = "person_properties"
    }

    static let shared: Plan = {
        let url = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "analytics/tracking-plan.json")
        do {
            return try JSONDecoder().decode(Plan.self, from: Data(contentsOf: url))
        } catch {
            fatalError("The tracking plan at \(url.path) did not load: \(error)")
        }
    }()

    /// Whether `value` is what `property` allows. A string with a format is free in shape, so
    /// only its type is checked.
    func allows(_ value: AnalyticsValue, as property: Property) -> Bool {
        switch (property.type, value) {
        case ("uuid", .string(let string)):
            UUID(uuidString: string) != nil
        case ("string", .string(let string)):
            if let bucket = property.bucket {
                buckets[bucket, default: []].contains(string)
            } else if let name = property.enum {
                enums[name, default: []].contains(string)
            } else {
                true
            }
        case ("string_list", .strings(let strings)):
            property.enum.map { name in strings.allSatisfy(enums[name, default: []].contains) } ?? true
        case ("bool", .bool), ("number", .int):
            true
        default:
            false
        }
    }
}

private let tuneID = "6f1c2a9e-7d3b-4e0a-9c1f-2b8d4a6e5c70"
private let recordingID = "0b7e4f2a-3c1d-4a9b-8e6f-5d2c1b0a9f83"
private let linkID = "9d3a6c1e-2f4b-4b7a-a5c8-7e1f0d2b3c94"
private let listID = "3e8b1d7f-6a2c-4f9e-b0d4-1c5a7e9f2b06"
private let scanID = "c2f5a8e1-4b7d-4e3a-9f6c-8b0d2e4a6c17"

/// One event of every case the app can send.
private let samples: [AnalyticsEvent] = [
    .signedIn,
    .signedOut,
    .accountDeleted,
    .accountDeletionStarted,
    .accountDeletionCancelled,
    .tuneCreated(source: .catalog, fieldsSet: [.title, .key], tuneID: tuneID),
    .tuneEdited(fieldsChanged: [.title, .key], tuneID: tuneID),
    .tuneStatusChanged(from: TuneStatus("learning")!, to: TuneStatus("known")!, tuneID: tuneID),
    .tuneArchived(tuneID: tuneID),
    .tuneUnarchived(tuneID: tuneID),
    .tuneDeleted(tuneID: tuneID, recordings: 2, links: 0, scans: 1),
    .bulkEditApplied(action: .edit, count: 60, fieldsChanged: [.status]),
    .searchPerformed(resultCount: 12, tookOffer: false),
    .catalogFiltered(filter: .key),
    .catalogSorted(sort: .played),
    .lyricsOpened(tuneID: tuneID),
    .standOpened(tuneID: tuneID),
    .listCreated(listID: listID, count: 3),
    .listRenamed(listID: listID),
    .listDeleted(listID: listID, count: 12),
    .listReordered(listID: listID),
    .tunesAddedToList(listID: listID, count: 5),
    .tunesRemovedFromList(listID: listID, count: 1),
    .recordingStarted(source: .dock),
    .recordingSaved(seconds: 95, recordingID: recordingID, tuneID: tuneID),
    .recordingDiscarded(seconds: 4),
    .audioImported(fileCount: 2, format: .mp3),
    .archiveRecordingSaved(source: .slipperyHill, recordingID: recordingID, tuneID: tuneID),
    .recordingFiled(from: .unfiled, origin: .recorded, recordingID: recordingID, tuneID: tuneID),
    .recordingUnfiled(origin: .imported, recordingID: recordingID),
    .recordingRenamed(origin: .recorded, recordingID: recordingID),
    .recordingDeleted(origin: .slipperyHill, recordingID: recordingID),
    .recordingTrimmed(recordingID: recordingID),
    .linkAdded(service: .youtube, via: .paste, linkID: linkID, tuneID: tuneID),
    .linkRemoved(service: .spotify, linkID: linkID),
    .linkOpenedExternally(service: .appleMusic, linkID: linkID),
    .findRecordingsUsed(service: .slipperyHill, resultCount: 3),
    .appleMusicAuthorized(granted: true),
    .playbackEnded(
        PlaybackReport(
            source: .list, queue: .playlist, trigger: .autoAdvance, kind: .link, service: .youtube,
            listenedMs: 45_000, completed: true, endedBy: .finished, tuneID: tuneID, recordingID: nil,
            linkID: linkID, listID: listID)),
    .playlistStarted(shuffle: true, repeat: .list, count: 8, listID: listID),
    .practiceEnded(
        PracticeReport(
            source: .recordingsList, durationMs: 150_000, usedLoops: true, usedSpeed: false, usedPitch: true,
            kind: .recorded, recordingID: recordingID, tuneID: tuneID)),
    .loopSet(recordingID: recordingID),
    .speedChanged(rate: 0.8, recordingID: recordingID),
    .pitchChanged(semitones: -2, recordingID: recordingID),
    .scanAdded(via: .camera, scanID: scanID, tuneID: tuneID),
    .scanViewed(tuneID: tuneID),
    .scanDeleted(scanID: scanID, tuneID: tuneID),
    .scansReordered(tuneID: tuneID),
    .settingChanged(.audioQuality(AudioQuality("high")!)),
    .usageSharingDisabled,
    .storageLimitReached(bytesUsed: 600_000_000),
    .uploadFailed(reason: .storageFull, origin: .recorded),
    .syncFailed(reason: .network),
    .exportCompleted(format: .zip),
    .exportFailed(format: .zip, reason: .storageFull),
]

/// Names every case with no default, so a case added to `AnalyticsEvent` fails to compile here
/// until it is added, with a sample in `samples` above.
private func hasASample(_ event: AnalyticsEvent) {
    switch event {
    case .signedIn, .signedOut, .accountDeleted, .accountDeletionStarted, .accountDeletionCancelled, .tuneCreated,
        .tuneEdited, .tuneStatusChanged, .tuneArchived, .tuneUnarchived, .tuneDeleted, .bulkEditApplied,
        .searchPerformed, .catalogFiltered, .catalogSorted, .lyricsOpened, .standOpened, .listCreated,
        .listRenamed, .listDeleted, .listReordered, .tunesAddedToList, .tunesRemovedFromList, .recordingStarted,
        .recordingSaved, .recordingDiscarded, .audioImported, .archiveRecordingSaved, .recordingFiled,
        .recordingUnfiled, .recordingRenamed, .recordingDeleted, .recordingTrimmed, .linkAdded, .linkRemoved,
        .linkOpenedExternally, .findRecordingsUsed, .appleMusicAuthorized, .playbackEnded, .playlistStarted,
        .practiceEnded, .loopSet, .speedChanged, .pitchChanged, .scanAdded, .scanViewed, .scanDeleted,
        .scansReordered, .settingChanged, .usageSharingDisabled, .storageLimitReached, .uploadFailed, .syncFailed,
        .exportCompleted, .exportFailed:
        break
    }
}

/// One change of every setting the app reports.
private let settingSamples: [SettingChange] = [
    .instruments(["violin", "five_string_banjo"]),
    .audioQuality(AudioQuality("high")!),
    .searchProviders([.youtube, .slipperyHill]),
    .playFirst(PlayFirst("recordings")!),
    .appearance(.dark),
    .textSize(3),
    .captureChannels(.stereo),
    .downloadAll(true),
]

private let plan = Plan.shared

/// The plan's own events the app sends through `AnalyticsClient.send`. Screens go through
/// `screen` instead, and builtin events come from the SDK.
private let appleEvents = plan.events.filter { name, event in
    event.clients.contains("apple") && event.builtin != true && name != "$screen"
}

@Test func everyAppleEventInThePlanHasASample() {
    samples.forEach(hasASample)
    #expect(Set(samples.map(\.name)).count == samples.count)
    #expect(Set(appleEvents.keys) == Set(samples.map(\.name)))
}

@Test(arguments: samples)
func eachSampleSendsOnlyPlanPropertiesWithEveryRequiredOne(event: AnalyticsEvent) throws {
    let properties = try #require(appleEvents[event.name]).properties ?? [:]
    let keys = Set(event.properties.keys)
    #expect(keys.isSubset(of: properties.keys))
    #expect(keys.isSuperset(of: properties.filter { $0.value.required == true }.keys))
}

@Test(arguments: samples)
func eachValueMatchesItsPlanType(event: AnalyticsEvent) throws {
    let properties = try #require(appleEvents[event.name]).properties ?? [:]
    for (key, value) in event.properties {
        // A setting's value takes its type from the plan's settings, checked in everySettingIsInThePlan.
        if event.name == "setting_changed", key == "value" { continue }
        let property = try #require(properties[key])
        #expect(plan.allows(value, as: property), "\(event.name).\(key) = \(value)")
    }
}

@Test func theScreenEventCarriesThePlansProperties() throws {
    let properties = try #require(plan.events["$screen"]?.properties)
    for screen in Screen.allCases {
        let sent = PostHogSink.screenProperties(for: screen)
        #expect(Set(sent.keys) == Set(properties.keys))
        for (key, value) in sent {
            #expect(plan.allows(value, as: try #require(properties[key])))
        }
    }
}

/// Each Swift enum's raw values beside the plan enum they stand for.
private let pairedEnums: [(name: String, rawValues: [String])] = [
    ("source", ActionSource.allCases.map(\.rawValue)),
    ("origin", RecordingOrigin.allCases.map(\.rawValue)),
    ("kind", PlaybackKind.allCases.map(\.rawValue)),
    ("queue", PlaybackQueue.allCases.map(\.rawValue)),
    ("trigger", PlaybackTrigger.allCases.map(\.rawValue)),
    ("ended_by", PlaybackEnd.allCases.map(\.rawValue)),
    ("repeat", RepeatMode.allCases.map(\.rawValue)),
    ("filed_from", FiledFrom.allCases.map(\.rawValue)),
    ("sort", CatalogSort.allCases.map(\.rawValue)),
    ("bulk_action", BulkAction.allCases.map(\.rawValue)),
    ("failure_reason", FailureReason.allCases.map(\.rawValue)),
    ("service", LinkService.allCases.map(\.rawValue)),
    ("link_via", LinkVia.allCases.map(\.rawValue)),
    ("scan_via", ScanVia.allCases.map(\.rawValue)),
    ("tune_field", TuneField.allCases.map(\.rawValue)),
    ("filter", CatalogFilterKind.allCases.map(\.rawValue)),
    ("screen", Screen.allCases.map(\.rawValue)),
    ("audio_format", AudioFormat.allCases.map(\.rawValue)),
    ("export_format", ExportFormat.allCases.map(\.rawValue)),
    ("archive_source", ArchiveSource.allCases.map(\.rawValue)),
    ("audio_quality", Vocabulary.audioQualities),
    ("play_first", Vocabulary.playFirsts),
    ("appearance", AppearanceChoice.allCases.map(\.rawValue)),
    ("capture_channels", ChannelChoice.allCases.map(\.rawValue)),
    ("tune_status", Vocabulary.statuses),
    ("instrument", Vocabulary.instruments),
]

@Test(arguments: pairedEnums)
func swiftEnumsMatchThePlansEnums(name: String, rawValues: [String]) throws {
    #expect(Set(rawValues) == Set(try #require(plan.enums[name])))
}

@Test func bucketsReturnOnlyPlanValues() throws {
    let megabyte: Int64 = 1_000_000
    let returned: [(bucket: String, values: [String])] = [
        ("count", [-1, 0, 1, 9, 10, 49, 50, 199, 200, 5_000].map(Bucket.count)),
        ("duration", [0, 29.9, 30, 119.9, 120, 299.9, 300, 3_600].map { Bucket.duration(seconds: $0) }),
        (
            "listened",
            [0, 9_999, 10_000, 29_999, 30_000, 119_999, 120_000, 299_999, 300_000].map { Bucket.listened(ms: $0) }
        ),
        ("bytes", [0, 1, 10 * megabyte, 50 * megabyte, 500 * megabyte, 5_000 * megabyte].map(Bucket.bytes)),
        ("speed", [0.5, 0.75, 0.99, 1, 1.25, 2].map(Bucket.speed)),
    ]
    for (bucket, values) in returned {
        #expect(Set(values) == Set(try #require(plan.buckets[bucket])), "\(bucket)")
    }
}

@Test(arguments: [Analytics.Device.phone, .pad, .mac])
func superPropertiesAreThePlans(device: Analytics.Device) throws {
    let sent = Analytics.superProperties(device: device, appVersion: "1.4.0")
    let planned = plan.superProperties.filter { $0.value.clients.contains("apple") }
    #expect(Set(sent.keys) == Set(planned.keys))
    for (key, value) in sent {
        let property = try #require(planned[key])
        if let name = property.enum {
            #expect(plan.enums[name, default: []].contains(value), "\(key) = \(value)")
        }
    }
}

@Test(arguments: settingSamples)
func everySettingIsInThePlan(change: SettingChange) throws {
    #expect(Set(settingSamples.map(\.name)) == Set(plan.settings.keys))
    #expect(plan.enums["setting", default: []].contains(change.name))
    #expect(plan.allows(change.value, as: try #require(plan.settings[change.name])))

    let event = AnalyticsEvent.settingChanged(change)
    #expect(event.properties == ["setting": .string(change.name), "value": change.value])
    for (key, value) in event.personProperties {
        #expect(plan.allows(value, as: try #require(plan.personProperties[key])), "\(key)")
    }
}

@Test func onlyASettingChangeSetsPersonProperties() {
    for event in samples {
        if case .settingChanged = event { continue }
        #expect(event.personProperties.isEmpty, "\(event.name)")
    }
}

@Test func identifySetsOnlyPlanPersonProperties() throws {
    let sink = RecordingAnalyticsSink()
    sink.client.identify(
        userID: "user_1", signedUpAt: Date(timeIntervalSince1970: 1_791_374_400), catalogSize: 42,
        storageUsed: 20_000_000, fieldsUsed: [.title, .lyrics], settings: settingSamples)

    guard case .identify(_, let set, let setOnce) = try #require(sink.calls.first) else {
        Issue.record("expected an identify")
        return
    }
    #expect(Set(set.keys).union(setOnce.keys) == Set(plan.personProperties.keys))
    for (key, value) in set.merging(setOnce, uniquingKeysWith: { old, _ in old }) {
        #expect(plan.allows(value, as: try #require(plan.personProperties[key])), "\(key)")
    }
}
