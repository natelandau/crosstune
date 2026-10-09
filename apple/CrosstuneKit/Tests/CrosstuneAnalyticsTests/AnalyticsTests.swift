import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneAnalytics

@MainActor
struct AnalyticsTests {
    private let host = URL(string: "https://relay.example.com")!
    private let sink = RecordingAnalyticsSink()

    @Test func staysOffWithoutAToken() {
        #expect(Analytics.start(token: nil, host: host).isNoop)
        #expect(Analytics.start(token: "", host: host).isNoop)
        #expect(Analytics.start(token: "  \n", host: host).isNoop)
    }

    @Test func sendsAnEventToTheSinkByNameAndProperties() {
        let tuneID = "6f1c2a9e-7d3b-4e0a-9c1f-2b8d4a6e5c70"
        sink.client.send(.tuneCreated(source: .catalog, fieldsSet: [.title], tuneID: tuneID))

        #expect(
            sink.calls == [
                .capture(
                    "tune_created",
                    ["source": .string("catalog"), "fields_set": .strings(["title"]), "tune_id": .string(tuneID)],
                    set: [:])
            ])
    }

    @Test func aSettingChangeSetsItsPersonProperty() {
        sink.client.send(.settingChanged(.audioQuality(AudioQuality("high")!)))

        #expect(
            sink.captures == [
                .init(
                    name: "setting_changed",
                    properties: ["setting": .string("audio_quality"), "value": .string("high")],
                    set: ["setting_audio_quality": .string("high")])
            ])
    }

    @Test func disableSharingSendsTheEventAndFlushesBeforeStopping() {
        sink.client.disableSharing(rememberedUserID: "user_a")

        #expect(
            sink.calls == [
                .capture("usage_sharing_disabled", [:], set: [:]), .flush,
                .setEnabled(false, rememberedUserID: "user_a"),
            ])
    }

    @Test func forwardsScreensResetsAndTheOptOut() {
        let analytics = sink.client

        analytics.screen(.stand)
        analytics.setEnabled(false, rememberedUserID: "user_a")
        analytics.reset()
        analytics.setEnabled(true, rememberedUserID: nil)

        #expect(
            sink.calls == [
                .screen(.stand), .setEnabled(false, rememberedUserID: "user_a"), .reset,
                .setEnabled(true, rememberedUserID: nil),
            ])
    }

    @Test func identifiesWithTheSignUpDayOnceAndTheBucketsEachTime() {
        sink.client.identify(
            userID: "user_1", signedUpAt: Date(timeIntervalSince1970: 1_791_374_400), catalogSize: 42,
            storageUsed: 20_000_000, fieldsUsed: [.title, .lyrics], settings: [.textSize(2), .downloadAll(false)])

        #expect(
            sink.calls == [
                .identify(
                    "user_1",
                    set: [
                        "catalog_size": .string("10-49"), "storage_used": .string("10-50MB"),
                        "fields_used": .strings(["title", "lyrics"]), "setting_text_size": .int(2),
                        "setting_download_all": .bool(false),
                    ],
                    setOnce: ["signed_up_at": .string("2026-10-07T12:00:00Z")])
            ])
    }

    @Test func identifySendsAssistiveTech() {
        sink.client.identify(
            userID: "user_3", signedUpAt: nil, catalogSize: nil, storageUsed: nil, fieldsUsed: nil, settings: [],
            assistiveTech: [.voiceover])
        sink.client.identify(
            userID: "user_3", signedUpAt: nil, catalogSize: nil, storageUsed: nil, fieldsUsed: nil, settings: [],
            assistiveTech: [])

        #expect(
            sink.calls == [
                .identify("user_3", set: ["assistive_tech": .strings(["voiceover"])], setOnce: [:]),
                .identify("user_3", set: ["assistive_tech": .strings([])], setOnce: [:]),
            ])
    }

    @Test func leavesOutWhatItDoesNotKnow() {
        sink.client.identify(
            userID: "user_2", signedUpAt: nil, catalogSize: nil, storageUsed: nil, fieldsUsed: nil, settings: [])

        #expect(sink.calls == [.identify("user_2", set: [:], setOnce: [:])])
    }
}

@Test(arguments: [
    (Analytics.Device.phone, "ios", "phone"), (.pad, "ipados", "tablet"), (.mac, "macos", "desktop"),
])
func describesTheDeviceInEverySuperProperty(device: Analytics.Device, platform: String, formFactor: String) {
    #expect(
        Analytics.superProperties(device: device, appVersion: "1.4.0") == [
            "product": "app", "platform": platform, "form_factor": formFactor, "app_version": "1.4.0",
        ])
}

@Test func leavesOutAnUnknownAppVersion() {
    #expect(
        Analytics.superProperties(device: .mac, appVersion: nil) == [
            "product": "app", "platform": "macos", "form_factor": "desktop",
        ])
}

@Test(arguments: [Screen.catalog, .tune, .lists, .stand])
func namesTheScreenInItsOwnPropertySoEveryClientBreaksDownTheSame(screen: Screen) {
    #expect(PostHogSink.screenProperties(for: screen) == ["screen": .string(screen.rawValue)])
}
