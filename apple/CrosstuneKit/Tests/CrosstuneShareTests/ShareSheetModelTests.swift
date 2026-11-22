import CrosstuneShare
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import Testing
import UniformTypeIdentifiers

@MainActor
struct ShareSheetModelTests {
    let root = TemporaryRoot()
    /// Carries a fraction of a millisecond, which a stored share time drops.
    let now = Date(timeIntervalSince1970: 1_790_000_000.123_456)
    let nowInMilliseconds: Int64 = 1_790_000_000_123

    private func signedIn() throws -> ShareContainer {
        let container = ShareContainer(root: try root.folder())
        try container.setCurrentUserID("user_a")
        return container
    }

    private func model(_ container: ShareContainer) -> ShareSheetModel {
        let now = now
        return ShareSheetModel(container: container, now: { now })
    }

    @Test func showsSignedOutWithNoCurrentUser() throws {
        let model = model(ShareContainer(root: try root.folder()))
        model.received(url: "https://example.com", title: nil)

        #expect(model.state == .signedOut)
        #expect(self.model(try signedIn()).state == .loading)
    }

    /// The same links the app refuses, so the sheet never says a link saved that the app drops.
    @Test(arguments: [
        "spotify:track:1", "mailto:a@example.com", "file:///tmp/memo.m4a",
        "https://example.com/" + String(repeating: "a", count: Vocabulary.Limits.Link.url),
    ])
    func refusesALinkTheAppWouldNotStore(url: String) throws {
        let model = model(try signedIn())

        #expect(!model.received(url: url, title: nil))
        #expect(model.state == .loading)
    }

    @Test func searchIncludesTunesStillInTheInbox() async throws {
        let container = try signedIn()
        let listed = ShareTuneEntry(id: "t1", title: "Drowsy Maggie", detail: "Reel")
        try ShareTuneList.write([listed], userID: "user_a", in: container)
        let pending = ShareItem.link(
            url: "https://example.com", title: nil, tune: .new(id: "t2", title: "Maggie's Jig"),
            sharedAt: nowInMilliseconds)
        try ShareInbox.add(pending, audioFrom: nil, userID: "user_a", in: container)

        let model = model(container)
        await model.loadTunes()
        model.query = "maggie"

        #expect(model.results == [listed, ShareTuneEntry(id: "t2", title: "Maggie's Jig", detail: nil)])
        #expect(model.offersCreate)
    }

    nonisolated static let drowsyMaggie = ShareTuneEntry(id: "t1", title: "Drowsy Maggie", detail: nil)

