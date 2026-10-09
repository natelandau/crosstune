import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneCommands

@Suite struct SettingsIDTests {
    @Test func isStableForOneUserAndDistinctAcrossUsers() {
        #expect(settingsID(clerkUserID: "user_1") == settingsID(clerkUserID: "user_1"))
        #expect(settingsID(clerkUserID: "user_1") != settingsID(clerkUserID: "user_2"))
    }

    @Test func matchesTheWebClientsDerivationForTheSameUser() {
        // Golden values from the `uuid` npm package's v5 over the same namespace, so both
        // clients converge on one settings row for a given Clerk user id.
        #expect(settingsID(clerkUserID: "user_1") == "a1e77df3-556d-5fd2-a1ca-b5e4928735b5")
        #expect(settingsID(clerkUserID: "user_2") == "809838a4-3b2c-54a3-9adf-a4500d2ad180")
    }
}

@Suite struct SetInstrumentsTests {
    @Test func writesOneRowAndQueuesIt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        try await commands.setInstruments(
            clerkUserID: "user_1", instruments: ["violin", "five_string_banjo"], at: noon)

        let id = settingsID(clerkUserID: "user_1")
        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.instruments == ["violin", "five_string_banjo"])
        #expect(row.createdAt == noon)
        #expect(row.updatedAt == noon)
        #expect(row.deletedAt == nil)
        #expect(row.serverSeq == 0)
        let batch = try await store.pendingChanges(limit: 10)
        #expect(batch.count == 1)
        #expect(batch[0].tableName == .userSettings)
        #expect(batch[0].rowID == id)
        #expect(batch[0].op == .upsert)
        #expect(batch[0].data?["instruments"] == .array([.string("violin"), .string("five_string_banjo")]))
        #expect(batch[0].data?["created_at"] == .string(noon.iso))
    }

    @Test func updatesTheSameRowOnASecondCallAndKeepsCreatedAt() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        try await commands.setInstruments(clerkUserID: "user_1", instruments: ["violin"], at: noon)
        try await commands.setInstruments(
            clerkUserID: "user_1", instruments: ["five_string_banjo"], at: later(5 * 60 * 1000))

        let id = settingsID(clerkUserID: "user_1")
        #expect(try await store.read { db in try UserSettings.fetchCount(db) } == 1)
        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.instruments == ["five_string_banjo"])
        #expect(row.createdAt == noon)
        #expect(row.updatedAt == later(5 * 60 * 1000))
    }

    @Test func dedupesARepeatedInstrument() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        try await commands.setInstruments(clerkUserID: "user_1", instruments: ["violin", "violin"], at: noon)

        let id = settingsID(clerkUserID: "user_1")
        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.instruments == ["violin"])
    }
}

@Suite struct ToggleInstrumentSettingTests {
    @Test func preservesAnInstrumentThisClientDoesNotRecognize() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let id = settingsID(clerkUserID: "user_1")
        try await store.write { writer in
            try writer.put(
                UserSettings(id: id, createdAt: noon, instruments: ["violin", "harmonica"]), at: noon)
        }

