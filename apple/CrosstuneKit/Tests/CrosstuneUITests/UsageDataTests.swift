import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

struct UsageDataTests {
    private let sink = RecordingAnalyticsSink()
    private let suite = TemporaryDefaults("UsageDataTests")

    private func defaults() -> UserDefaults {
        suite.defaults
    }

    @Test func sharesByDefault() throws {
        #expect(UsageData.isEnabled(defaults: defaults()))
    }

    @Test func readsTheStoredChoice() throws {
        let store = defaults()
        store.set(false, forKey: UsageData.storageKey)
        #expect(!UsageData.isEnabled(defaults: store))
    }

    @Test func turningItOffStopsSending() {
        UsageData.apply(false, to: sink.client, defaults: defaults())
        #expect(sink.calls == [.setEnabled(false, rememberedUserID: nil)])
    }

    @Test func turningItBackOnResumesSending() {
        UsageData.apply(false, to: sink.client, defaults: defaults())
        UsageData.apply(true, to: sink.client, defaults: defaults())
        #expect(sink.calls == [.setEnabled(false, rememberedUserID: nil), .setEnabled(true, rememberedUserID: nil)])
    }

    /// The session does not exist yet at launch, so the remembered user stands in for it.
    @Test func launchPassesTheRememberedUser() {
        RememberedUser(defaults: defaults()).userID = "user_a"
        UsageData.launch(sink.client, defaults: defaults())
        #expect(sink.calls == [.setEnabled(true, rememberedUserID: "user_a")])
    }

    @Test func turningItOnPassesTheRememberedUser() {
        RememberedUser(defaults: defaults()).userID = "user_a"
        UsageData.apply(true, to: sink.client, defaults: defaults())
        #expect(sink.calls == [.setEnabled(true, rememberedUserID: "user_a")])
    }

    @Test func launchAppliesAStoredOptOutBeforeAnyIdentify() throws {
        let store = defaults()
        store.set(false, forKey: UsageData.storageKey)
        UsageData.launch(sink.client, defaults: store)
        sink.client.identify(userID: "u", signedUpAt: nil, catalogSize: nil, storageUsed: nil)
        #expect(sink.calls == [.setEnabled(false, rememberedUserID: nil), .identify("u", set: [:], setOnce: [:])])
    }

    @Test func launchOptsInWhenNothingIsStored() throws {
        UsageData.launch(sink.client, defaults: defaults())
        #expect(sink.calls == [.setEnabled(true, rememberedUserID: nil)])
    }
}
