import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneTestSupport
import Foundation
import SwiftUI
import Testing

@testable import CrosstuneUI

struct UsageDataTests {
    private let sink = RecordingAnalyticsSink()
    private let suite = TemporaryDefaults("UsageDataTests")

    private func defaults() -> UserDefaults {
        suite.defaults
    }

    @Test func isOffUntilAChoiceExists() throws {
        #expect(!UsageData.isEnabled(defaults: defaults()))
        #expect(UsageData.storedChoice(defaults: defaults()) == nil)
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

    @Test func turningSharingOffSendsTheEventBeforeStopping() {
        RememberedUser(defaults: defaults()).userID = "user_a"

        UsageData.change(to: false, analytics: sink.client, defaults: defaults())

        #expect(
            sink.calls == [
                .capture("usage_sharing_disabled", [:]), .flush, .setEnabled(false, rememberedUserID: "user_a"),
            ])
    }

    @Test func theSettingsToggleStoresTheChoiceAndChangesSharing() {
        let stored = StoredChoice()
        let toggle = UsageData.toggle(
            Binding(get: { stored.value }, set: { stored.value = $0 }), analytics: sink.client, defaults: defaults())

        toggle.wrappedValue = false

        #expect(!stored.value)
        #expect(!toggle.wrappedValue)
        #expect(
            sink.calls == [.capture("usage_sharing_disabled", [:]), .flush, .setEnabled(false, rememberedUserID: nil)])
    }

    @Test func turningSharingOnOnlyResumesSending() {
        UsageData.change(to: true, analytics: sink.client, defaults: defaults())

        #expect(sink.calls == [.setEnabled(true, rememberedUserID: nil)])
    }

    @Test func launchingWithSharingOffSendsNoEvent() throws {
        let store = defaults()
        store.set(false, forKey: UsageData.storageKey)

        UsageData.launch(sink.client, defaults: store, region: Self.neverAsked)

        #expect(sink.calls == [.setEnabled(false, rememberedUserID: nil)])
    }

    /// The session does not exist yet at launch, so the remembered user replaces it.
    @Test func launchPassesTheRememberedUser() {
        RememberedUser(defaults: defaults()).userID = "user_a"
        defaults().set(true, forKey: UsageData.storageKey)
        UsageData.launch(sink.client, defaults: defaults(), region: Self.neverAsked)
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
        UsageData.launch(sink.client, defaults: store, region: Self.neverAsked)
        sink.client.identify(
            userID: "u", signedUpAt: nil, catalogSize: nil, storageUsed: nil, fieldsUsed: nil, settings: [])
        #expect(sink.calls == [.setEnabled(false, rememberedUserID: nil), .identify("u", set: [:], setOnce: [:])])
    }

    @Test func launchAppliesAStoredOptInWithoutAskingTheRegion() {
        defaults().set(true, forKey: UsageData.storageKey)
        UsageData.launch(sink.client, defaults: defaults(), region: Self.neverAsked)
        #expect(sink.calls == [.setEnabled(true, rememberedUserID: nil)])
    }

    @Test func launchWithNoChoiceOptsInWhereConsentIsNotRequired() async {
        await UsageData.launch(sink.client, defaults: defaults(), region: Self.answering(false))?.value
        #expect(sink.calls == [.deferDecision, .setEnabled(true, rememberedUserID: nil)])
        #expect(UsageData.storedChoice(defaults: defaults()) == true)
    }

    @Test func launchWithNoChoiceStaysOffWhereConsentIsRequired() async {
        await UsageData.launch(sink.client, defaults: defaults(), region: Self.answering(true))?.value
        #expect(!sink.calls.contains(.setEnabled(true, rememberedUserID: nil)))
        #expect(sink.calls == [.deferDecision, .setEnabled(false, rememberedUserID: nil)])
        #expect(UsageData.storedChoice(defaults: defaults()) == false)
    }

    @Test func launchWithNoChoiceAndAnUnknownRegionStoresNothingAndStaysOff() async {
        await UsageData.launch(sink.client, defaults: defaults(), region: Self.answering(nil))?.value
        #expect(sink.calls == [.deferDecision, .setEnabled(false, rememberedUserID: nil)])
        #expect(UsageData.storedChoice(defaults: defaults()) == nil)
    }

    @Test func launchWithNoChoiceAndNoNetworkStoresNothingAndStaysOff() async {
        await UsageData.launch(sink.client, defaults: defaults(), region: { throw URLError(.notConnectedToInternet) })?
            .value
        #expect(sink.calls == [.deferDecision, .setEnabled(false, rememberedUserID: nil)])
        #expect(UsageData.storedChoice(defaults: defaults()) == nil)
    }

    @Test func aStoredChoiceOutranksTheRegion() async {
        defaults().set(false, forKey: UsageData.storageKey)
        let enabled = await UsageData.resolveDefault(defaults: defaults(), region: Self.answering(false))
        #expect(!enabled)
        #expect(UsageData.storedChoice(defaults: defaults()) == false)
    }

    @Test func aChoiceMadeWhileTheRegionLoadsOutranksIt() async {
        let store = defaults()
        let enabled = await UsageData.resolveDefault(
            defaults: store,
            region: {
                store.set(false, forKey: UsageData.storageKey)
                return Region(consentRequired: false)
            })
        #expect(!enabled)
        #expect(UsageData.storedChoice(defaults: store) == false)
    }

    @Test func resolveDefaultStoresWhatItResolves() async {
        let on = await UsageData.resolveDefault(defaults: defaults(), region: Self.answering(false))
        #expect(on)
        #expect(UsageData.storedChoice(defaults: defaults()) == true)
    }

    private static let neverAsked: @Sendable () async throws -> Region = {
        Issue.record("A stored choice must not ask the region")
        return Region(consentRequired: nil)
    }

    private static func answering(_ consentRequired: Bool?) -> @Sendable () async throws -> Region {
        { Region(consentRequired: consentRequired) }
    }
}

/// The choice a toggle's binding stores, as `@AppStorage` would.
private final class StoredChoice: @unchecked Sendable {
    var value = true
}
