import CrosstuneStore
import CrosstuneTestSupport
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
