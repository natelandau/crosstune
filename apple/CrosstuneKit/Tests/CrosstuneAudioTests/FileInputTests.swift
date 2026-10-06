#if DEBUG
    @preconcurrency import AVFoundation
    import CrosstuneAudio
    import Foundation
    import Testing

    /// Collects what a ``FileInput`` reports.
    @MainActor
    private final class Levels {
        var batches: [[Float]] = []
    }

    @MainActor
    private final class Events {
        var received: [AudioInputEvent] = []
    }

    @MainActor
    @Suite struct FileInputTests {
        private let root = FileManager.default.temporaryDirectory
            .appending(path: "FileInputTests-\(UUID().uuidString)", directoryHint: .isDirectory)

        init() throws {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        }

        /// A mono 44.1 kHz second-long tone, so the writer has to resample it.
        private func makeSource(seconds: Double = 1) throws -> URL {
            let url = root.appending(path: "source.m4a")
            let file = try AVAudioFile(
                forWriting: url,
                settings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100.0, AVNumberOfChannelsKey: 1,
                ], commonFormat: .pcmFormatFloat32, interleaved: false)
            try file.write(from: sineBuffer(seconds: seconds, sampleRate: 44_100, channels: 1))
            return url
        }

        private func makeWriter() throws -> CaptureWriter {
            try CaptureWriter(url: root.appending(path: "out.m4a"), bitrate: 64_000, channels: 1)
        }

        @Test func permissionIsGranted() async throws {
            let input = FileInput(url: try makeSource())
            #expect(await input.requestPermission())
        }

        @Test func prepareReportsTheFilesChannels() async throws {
            let input = FileInput(url: try makeSource())
            #expect(try await input.prepare(preferring: .stereo) == 1)
        }

        /// Polls until `condition` holds or ten seconds pass.
        private func waitUntil(_ condition: () -> Bool) async throws {
            let deadline = ContinuousClock.now + .seconds(10)
            while !condition(), ContinuousClock.now < deadline {
                try await Task.sleep(for: .milliseconds(20))
            }
        }

        @Test func writesTheFileFrames() async throws {
            let input = FileInput(url: try makeSource())
            let writer = try makeWriter()
            _ = try await input.prepare(preferring: .mono)
            try await input.start(writer: writer, onLevels: { _ in }, onEvent: { _ in })
            try await waitUntil { writer.duration >= 0.4 }
            await input.stop()
            #expect(writer.duration >= 0.4)
            writer.close()
        }

        @Test func keepsWritingWhileTheMainActorIsBusy() async throws {
            let input = FileInput(url: try makeSource())
            let writer = try makeWriter()
            _ = try await input.prepare(preferring: .mono)
            try await input.start(writer: writer, onLevels: { _ in }, onEvent: { _ in })
            try await waitUntil { writer.duration > 0 }
            let before = writer.duration
            // Holds the main actor without yielding, as a capture's animation work would.
            let busyUntil = ContinuousClock.now + .seconds(0.6)
            while ContinuousClock.now < busyUntil {}
            let written = writer.duration - before
            await input.stop()
            #expect(written >= 0.3)
            writer.close()
        }

        @Test func resumesAfterAFailedRead() async throws {
            let source = try makeSource(seconds: 60)
            let input = FileInput(url: source)
            let writer = try makeWriter()
            let events = Events()
            _ = try await input.prepare(preferring: .mono)
            // An emptied file makes the next read fail.
            try FileHandle(forWritingTo: source).truncate(atOffset: 4_096)
            try await input.start(
                writer: writer, onLevels: { _ in }, onEvent: { events.received.append($0) })
            try await waitUntil { events.received.count == 1 }
            try await input.resume()
            try await waitUntil { events.received.count == 2 }
            await input.stop()
            #expect(events.received == [.writeFailed, .writeFailed])
            writer.close()
        }

        @Test func reportsLevels() async throws {
            let input = FileInput(url: try makeSource())
            let writer = try makeWriter()
            let levels = Levels()
            _ = try await input.prepare(preferring: .mono)
            try await input.start(
                writer: writer, onLevels: { levels.batches.append($0) }, onEvent: { _ in })
            try await waitUntil { levels.batches.contains { $0.contains { $0 > 0 } } }
            await input.stop()
            #expect(levels.batches.contains { $0.contains { $0 > 0 } })
            writer.close()
        }

        @Test func loopsWhenATakeRunsLongerThanTheFile() async throws {
            let input = FileInput(url: try makeSource(seconds: 0.3))
            let writer = try makeWriter()
            _ = try await input.prepare(preferring: .mono)
            try await input.start(writer: writer, onLevels: { _ in }, onEvent: { _ in })
            try await waitUntil { writer.duration >= 0.5 }
            await input.stop()
            #expect(writer.duration >= 0.5)
            writer.close()
        }
    }
#endif
