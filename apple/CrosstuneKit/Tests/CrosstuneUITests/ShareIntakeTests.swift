import CrosstuneAnalytics
import CrosstuneCommands
@_spi(Testing) import CrosstuneDiagnostics
import CrosstuneShare
import CrosstuneStore
import CrosstuneSync
@_spi(Testing) import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import GRDB
import Testing

@testable import CrosstuneUI

/// Items shared from other apps become links on tunes and unfiled recordings, each once, and an
/// item that failed for a reason a retry could fix stays in the inbox.
@MainActor
@Suite struct ShareIntakeTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()
    private let diagnostics = RecordingDiagnosticsSink()
    private let sharedAt: Int64 = 1_790_000_000_123
    private let resolvedTitle = "Resolved title"
    private let newTuneID = newID()

    private var container: ShareContainer { ShareContainer(root: root.url.appending(path: "group")) }

    private func intake(resolving: Bool = true) -> ShareIntake {
        let title = resolvedTitle
        return ShareIntake(
            container: container,
            resolve: { url in resolving ? ResolvedLink(provider: "other", url: url, title: title) : nil },
            analytics: sink.client, diagnostics: diagnostics.client)
    }

    private func shareLink(
        _ url: String, to tune: ShareItem.LinkTune, in store: CrosstuneStore, after seconds: Double = 0
    ) throws {
        try ShareInbox.add(
            .link(url: url, title: nil, tune: tune, sharedAt: sharedAt + Int64(seconds * 1000)), audioFrom: nil,
            userID: store.userID, in: container)
    }

    /// `fileName` is the stored name, and `sharedName` the name the file was shared under.
    private func shareAudio(
        _ fileName: String, sharedName: String? = nil, label: String, bytes: Int = 1_000, in store: CrosstuneStore
    ) throws {
        let folder = root.url.appending(path: "picked-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appending(path: fileName)
        try Data(repeating: 7, count: bytes).write(to: file)
        try shareFile(file, sharedName: sharedName, label: label, in: store)
    }

    private func shareFile(_ file: URL, sharedName: String? = nil, label: String, in store: CrosstuneStore) throws {
        let fileName = file.lastPathComponent
        try ShareInbox.add(
            .audio(fileName: fileName, sharedName: sharedName ?? fileName, label: label, sharedAt: sharedAt),
            audioFrom: file, userID: store.userID, in: container)
    }

    private func liveTunes(_ store: CrosstuneStore) async throws -> [Tune] {
        try await store.read { db in try Tune.fetchAll(db).filter { $0.deletedAt == nil } }
    }

    private func links(_ store: CrosstuneStore) async throws -> [RecordingLink] {
        try await store.read { db in try RecordingLink.fetchAll(db) }
    }

    private func recordings(_ store: CrosstuneStore) async throws -> [Recording] {
        try await store.read { db in try Recording.fetchAll(db) }
    }

    private func pending(_ store: CrosstuneStore) -> [PendingItem] {
        ShareInbox.pending(userID: store.userID, in: container)
    }

    @Test func addsALinkToThePickedTune() async throws {
        let store = try root.open()
        let tune = try await Commands(store: store).createTitleOnly(title: "Drowsy Maggie")
        try shareLink("https://example.com/a", to: .existing(id: tune.tuneID, title: "Drowsy Maggie"), in: store)

        let report = await intake().addPending(to: store)

        #expect(report == ShareIntakeReport())
        let stored = try await links(store)
        #expect(stored.map(\.tuneID) == [tune.tuneID])
        #expect(stored.map(\.title) == [resolvedTitle])
        #expect(pending(store).isEmpty)
    }

    enum NewTuneID: CaseIterable, Sendable {
        case unused
        /// Held only by a deleted tune, whose row is never revived.
        case heldByADeletedTune
        /// Not a UUID, so never stored as a key.
        case notAUUID
    }

    /// The share extension names a new tune by an ID; a second item for it adds to the same tune.
    @Test(arguments: NewTuneID.allCases)
    func createsANewTuneOnceForTwoItems(given: NewTuneID) async throws {
        let store = try root.open()
        let sharedID = given == .notAUUID ? "t1" : newTuneID
        if given == .heldByADeletedTune {
            let deleted = try await Commands(store: store).createTitleOnly(title: "Old", tuneID: sharedID)
            _ = try await Commands(store: store).deleteTuneUnlessItHasWork(deleted.tuneID)
        }
        try shareLink("https://example.com/a", to: .new(id: sharedID, title: "The Silver Spear"), in: store)
        try shareLink("https://example.com/b", to: .new(id: sharedID, title: "The Silver Spear"), in: store, after: 1)

        _ = await intake().addPending(to: store)

        let tunes = try await liveTunes(store)
        #expect(tunes.map(\.title) == ["The Silver Spear"])
        let expectedID = given == .unused ? sharedID : replacementTuneID(for: sharedID)
        #expect(tunes.map(\.id) == [expectedID])
        #expect(try await links(store).map(\.tuneID) == [expectedID, expectedID])
    }

    /// Every item for a deleted tune reaches the one tune made in its place, also from a later
    /// launch.
    @Test func recreatesADeletedTuneFromItsTitle() async throws {
        let store = try root.open()
        let tune = try await Commands(store: store).createTitleOnly(title: "Drowsy Maggie")
        _ = try await Commands(store: store).deleteTuneUnlessItHasWork(tune.tuneID)
        let picked = ShareItem.LinkTune.existing(id: tune.tuneID, title: "Drowsy Maggie")
        try shareLink("https://example.com/a", to: picked, in: store)
        _ = await intake().addPending(to: store)
        try shareLink("https://example.com/b", to: picked, in: store, after: 1)

        _ = await intake().addPending(to: store)

        let tunes = try await liveTunes(store)
        #expect(tunes.map(\.title) == ["Drowsy Maggie"])
        let newID = try #require(tunes.first?.id)
        #expect(newID != tune.tuneID)
        #expect(try await links(store).map(\.tuneID) == [newID, newID])
    }

    /// The share extension refuses these first, so one that reaches the app is reported.
    @Test(arguments: [
        "javascript:alert(1)", "", "https://example.com/" + String(repeating: "a", count: Vocabulary.Limits.Link.url),
    ])
    func refusesAndReportsALinkTheAPIWouldNotStore(url: String) async throws {
        let store = try root.open()
        try shareLink(url, to: .new(id: newTuneID, title: "The Silver Spear"), in: store)

        _ = await intake().addPending(to: store)

        #expect(try await links(store).isEmpty)
        #expect(try await liveTunes(store).isEmpty)
        #expect(pending(store).isEmpty)
        #expect(sink.calls.isEmpty)
        #expect(diagnostics.reports.map { $0.area } == [.share])
        #expect((diagnostics.reports.first?.error as? ShareIntakeProblem) == .linkNotStorable)
    }

    /// A picked tune with no row was made by an item the app has not added yet, or was deleted
    /// and is gone; either way the link reaches one tune with the picked title.
    @Test func makesAPickedTuneThatWasNeverStoredOnce() async throws {
        let store = try root.open()
        let picked = ShareItem.LinkTune.existing(id: newTuneID, title: "The Silver Spear")
        try shareLink("https://example.com/a", to: picked, in: store)
        try shareLink("https://example.com/b", to: picked, in: store, after: 1)

        _ = await intake().addPending(to: store)

        let tunes = try await liveTunes(store)
        #expect(tunes.map(\.title) == ["The Silver Spear"])
        #expect(tunes.map(\.id) == [replacementTuneID(for: newTuneID)])
        #expect(try await links(store).count == 2)
    }

    /// An item that picked a tune another item in the inbox still has to make waits for that
    /// item rather than making a tune of its own.
    @Test func aLinkToAPendingNewTuneWaitsForIt() async throws {
        let store = try root.open()
        try shareLink("https://example.com/a", to: .existing(id: newTuneID, title: "The Silver Spear"), in: store)
        try shareLink(
            "https://example.com/b", to: .new(id: newTuneID, title: "The Silver Spear"), in: store, after: 1)
        let shared = intake()

        _ = await shared.addPending(to: store)
        #expect(try await links(store).count == 1)
        _ = await shared.addPending(to: store)

        #expect(try await liveTunes(store).map(\.id) == [newTuneID])
        #expect(try await links(store).map(\.tuneID) == [newTuneID, newTuneID])
        #expect(pending(store).isEmpty)
    }

    @Test func storesAnUntitledLinkWhenTheLookupFails() async throws {
        let store = try root.open()
        try shareLink("https://example.com/a", to: .new(id: newTuneID, title: "The Silver Spear"), in: store)

        _ = await intake(resolving: false).addPending(to: store)

        let stored = try await links(store)
        #expect(stored.count == 1)
        #expect(stored.first?.title == nil)
    }

    enum Kind: CaseIterable, Sendable {
        case link, audio
    }

    /// Also after a relaunch, when no memory of the first pass is left.
    @Test(arguments: Kind.allCases, [false, true])
    func addsAnItemOnceWhenItCannotBeRemoved(kind: Kind, relaunched: Bool) async throws {
        let store = try root.open()
        switch kind {
        case .link:
            try shareLink("https://example.com/a", to: .new(id: newTuneID, title: "The Silver Spear"), in: store)
        case .audio: try shareAudio("memo.m4a", label: "Memo", in: store)
        }
        // A read-only item folder keeps its item.json, so the item stays readable.
        let item = try #require(pending(store).first).folder.path(percentEncoded: false)
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: item)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: item) }
        let shared = intake()

        _ = await shared.addPending(to: store)
        let second = await (relaunched ? intake() : shared).addPending(to: store)

        #expect(second == ShareIntakeReport())
        #expect(try await links(store).count == (kind == .link ? 1 : 0))
        #expect(try await recordings(store).count == (kind == .audio ? 1 : 0))
    }

    @Test func addsSharedAudioUnfiledWithItsLabel() async throws {
        let store = try root.open()
        try shareAudio("memo.m4a", label: "Reel in A", in: store)

        _ = await intake().addPending(to: store)

        let stored = try await recordings(store)
        #expect(stored.map(\.label) == ["Reel in A"])
        #expect(stored.map(\.tuneID) == [nil])
        #expect(pending(store).isEmpty)
    }

    enum Refused: CaseIterable, Sendable {
        case overTheLimit
        /// A QuickTime file that holds no audio to convert.
        case quickTimeThatFailsToConvert
        case empty
    }

    /// The report names each file as it was shared, not by the extension the share sheet added.
    @Test(arguments: Refused.allCases)
    func reportsAFileRefusedForGoodAndDropsIt(_ refused: Refused) async throws {
        let store = try root.open()
        try await store.setMeta(.storage, to: StorageUsage(usedBytes: 0, quotaBytes: 1_000_000, maxFileBytes: 500))
        let (name, bytes, message) =
            switch refused {
            case .overTheLimit: ("long.m4a", 1_000, AudioFileCheck.tooLarge(500))
            case .quickTimeThatFailsToConvert: ("memo.qta", 100, AudioFileCheck.notAudio)
            case .empty: ("empty.m4a", 0, AudioFileCheck.emptyFile)
            }
        let sharedName = (name as NSString).deletingPathExtension
        try shareAudio(name, sharedName: sharedName, label: "Memo", bytes: bytes, in: store)

        let report = await intake().addPending(to: store)

        #expect(
            report == ShareIntakeReport(refusedFiles: [SharedFileRefusal(fileName: sharedName, message: message)]))
        #expect(try await recordings(store).isEmpty)
        #expect(pending(store).isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath: store.audioFolder.path()).isEmpty)
    }

    @Test func keepsAnItemThatFailedForAnotherReason() async throws {
        let store = try root.open()
        try shareAudio("memo.m4a", label: "Memo", in: store)
        let folder = store.audioFolder.path(percentEncoded: false)
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: folder)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: folder) }

        let report = await intake().addPending(to: store)

        #expect(report == ShareIntakeReport())
        #expect(pending(store).count == 1)
    }

    @Test func reportsAnItemThatKeepsFailingOnce() async throws {
        let store = try root.open()
        try shareAudio("memo.m4a", label: "Memo", in: store)
        let folder = store.audioFolder.path(percentEncoded: false)
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: folder)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: folder) }
        let shared = intake()

        for _ in 0...ShareIntake.reportAfterFailures { _ = await shared.addPending(to: store) }

        #expect(pending(store).count == 1)
        #expect(diagnostics.reports.map { $0.area } == [.share])
        guard case .keepsFailing(let passes, _, _) = diagnostics.reports.first?.error as? ShareIntakeProblem else {
            Issue.record("Expected a report of an item that keeps failing")
            return
        }
        #expect(passes == ShareIntake.reportAfterFailures)
    }

    @Test func twoConcurrentIntakesAddEachItemOnce() async throws {
        let store = try root.open()
        for index in 0..<3 {
            try shareLink(
                "https://example.com/\(index)", to: .new(id: newTuneID, title: "The Silver Spear"), in: store,
                after: Double(index))
        }
        try shareAudio("memo.m4a", label: "Memo", in: store)
        let shared = intake()

        async let first = shared.addPending(to: store)
        async let second = shared.addPending(to: store)
        _ = await [first, second]

        #expect(try await links(store).count == 3)
        #expect(try await recordings(store).count == 1)
        #expect(try await liveTunes(store).count == 1)
    }

    @Test func sendsShareAnalytics() async throws {
        let store = try root.open()
        try shareLink("https://example.com/a", to: .new(id: newTuneID, title: "The Silver Spear"), in: store)
        try shareAudio("memo.m4a", label: "Memo", in: store)

        _ = await intake().addPending(to: store)

        let linkID = try #require(try await links(store).first?.id)
        #expect(sink.captures.map(\.name) == ["tune_created", "link_added", "audio_imported"])
        #expect(sink.captures[0].properties["source"] == .string("share"))
        #expect(sink.captures[0].properties["tune_id"] == .string(newTuneID))
        #expect(
            sink.captures[1].properties == [
                "service": .string("other"), "via": .string("share"), "link_id": .string(linkID),
                "tune_id": .string(newTuneID),
            ])
        #expect(
            sink.captures[2].properties == [
                "count_bucket": .string("1-9"), "format": .string("m4a"), "via": .string("share"),
            ])
    }
}