        try await commands.toggleInstrumentSetting(clerkUserID: "user_1", instrument: "five_string_banjo", on: true)

        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.instruments == ["violin", "five_string_banjo", "harmonica"])
    }

    @Test func dedupesARepeatedUnrecognizedInstrument() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let id = settingsID(clerkUserID: "user_1")
        try await store.write { writer in
            try writer.put(
                UserSettings(id: id, createdAt: noon, instruments: ["violin", "harmonica", "harmonica"]), at: noon)
        }

        try await commands.toggleInstrumentSetting(clerkUserID: "user_1", instrument: "five_string_banjo", on: true)

        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.instruments == ["violin", "five_string_banjo", "harmonica"])
    }

    @Test func togglesOnFromNoRow() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        try await commands.toggleInstrumentSetting(clerkUserID: "user_1", instrument: "five_string_banjo", on: true)

        let id = settingsID(clerkUserID: "user_1")
        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.instruments == ["five_string_banjo"])
    }

    @Test func togglesTheOnlyInstrumentOff() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let id = settingsID(clerkUserID: "user_1")
        try await store.write { writer in
            try writer.put(UserSettings(id: id, createdAt: noon, instruments: ["violin"]), at: noon)
        }

        try await commands.toggleInstrumentSetting(clerkUserID: "user_1", instrument: "violin", on: false)

        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.instruments == [])
    }

    @Test func appliesBothTogglesWhenTwoAreIssuedWithoutAwaitingTheFirst() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        async let first: Void = commands.toggleInstrumentSetting(
            clerkUserID: "user_1", instrument: "five_string_banjo", on: true)
        async let second: Void = commands.toggleInstrumentSetting(
            clerkUserID: "user_1", instrument: "violin", on: false)
        _ = try await (first, second)

        let id = settingsID(clerkUserID: "user_1")
        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.instruments == ["five_string_banjo"])
    }

    @Test func keepsTheAudioQualityWhenInstrumentsChangeAndSetsItOnItsOwn() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        try await commands.setAudioQuality(clerkUserID: "user_1", quality: "high", at: noon)
        try await commands.toggleInstrumentSetting(
            clerkUserID: "user_1", instrument: "five_string_banjo", on: true, at: later(1))

        let id = settingsID(clerkUserID: "user_1")
        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.audioQuality == "high")
        #expect(row.instruments.contains("five_string_banjo"))
        let entry = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == id })
        #expect(entry.data?["audio_quality"] == .string("high"))
    }
}

@Suite struct FiveStringBanjoTests {
    @Test func isStoredAndPushedUnderItsOwnName() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        try await commands.setInstruments(clerkUserID: "user_1", instruments: ["five_string_banjo"], at: noon)

        let id = settingsID(clerkUserID: "user_1")
        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.instruments == ["five_string_banjo"])
        let entry = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == id })
        #expect(entry.data?["instruments"] == .array([.string("five_string_banjo")]))
    }
}

@Suite struct CaptureBitrateTests {
    @Test func followsTheAudioQualitySetting() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        #expect(try await commands.captureBitrate() == 64_000)

        try await commands.setAudioQuality(clerkUserID: store.userID, quality: "high")
        #expect(try await commands.captureBitrate() == 128_000)

        try await commands.setAudioQuality(clerkUserID: store.userID, quality: "low")
        #expect(try await commands.captureBitrate() == 48_000)
    }
}

private let everyService = [
    "apple_music", "tidal", "internet_archive", "slippery_hill", "youtube", "spotify", "bandcamp", "soundcloud",
]

@Suite struct SearchableProvidersTests {
    @Test func isEveryProviderButOtherInResultGroupOrder() {
        #expect(searchableProviders == everyService)
        #expect(Set(searchableProviders) == Set(Vocabulary.providers).subtracting(["other"]))
        #expect(searchableProviders.count == Set(searchableProviders).count)
        #expect(UserSettings.defaultSearchProviders == searchableProviders)
    }
}

@Suite struct ToggleSearchProviderTests {
    private func row(_ store: CrosstuneStore) async throws -> UserSettings {
        let id = settingsID(clerkUserID: "user_1")
        return try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
    }

    private func seed(_ store: CrosstuneStore, _ providers: [String]) async throws {
        let id = settingsID(clerkUserID: "user_1")
        try await store.write { writer in
            try writer.put(UserSettings(id: id, createdAt: noon, searchProviders: providers), at: noon)
        }
    }

