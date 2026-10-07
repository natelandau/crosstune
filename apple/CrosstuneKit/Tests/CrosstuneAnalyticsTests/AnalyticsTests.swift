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
        sink.client.send(.tuneCreated(source: .catalog, hasKey: true, hasTuning: false))

        #expect(
            sink.captures == [
                .init(
                    name: "tune_created",
                    properties: ["source": .string("catalog"), "has_key": .bool(true), "has_tuning": .bool(false)])
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
            storageUsed: 20_000_000)

        #expect(
            sink.calls == [
                .identify(
                    "user_1", set: ["catalog_size": .string("10-49"), "storage_used": .string("10-50MB")],
                    setOnce: ["signed_up_at": .string("2026-10-07T12:00:00Z")])
            ])
    }

    @Test func leavesOutWhatItDoesNotKnow() {
        sink.client.identify(userID: "user_2", signedUpAt: nil, catalogSize: nil, storageUsed: nil)

        #expect(sink.calls == [.identify("user_2", set: [:], setOnce: [:])])
    }
}

@Test(arguments: [
    (Analytics.Device.phone, "ios", "phone"), (.pad, "ipados", "tablet"), (.mac, "macos", "desktop"),
])
func describesTheDeviceInEverySuperProperty(device: Analytics.Device, platform: String, formFactor: String) {
    #expect(
        Analytics.superProperties(device: device, appVersion: "1.4.0") == [
            "platform": platform, "form_factor": formFactor, "app_version": "1.4.0",
        ])
}

@Test func leavesOutAnUnknownAppVersion() {
    #expect(
        Analytics.superProperties(device: .mac, appVersion: nil) == ["platform": "macos", "form_factor": "desktop"])
}

@Test(arguments: [Screen.catalog, .tune, .lists, .stand])
func namesTheScreenInItsOwnPropertySoEveryClientBreaksDownTheSame(screen: Screen) {
    #expect(PostHogSink.screenProperties(for: screen) == ["screen": .string(screen.rawValue)])
}
