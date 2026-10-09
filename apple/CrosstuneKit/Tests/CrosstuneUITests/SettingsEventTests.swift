import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

/// A setting reports its new value once the musician's change is stored, and nothing for a change
/// that arrives from another device or a write that is refused.
@MainActor
@Suite struct SettingsEventTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    private func loaded(_ store: CrosstuneStore) async throws -> SettingsModel {
        let model = SettingsModel(store: store, engine: nil, analytics: sink.client)
        #expect(try await poll { model.isLoaded })
        return model
    }

    private func changed(_ name: String, _ value: AnalyticsValue) -> RecordingAnalyticsSink.Capture {
        .init(
            name: "setting_changed", properties: ["setting": .string(name), "value": value],
            set: ["setting_\(name)": value])
    }

    @Test func changingAudioQualityReportsTheSettingAndValue() async throws {
        let store = try root.open()
        let model = try await loaded(store)

        model.setAudioQuality("high")

        #expect(try await poll { sink.captures.count == 1 })
        #expect(sink.captures == [changed("audio_quality", .string("high"))])
    }

    @Test func choosingTheQualityAlreadyChosenReportsNothing() async throws {
        let store = try root.open()
        let model = try await loaded(store)

        model.setAudioQuality(SettingsModel.defaultQuality)
        model.setPlayFirst(model.playFirst)
        model.setKeepsOffline(false)
        model.setAudioQuality("low")

        #expect(try await poll { sink.captures.count == 1 })
        #expect(sink.captures == [changed("audio_quality", .string("low"))])
    }

    @Test func reportsPlayFirstDownloadAllAndTheInstrumentsPlayed() async throws {
        let store = try root.open()
        let model = try await loaded(store)

        model.setPlayFirst("apple_music")
        model.setKeepsOffline(true)
        model.setPlays("mandolin", true)
        model.setPlays("violin", true)

        #expect(try await poll { sink.captures.count == 4 })
        #expect(
            sink.captures == [
                changed("play_first", .string("apple_music")), changed("download_all", .bool(true)),
                changed("instruments", .strings(["mandolin"])),
                changed("instruments", .strings(["violin", "mandolin"])),
            ])
    }

    /// The audio quality change queued last settles last, so the captures before it are final.
    @Test func reportsANewTuneStatusOnceAndNotWhenPickedAgain() async throws {
        let store = try root.open()
        let model = try await loaded(store)

        model.setNewTuneStatus(model.newTuneStatus)
        model.setNewTuneStatus("learning")
        model.setNewTuneStatus("learning")
        model.setAudioQuality("low")

        #expect(try await poll { sink.captures.count == 2 })
        #expect(
            sink.captures == [
                changed("new_tune_status", .string("learning")), changed("audio_quality", .string("low")),
            ])
    }

    @Test func reportsAGenreBeingSetOnceHoweverManyKeysAreTyped() async throws {
        let store = try root.open()
        let model = try await loaded(store)

        for typed in ["R", "Re", "Reel", "Reels", "Reels "] { model.setNewTuneGenre(typed) }
        model.setAudioQuality("low")

        #expect(try await poll { sink.captures.count == 2 })
        #expect(
            sink.captures == [
                changed("new_tune_genre_set", .bool(true)), changed("audio_quality", .string("low")),
            ])
    }

    @Test func reportsAClearedGenreOnce() async throws {
        let store = try root.open()
        let model = try await loaded(store)

        for typed in ["Reel", "Ree", "", " "] { model.setNewTuneGenre(typed) }
        model.setAudioQuality("low")

        #expect(try await poll { sink.captures.count == 3 })
        #expect(
            sink.captures == [
                changed("new_tune_genre_set", .bool(true)), changed("new_tune_genre_set", .bool(false)),
                changed("audio_quality", .string("low")),
            ])
    }

    @Test func reportsAGenreSetByALaterKeystrokeWhenTheFirstOneFails() async throws {
        let store = try root.open()
        let model = try await loaded(store)
        try await store.write { writer in
            for event in ["INSERT", "UPDATE"] {
                try writer.db.execute(
                    sql: """
                        CREATE TRIGGER refuse_genre_\(event.lowercased()) BEFORE \(event) ON user_settings
                        WHEN NEW.new_tune_genre = 'R' BEGIN SELECT RAISE(ABORT, 'refused'); END
                        """)
            }
        }

        model.setNewTuneGenre("R")
        model.setNewTuneGenre("Re")
        model.setAudioQuality("low")

        #expect(try await poll { sink.captures.count == 2 })
        #expect(
            sink.captures == [
                changed("new_tune_genre_set", .bool(true)), changed("audio_quality", .string("low")),
            ])
    }

    @Test func reportsTheServicesSearchedAfterAToggle() async throws {
        let store = try root.open()
        try await Commands(store: store).toggleSearchProvider(clerkUserID: store.userID, provider: "tidal", on: false)
        let model = try await loaded(store)

        model.setSearches("youtube", false)

        #expect(try await poll { sink.captures.count == 1 })
        let services = try #require(sink.captures.first?.properties["value"])
        guard case .strings(let names) = services else {
            Issue.record("The value is not a list of services")
            return
        }
        #expect(!names.contains("youtube") && !names.contains("tidal"))
        #expect(names.contains("spotify"))
        #expect(sink.captures.first?.set["setting_search_providers"] == services)
    }

    @Test func aChangeFromAnotherDeviceReportsNothing() async throws {
        let store = try root.open()
        let model = try await loaded(store)

        try await Commands(store: store).setAudioQuality(clerkUserID: store.userID, quality: "highest")
        try await store.setMeta(.keepOffline, to: true)

        #expect(try await poll { model.audioQuality == "highest" && model.keepsOffline })
        #expect(sink.calls.isEmpty)
    }

    @Test func aRefusedChoiceReportsNothing() async throws {
        let store = try root.open()
        let model = try await loaded(store)

        try store.close()
        model.setAudioQuality("high")

        #expect(try await poll { model.qualityFailure != nil })
        #expect(sink.calls.isEmpty)
    }

    @Test func aRefusedNewTuneChoiceReportsNothing() async throws {
        let store = try root.open()
        let model = try await loaded(store)

        try store.close()
        model.setNewTuneStatus("known")
        model.setNewTuneGenre("Reel")

        #expect(try await poll { model.newTuneStatusFailure != nil && model.newTuneGenreFailure != nil })
        #expect(sink.calls.isEmpty)
    }

    @Test func appearanceAndChannelsReportUnderTheirOwnNames() {
        for appearance in Appearance.allCases {
            #expect(AppearanceChoice(appearance).rawValue == appearance.rawValue)
        }
        for channels in CaptureChannels.allCases {
            #expect(ChannelChoice(channels).rawValue == channels.rawValue)
        }
    }

    @Test func deviceSettingsReadWhatTheDeviceHolds() throws {
        let suite = TemporaryDefaults("DeviceSettingsTests")
        #expect(
            DeviceSettings.current(defaults: suite.defaults) == [
                .appearance(.system), .textSize(0), .captureChannels(.mono),
            ])

        suite.defaults.set("dark", forKey: Appearance.storageKey)
        suite.defaults.set(2, forKey: TextSize.storageKey)
        suite.defaults.set("stereo", forKey: CaptureChannels.storageKey)

        #expect(
            DeviceSettings.current(defaults: suite.defaults) == [
                .appearance(.dark), .textSize(2), .captureChannels(.stereo),
            ])
    }
}