    @Test(arguments: [ShareChoice.tune(drowsyMaggie), .newTune])
    func savingWritesALinkItemForTheChosenTune(_ choice: ShareChoice) throws {
        let container = try signedIn()
        try ShareTuneList.write([Self.drowsyMaggie], userID: "user_a", in: container)
        let model = model(container)
        model.received(url: "https://example.com/a", title: "A video")
        model.query = "  Kesh  "
        model.choice = choice

        try model.saveChoice()

        let items = ShareInbox.pending(userID: "user_a", in: container).map(\.item)
        guard case .link(let url, let title, let tune, let sharedAt) = try #require(items.first) else {
            Issue.record("Expected a link item")
            return
        }
        #expect(items.count == 1)
        #expect(url == "https://example.com/a")
        #expect(title == "A video")
        #expect(sharedAt == nowInMilliseconds)
        switch (choice, tune) {
        case (.tune, .existing(let id, let title)):
            #expect(id == "t1")
            #expect(title == "Drowsy Maggie")
        case (.newTune, .new(let id, let title)):
            #expect(UUID(uuidString: id) != nil)
            #expect(title == "Kesh")
        default:
            Issue.record("Wrong tune: \(tune)")
        }
        #expect(model.state == .saved(ShareText.savedLink))
    }

    /// A choice the search no longer shows is cleared, so a save never goes to a tune out of view.
    @Test(arguments: [
        (ShareChoice.tune(drowsyMaggie), "maggie", true),
        (.tune(drowsyMaggie), "kesh", false),
        (.newTune, "kesh", true),
        (.newTune, "  ", false),
    ])
    func aChoiceStaysOnlyWhileTheSearchShowsIt(choice: ShareChoice, query: String, kept: Bool) async throws {
        let container = try signedIn()
        try ShareTuneList.write([Self.drowsyMaggie], userID: "user_a", in: container)
        let model = model(container)
        await model.loadTunes()
        model.query = "drowsy"
        model.choice = choice

        model.query = query

        #expect(model.choice == (kept ? choice : nil))
    }

    /// A file stored under an added extension is labeled and refused by the name it was shared under.
    @Test func savesAcceptedAudioAndListsRefusedFiles() async throws {
        let container = try signedIn()
        let folder = try root.folder().appending(path: "incoming", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let memo = folder.appending(path: "memo.dat.m4a")
        try Data([1, 2, 3]).write(to: memo)
        let empty = folder.appending(path: "empty.dat.m4a")
        try Data().write(to: empty)
        let model = model(container)

        await model.received(audioFiles: [
            IncomingFile(url: memo, type: .mpeg4Audio, bytes: 3, sharedName: "memo.dat", label: "memo"),
            IncomingFile(url: empty, type: .mpeg4Audio, bytes: 0, sharedName: "empty.dat", label: "empty"),
        ])

        let pending = ShareInbox.pending(userID: "user_a", in: container)
        let items = pending.map(\.item)
        let moved = try #require(pending.first?.audioFile)
        #expect(try FileHandle(forReadingFrom: moved).readToEnd() == Data([1, 2, 3]))
        #expect(!FileManager.default.fileExists(atPath: memo.path))
        guard case .audio(let fileName, let sharedName, let label, let sharedAt) = try #require(items.first) else {
            Issue.record("Expected an audio item")
            return
        }
        #expect(items.count == 1)
        #expect(fileName == "memo.dat.m4a")
        #expect(sharedName == "memo.dat")
        #expect(label == "memo")
        #expect(sharedAt == nowInMilliseconds)
        #expect(model.state == .refused([AudioFileCheck.refused("empty.dat", AudioFileCheck.emptyFile)]))
        #expect(!FileManager.default.fileExists(atPath: empty.path))
    }

    /// `url` as the extension hands it over, shared under its own name.
    private func incoming(_ url: URL, bytes: Int64) -> IncomingFile {
        IncomingFile(
            url: url, type: .mpeg4Audio, bytes: bytes, sharedName: url.lastPathComponent,
            label: url.deletingPathExtension().lastPathComponent)
    }

    private func audioFile(_ name: String, bytes: Int = 3) throws -> URL {
        let folder = try root.folder().appending(path: "incoming", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appending(path: name)
        try Data(repeating: 1, count: bytes).write(to: file)
        return file
    }

    /// Puts a file where the user's inbox folder goes, so every save fails.
    private func blockInbox(_ container: ShareContainer) throws {
        let user = container.userFolder("user_a")
        try FileManager.default.createDirectory(at: user, withIntermediateDirectories: true)
        try Data().write(to: user.appending(path: "inbox"))
    }

    enum Failure: CaseIterable {
        /// One file saves, one is refused, and one is gone before it can be saved.
        case partial
        /// The inbox cannot be written.
        case total
        /// The only shared file could not be read.
        case unread
    }

    @Test(arguments: Failure.allCases)
    func aFailedAudioSaveSaysSoAndKeepsWhatSaved(_ failure: Failure) async throws {
        let container = try signedIn()
        let model = model(container)
        let memo = try audioFile("memo.m4a")
        let empty = try audioFile("empty.m4a", bytes: 0)
        let gone = try root.folder().appending(path: "gone.m4a")

        switch failure {
        case .partial:
            await model.received(audioFiles: [
                incoming(memo, bytes: 3),
                incoming(empty, bytes: 0),
                incoming(gone, bytes: 3),
            ])
        case .total:
            try blockInbox(container)
            await model.received(audioFiles: [incoming(memo, bytes: 3)])
        case .unread:
            await model.received(audioFiles: [], unread: 1)
        }

        let saved = ShareInbox.pending(userID: "user_a", in: container).count
        switch failure {
        case .partial:
            #expect(saved == 1)
            #expect(
                model.state
                    == .refused([
                        ShareText.savedRecordings(1), AudioFileCheck.refused("empty.m4a", AudioFileCheck.emptyFile),
                        ShareText.saveFailed,
                    ]))
        case .total, .unread:
            #expect(saved == 0)
            #expect(model.state == .refused([ShareText.saveFailed]))
        }
    }

    @Test func aFailedLinkSaveSaysSoAndStaysOpen() throws {
        let container = try signedIn()
        try blockInbox(container)
        let model = model(container)
        model.received(url: "https://example.com", title: nil)

        model.choice = .tune(ShareTuneEntry(id: "t1", title: "Kesh", detail: nil))
        #expect(throws: (any Error).self) {
            try model.saveChoice()
        }
        #expect(model.state == .link(url: "https://example.com", title: nil))
        #expect(model.failure == ShareText.saveFailed)
    }

    @Test func cancellingSavesNoFurtherFiles() async throws {
        let container = try signedIn()
        let model = model(container)
        let files = [try audioFile("one.m4a"), try audioFile("two.m4a")]

        let save = Task {
            await model.received(audioFiles: files.map { incoming($0, bytes: 3) })
        }
        save.cancel()
        await save.value

        #expect(ShareInbox.pending(userID: "user_a", in: container).isEmpty)
        #expect(files.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) })
    }

    @Test(arguments: [(20, true), (21, false)])
    func refusesMoreFilesThanTheLimit(count: Int, accepted: Bool) throws {
        let model = model(try signedIn())

        #expect(model.receivingAudio(count: count) == accepted)
        #expect(model.state == (accepted ? .audio : .refused([ShareText.tooManyFiles])))
    }
}