    @Test func turnsOneOffFromNoRowAndQueuesTheRest() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)

        try await commands.toggleSearchProvider(clerkUserID: "user_1", provider: "spotify", on: false, at: noon)

        let rest = everyService.filter { $0 != "spotify" }
        #expect(try await row(store).searchProviders == rest)
        let batch = try await store.pendingChanges(limit: 10)
        #expect(batch.count == 1)
        #expect(batch[0].tableName == .userSettings)
        #expect(batch[0].op == .upsert)
        #expect(batch[0].data?["search_providers"] == .array(rest.map(JSONValue.string)))
    }

    @Test func turnsOneOnInCanonicalOrder() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, ["tidal"])

        try await Commands(store: store).toggleSearchProvider(clerkUserID: "user_1", provider: "youtube", on: true)

        #expect(try await row(store).searchProviders == ["tidal", "youtube"])
    }

    @Test func neverStoresOther() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, ["tidal"])

        try await Commands(store: store).toggleSearchProvider(clerkUserID: "user_1", provider: "other", on: true)

        #expect(try await row(store).searchProviders == ["tidal"])
    }

    @Test func keepsAServiceThisClientDoesNotRecognizeAfterTheKnownOnes() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, ["mixcloud", "tidal", "mixcloud"])

        try await Commands(store: store).toggleSearchProvider(clerkUserID: "user_1", provider: "youtube", on: true)

        #expect(try await row(store).searchProviders == ["tidal", "youtube", "mixcloud"])
    }

    @Test func turningTheLastOneOffLeavesNone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, ["tidal"])

        try await Commands(store: store).toggleSearchProvider(clerkUserID: "user_1", provider: "tidal", on: false)

        #expect(try await row(store).searchProviders == [])
    }

    @Test func aDeletedRowSearchesEveryService() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        try await seed(store, ["tidal"])
        try await store.write { writer in
            try writer.tombstone(UserSettings.self, id: settingsID(clerkUserID: "user_1"), at: later(1))
        }

        try await Commands(store: store).toggleSearchProvider(
            clerkUserID: "user_1", provider: "youtube", on: false, at: later(2))

        let stored = try await row(store)
        #expect(stored.deletedAt == nil)
        #expect(stored.searchProviders == everyService.filter { $0 != "youtube" })
    }
}

@Suite struct SettingsWritesKeepOtherFieldsTests {
    @Test func settingInstrumentsKeepsSearchProvidersAndFieldsThisBuildDoesNotModel() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = settingsID(clerkUserID: "user_1")
        try await store.write { writer in
            try writer.put(
                UserSettings(id: id, createdAt: noon, searchProviders: ["tidal"], extra: ["theme": .string("dark")]),
                at: noon)
        }

        try await Commands(store: store).setInstruments(clerkUserID: "user_1", instruments: ["violin"], at: later(1))

        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.instruments == ["violin"])
        #expect(row.searchProviders == ["tidal"])
        #expect(row.extra == ["theme": .string("dark")])
        let entry = try #require(try await store.pendingChanges(limit: 10).first { $0.rowID == id })
        #expect(entry.data?["search_providers"] == .array([.string("tidal")]))
        #expect(entry.data?["theme"] == .string("dark"))
    }

    @Test func togglingAServiceKeepsInstrumentsAndAudioQuality() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        try await commands.setInstruments(clerkUserID: "user_1", instruments: ["guitar"], at: noon)
        try await commands.setAudioQuality(clerkUserID: "user_1", quality: "high", at: later(1))

        try await commands.toggleSearchProvider(clerkUserID: "user_1", provider: "tidal", on: false, at: later(2))

        let id = settingsID(clerkUserID: "user_1")
        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.instruments == ["guitar"])
        #expect(row.audioQuality == "high")
        #expect(!row.searchProviders.contains("tidal"))
    }

    @Test func everySettingsEditKeepsPlayFirst() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let id = settingsID(clerkUserID: "user_1")
        try await store.write { writer in
            try writer.put(UserSettings(id: id, createdAt: noon, playFirst: UserSettings.playFirstAppleMusic), at: noon)
        }

        try await commands.setInstruments(clerkUserID: "user_1", instruments: ["guitar"], at: later(1))
        try await commands.setAudioQuality(clerkUserID: "user_1", quality: "high", at: later(2))
        try await commands.toggleSearchProvider(clerkUserID: "user_1", provider: "tidal", on: false, at: later(3))

        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.playFirst == UserSettings.playFirstAppleMusic)
        let entry = try #require(try await store.pendingChanges(limit: 10).last)
        #expect(entry.data?["play_first"] == .string(UserSettings.playFirstAppleMusic))
    }

    @Test func aPlayFirstThisBuildDoesNotKnowSurvivesOtherEdits() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = settingsID(clerkUserID: "user_1")
        try await store.write { writer in
            try writer.put(UserSettings(id: id, createdAt: noon, playFirst: "future_choice"), at: noon)
        }

        try await Commands(store: store).setInstruments(clerkUserID: "user_1", instruments: ["guitar"], at: later(1))

        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.playFirst == "future_choice")
        let entry = try #require(try await store.pendingChanges(limit: 10).last)
        #expect(entry.data?["play_first"] == .string("future_choice"))
        #expect(storedPlayFirst(row) == UserSettings.defaultPlayFirst)
    }

    @Test func anAudioQualityThisBuildDoesNotKnowSurvivesOtherEdits() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = settingsID(clerkUserID: "user_1")
        try await store.write { writer in
            try writer.put(UserSettings(id: id, createdAt: noon, audioQuality: "lossless"), at: noon)
        }

        try await Commands(store: store).setInstruments(clerkUserID: "user_1", instruments: ["guitar"], at: later(1))

        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.audioQuality == "lossless")
        let entry = try #require(try await store.pendingChanges(limit: 10).last)
        #expect(entry.data?["audio_quality"] == .string("lossless"))
    }

    @Test func setPlayFirstKeepsTheOtherSettings() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        try await commands.setInstruments(clerkUserID: "user_1", instruments: ["violin"], at: noon)
        try await commands.setAudioQuality(clerkUserID: "user_1", quality: "high", at: later(1))

        try await commands.setPlayFirst(
            clerkUserID: "user_1", playFirst: UserSettings.playFirstAppleMusic, at: later(2))

        let id = settingsID(clerkUserID: "user_1")
        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.playFirst == UserSettings.playFirstAppleMusic)
        #expect(row.instruments == ["violin"])
        #expect(row.audioQuality == "high")
        #expect(row.updatedAt == later(2))
        let entry = try #require(try await store.pendingChanges(limit: 10).last)
        #expect(entry.data?["play_first"] == .string(UserSettings.playFirstAppleMusic))
    }
}

