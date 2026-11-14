import CrosstuneAudio
import CrosstuneRecording
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Synchronization
import Testing

@testable import CrosstuneUI

private final class Asked: Sendable {
    private let list = Mutex<[String]>([])
    var ids: [String] { list.withLock { $0 } }
    func add(_ id: String) { list.withLock { $0.append(id) } }
}

@Suite struct PieceAudioSourceTests {
    private let root = TemporaryRoot()

    /// A parent with audio on disk starting 5 s into the source, and a piece cut from it.
    private func seeded(pieceState: String = "processing", pieceFile: Bool = false) async throws -> CrosstuneStore {
        let store = try root.open()
        try FileManager.default.createDirectory(at: store.audioFolder, withIntermediateDirectories: true)
        try Data("audio".utf8).write(to: store.audioFolder.appending(path: "parent.m4a"))
        try Data("own".utf8).write(to: store.audioFolder.appending(path: "piece.m4a"))
        try await store.write { writer in
            try writer.put(
                Recording(id: "parent", tuneID: nil, source: "microphone", state: "ready", trimEndMs: 60_000))
            try writer.put(
                Recording(
                    id: "piece", tuneID: nil, source: "microphone", state: pieceState, trimStartMs: 60_000,
                    trimEndMs: 120_000, splitFromID: "parent"))
            try RecordingFile(id: "parent", localState: .downloaded, fileName: "parent.m4a", blobStartMs: 5000)
                .insert(writer.db)
            if pieceFile {
                try RecordingFile(id: "piece", localState: .downloaded, fileName: "piece.m4a").insert(writer.db)
            }
        }
        return store
    }

    @Test func aProcessingPieceLoadsTheParentsFileAndStart() async throws {
        let store = try await seeded()
        let asked = Asked()
        let audio = await RecordingAudioLookup.fetch("piece", store: store) { id in
            asked.add(id)
            return await store.localAudio(recordingID: id)
        }
        #expect(asked.ids == ["piece"])
        #expect(audio?.file.id == "parent")
        #expect(audio?.file.blobStartMs == 5000)
        #expect(audio?.url.lastPathComponent == "parent.m4a")
    }

    @Test func aPieceWithAFileOfItsOwnPlaysIt() async throws {
        let store = try await seeded(pieceFile: true)
        let audio = await RecordingAudioLookup.fetch("piece", store: store) { await store.localAudio(recordingID: $0) }
        #expect(audio?.file.id == "piece")
    }

    @Test func aPieceWithAFileOfItsOwnPlaysItWhenTheDownloadAnswersNothing() async throws {
        let store = try await seeded(pieceFile: true)
        let audio = await RecordingAudioLookup.fetch("piece", store: store) { _ in nil }
        #expect(audio?.file.id == "piece")
    }

    @Test func aReadyPieceNeverPlaysTheParentsFile() async throws {
        let store = try await seeded(pieceState: "ready")
        let asked = Asked()
        let audio = await RecordingAudioLookup.fetch("piece", store: store) { id in
            asked.add(id)
            return nil
        }
        #expect(asked.ids == ["piece"])
        #expect(audio == nil)
    }

    @Test func aFailedPieceNeverPlaysTheParentsFile() async throws {
        let store = try await seeded(pieceState: "failed")
        let audio = await RecordingAudioLookup.fetch("piece", store: store) { await store.localAudio(recordingID: $0) }
        #expect(audio == nil)
        let piece = try await store.read { try Recording.fetchOne($0, key: "piece") }
        #expect(RecordingAudioLookup.parentID(of: piece) == nil)
    }

    @Test func aPieceWaitsWhenTheParentIsNotOnThisDeviceAndNeverAsksForIt() async throws {
        let store = try await seeded()
        try await store.write { try $0.updateFile("parent") { $0.fileName = nil } }
        let asked = Asked()
        let audio = await RecordingAudioLookup.fetch("piece", store: store) { id in
            asked.add(id)
            return await store.localAudio(recordingID: id)
        }
        #expect(asked.ids == ["piece"])
        #expect(audio == nil)
    }

    @Test func theParentsFileWindowIsThePiecesRangeOnTheSourceTimeline() async throws {
        let store = try await seeded()
        let piece = try #require(try await store.read { try Recording.fetchOne($0, key: "piece") })
        let audio = try #require(
            await RecordingAudioLookup.fetch("piece", store: store) { await store.localAudio(recordingID: $0) })
        let window = PlaybackWindow.make(recording: piece, file: audio.file, fileDuration: 300)
        #expect(window == PlaybackWindow(from: 55, to: 115))
    }

    @Test func theWatchPicksTheParentsAudioThenThePiecesOwn() async throws {
        let store = try await seeded()
        let piece = try await store.read { try Recording.fetchOne($0, key: "piece") }
        let parentFile = try await store.read { try RecordingFile.fetchOne($0, key: "parent") }
        #expect(RecordingAudioLookup.parentID(of: piece) == "parent")
        #expect(
            RecordingAudioLookup.audioFile(recording: piece, own: nil, parent: parentFile, store: store)?.file.id
                == "parent")
        let own = RecordingFile(id: "piece", localState: .downloaded, fileName: "piece.m4a")
        #expect(
            RecordingAudioLookup.audioFile(recording: piece, own: own, parent: parentFile, store: store)?.file.id
                == "piece")
        var ready = try #require(piece)
        ready.state = "ready"
        #expect(RecordingAudioLookup.parentID(of: ready) == nil)
        #expect(RecordingAudioLookup.audioFile(recording: ready, own: nil, parent: parentFile, store: store) == nil)
    }
}
