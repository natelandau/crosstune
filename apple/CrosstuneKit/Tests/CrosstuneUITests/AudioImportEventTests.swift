import CrosstuneAnalytics
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

/// An import reports the files it added once the batch is done, one event per format, and never
/// a file it refused.
@MainActor
@Suite struct AudioImportEventTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    private func write(_ name: String) throws -> URL {
        let folder = root.url.appending(path: "picked", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: name)
        try Data(repeating: 7, count: 1_000).write(to: url)
        return url
    }

    @Test func reportsTheFilesAddedByFormat() async throws {
        let model = RecordingsModel(store: try root.open(), analytics: sink.client)
        let urls = [try write("Jam.m4a"), try write("notes.txt"), try write("Reel.wav"), try write("Hornpipe.M4A")]

        await model.importAudio(from: urls)

        #expect(
            sink.captures == [
                .init(name: "audio_imported", properties: ["count_bucket": .string("1-9"), "format": .string("m4a")]),
                .init(name: "audio_imported", properties: ["count_bucket": .string("1-9"), "format": .string("wav")]),
            ])
    }

    @Test func reportsNothingWhenEveryFileIsRefused() async throws {
        let model = RecordingsModel(store: try root.open(), analytics: sink.client)

        await model.importAudio(from: [try write("notes.txt")])

        #expect(sink.calls.isEmpty)
    }
}
