@preconcurrency import AVFoundation
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Synchronization
import Testing

@testable import CrosstuneAudio

@MainActor
@Suite struct PeaksTests {
    @Test func roundTripsThroughEncodedBytes() throws {
        let peaks = Peaks(values: (0..<10).map { UInt8($0 * 20) })

        let decoded = try Peaks(file: peaks.encoded())

        #expect(decoded == peaks)
    }

    @Test func aWrongVersionThrows() {
        #expect(throws: (any Error).self) { try Peaks(file: Data([2, 0, 50, 10, 20])) }
    }

    @Test func aWrongPointsPerSecondThrows() {
        #expect(throws: (any Error).self) { try Peaks(file: Data([1, 0, 25, 10, 20])) }
    }

    @Test func fittedResamplesToTheFinalDurationTakingTheLoudestOfEachWindow() {
        let fitted = Peaks.fitted([10, 200, 30, 5], durationMs: 40)

        #expect(fitted == [200, 30])
    }

    @Test func readingATwoSecondToneYieldsAboutOneHundredLoudValues() async throws {
        let root = TemporaryRoot()
        let url = try root.open().audioFolder.appending(path: "\(newID()).m4a")
        try writeTone(to: url, seconds: 2, amplitude: 0.9)

        let peaks = try await Peaks.read(from: url)

        #expect(peaks.pointsPerSecond == Peaks.pointsPerSecond)
        #expect(abs(peaks.values.count - 100) <= 1)
        #expect(peaks.values.allSatisfy { $0 > 200 })
    }

    @MainActor
    @Test func decodingRunsOffTheCallersActorRatherThanBlockingIt() async throws {
        // Traps if this test is not genuinely isolated to the main actor, so the call below is a
        // real test of what happens when a main-actor caller awaits the decode.
        MainActor.assertIsolated()
        let root = TemporaryRoot()
        let url = try root.open().audioFolder.appending(path: "\(newID()).m4a")
        try writeTone(to: url, seconds: 1)
        let ranOnMainThread = Mutex<Bool?>(nil)

        _ = try await Peaks.decode(url, onStart: { ranOnMainThread.withLock { $0 = Thread.isMainThread } })

        #expect(ranOnMainThread.withLock { $0 } == false)
    }
}

@Suite struct PeakMeterTests {
    @Test func carriesPartialWindowsAcrossBuffersAt48kHz() {
        var meter = PeakMeter()
        var count = 0

        for _ in 0..<3 { count += meter.peaks(of: sineBuffer(seconds: 4096 / 48_000, sampleRate: 48_000)).count }

        #expect(count == 3 * 4096 / 960)
    }

    @Test func scalesTheLoudestSampleToAByte() {
        var meter = PeakMeter()

        let peaks = meter.peaks(of: sineBuffer(seconds: 0.1, sampleRate: 48_000, channels: 1, amplitude: 1))

        #expect(peaks.allSatisfy { $0 >= 250 })
    }

    @Test func silenceIsZero() {
        var meter = PeakMeter()

        let peaks = meter.peaks(of: sineBuffer(seconds: 0.1, sampleRate: 48_000, channels: 1, amplitude: 0))

        #expect(peaks.allSatisfy { $0 == 0 })
    }
}
