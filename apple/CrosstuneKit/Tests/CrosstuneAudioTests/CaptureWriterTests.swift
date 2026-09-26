@preconcurrency import AVFoundation
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneAudio

@Suite struct CaptureWriterTests {
    @Test func convertsAStereoInputToMono48kHzAAC() async throws {
        let root = TemporaryRoot()
        let folder = try root.open().audioFolder
        let url = folder.appending(path: CaptureFiles.captureName(newID()))

        let writer = try writeTone(to: url, seconds: 1)

        let file = try AVAudioFile(forReading: url)
        #expect(file.fileFormat.sampleRate == 48_000)
        #expect(file.fileFormat.channelCount == 1)
        #expect(file.fileFormat.streamDescription.pointee.mFormatID == kAudioFormatMPEG4AAC)
        #expect(abs(writer.duration - 1) < 0.01)
        #expect(abs(try await duration(of: url) - 1) < 0.1)
    }

    @Test(arguments: [48_000, 64_000, 128_000])
    func writesAtEveryQualitysBitrate(bitrate: Int) async throws {
        let root = TemporaryRoot()
        let folder = try root.open().audioFolder
        let url = folder.appending(path: CaptureFiles.captureName(newID()))

        try writeTone(to: url, seconds: 0.5, bitrate: bitrate)

        #expect(try await duration(of: url) > 0.4)
    }

    @Test func aCaptureNeverClosedStillPlays() async throws {
        let root = TemporaryRoot()
        let folder = try root.open().audioFolder
        let url = folder.appending(path: CaptureFiles.captureName(newID()))
        let killed = folder.appending(path: CaptureFiles.captureName(newID()))

        let writer = try writeTone(to: url, seconds: 2, close: false)
        // The file as a crash would leave it: whatever reached disk, never finalized.
        try FileManager.default.copyItem(at: url, to: killed)
        writer.close()

        #expect(try await duration(of: killed) > 1.5)
    }

    @Test func keepsOneFileWhenTheInputFormatChangesMidway() async throws {
        let root = TemporaryRoot()
        let folder = try root.open().audioFolder
        let url = folder.appending(path: CaptureFiles.captureName(newID()))
        let writer = try CaptureWriter(url: url, bitrate: 64_000)

        for _ in 0..<10 { try writer.write(sineBuffer(seconds: 0.1, sampleRate: 44_100, channels: 2)) }
        for _ in 0..<10 { try writer.write(sineBuffer(seconds: 0.1, sampleRate: 16_000, channels: 1)) }
        for _ in 0..<10 { try writer.write(sineBuffer(seconds: 0.1, sampleRate: 48_000, channels: 1)) }
        writer.close()

        #expect(abs(writer.duration - 3) < 0.01)
        #expect(abs(try await duration(of: url) - 3) < 0.1)
    }

    @Test func writesNothingAfterClosing() throws {
        let root = TemporaryRoot()
        let folder = try root.open().audioFolder
        let writer = try writeTone(to: folder.appending(path: "a.aac"), seconds: 0.5)

        try writer.write(sineBuffer(seconds: 0.5))

        #expect(abs(writer.duration - 0.5) < 0.01)
    }
}

@Suite struct InputLevelsTests {
    @Test func measuresSixtyLevelsASecondAsRootMeanSquare() {
        var meter = LevelMeter()

        let levels = meter.levels(of: sineBuffer(seconds: 1, sampleRate: 48_000, channels: 1))

        #expect(levels.count == 60)
        // A sine's RMS is its amplitude over the square root of two.
        #expect(levels.allSatisfy { abs($0 - 0.5 / Float(2).squareRoot()) < 0.01 })
    }

    @Test func holdsSixtyASecondAcrossBuffersThatSplitASlice() {
        var meter = LevelMeter()
        var count = 0

        // 4096-frame buffers end partway through an 800-frame slice every time.
        for _ in 0..<47 { count += meter.levels(of: sineBuffer(seconds: 4096 / 48_000, sampleRate: 48_000)).count }

        #expect(count == 47 * 4096 / 800)
    }

    @Test func takesTheLoudestChannel() {
        let buffer = sineBuffer(seconds: 0.1, sampleRate: 48_000, channels: 2)
        for frame in 0..<Int(buffer.frameLength) { buffer.floatChannelData![0][frame] = 0 }
        var meter = LevelMeter()

        let levels = meter.levels(of: buffer)

        #expect(levels.allSatisfy { $0 > 0.3 })
    }

    @Test func silenceIsZero() {
        var meter = LevelMeter()

        let levels = meter.levels(of: sineBuffer(seconds: 0.1, sampleRate: 48_000, channels: 1, amplitude: 0))

        #expect(levels.allSatisfy { $0 == 0 })
    }

    @Test func clampsToOne() {
        var meter = LevelMeter()

        let levels = meter.levels(of: sineBuffer(seconds: 0.1, sampleRate: 48_000, channels: 1, amplitude: 4))

        #expect(levels.allSatisfy { $0 == 1 })
    }

    @Test func keepsOnlyTheNewestLevels() {
        var levels = InputLevels()

        levels.append(contentsOf: Array(repeating: 0, count: InputLevels.capacity))
        levels.append(contentsOf: [0.5, 1])

        #expect(levels.values.count == InputLevels.capacity)
        #expect(levels.values.suffix(2) == [0.5, 1])
    }
}