@Suite struct NewTuneDefaultsTests {
    @Test func aNewRowStartsWithNoGenreAndWantToLearn() async throws {
        let root = TemporaryRoot()
        let store = try root.open()

        try await Commands(store: store).setInstruments(clerkUserID: "user_1", instruments: ["violin"], at: noon)

        let id = settingsID(clerkUserID: "user_1")
        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.newTuneGenre == nil)
        #expect(row.newTuneStatus == "want_to_learn")
        let entry = try #require(try await store.pendingChanges(limit: 10).last)
        #expect(entry.data?["new_tune_status"] == .string("want_to_learn"))
    }

    @Test func setsAGenreAndAStatusAndKeepsTheOtherSettings() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        try await commands.setAudioQuality(clerkUserID: "user_1", quality: "high", at: noon)

        try await commands.setNewTuneGenre(clerkUserID: "user_1", genre: "Old-time", at: later(1))
        try await commands.setNewTuneStatus(clerkUserID: "user_1", status: "known", at: later(2))

        let id = settingsID(clerkUserID: "user_1")
        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.audioQuality == "high")
        #expect(row.newTuneGenre == "Old-time")
        #expect(row.newTuneStatus == "known")
        let entry = try #require(try await store.pendingChanges(limit: 10).last)
        #expect(entry.data?["new_tune_genre"] == .string("Old-time"))
        #expect(entry.data?["new_tune_status"] == .string("known"))
    }

    @Test func storesAGenreAsTypedAndABlankOneAsNone() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let commands = Commands(store: store)
        let id = settingsID(clerkUserID: "user_1")

        try await commands.setNewTuneGenre(clerkUserID: "user_1", genre: "Cape ", at: noon)
        #expect(try await store.read { db in try UserSettings.fetchOne(db, key: id) }?.newTuneGenre == "Cape ")
        try await commands.setNewTuneGenre(clerkUserID: "user_1", genre: "   ", at: later(1))
        #expect(try await store.read { db in try UserSettings.fetchOne(db, key: id) }?.newTuneGenre == nil)
    }

    @Test func everySettingsEditKeepsTheNewTuneDefaults() async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let id = settingsID(clerkUserID: "user_1")
        try await store.write { writer in
            try writer.put(
                UserSettings(id: id, createdAt: noon, newTuneGenre: "Irish", newTuneStatus: "future_status"), at: noon)
        }

        try await Commands(store: store).setInstruments(clerkUserID: "user_1", instruments: ["guitar"], at: later(1))

        let row = try #require(try await store.read { db in try UserSettings.fetchOne(db, key: id) })
        #expect(row.newTuneGenre == "Irish")
        #expect(row.newTuneStatus == "future_status")
        #expect(storedNewTuneStatus(row) == "want_to_learn")
    }
}
