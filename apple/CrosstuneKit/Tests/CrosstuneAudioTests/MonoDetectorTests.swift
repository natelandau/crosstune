@preconcurrency import AVFoundation
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneAudio

struct MonoDetectorTests {
    private let root = TemporaryRoot()

    private func file() throws -> URL {
        try root.folder().appending(path: "\(UUID().uuidString).m4a")
    }

    @Test func aOneChannelFileIsMono() throws {
        let url = try file()
        try writeTone(to: url, seconds: 1, channels: 1)

        #expect(try MonoDetector.isMono(url: url))
    }

    @Test func theSameToneOnBothChannelsIsMono() throws {
        let url = try file()
        try writeTone(to: url, seconds: 1, bitrate: 128_000, channels: 2)

        #expect(try MonoDetector.isMono(url: url))
    }

    @Test func aToneOnTheLeftWithASilentRightIsMono() throws {
        let url = try file()
        try writeTone(to: url, seconds: 1, bitrate: 128_000, channels: 2, rightAmplitude: 0)

        #expect(try MonoDetector.isMono(url: url))
    }

    @Test func differentTonesOnEachChannelAreStereo() throws {
        let url = try file()
        try writeTone(to: url, seconds: 1, bitrate: 128_000, channels: 2, frequency: 440, rightFrequency: 660)

        #expect(try MonoDetector.isMono(url: url) == false)
    }

    @Test func theSameToneOneDecibelQuieterOnTheRightIsMono() throws {
        let url = try file()
        try writeTone(
            to: url, seconds: 1, bitrate: 128_000, channels: 2, amplitude: 0.5, rightAmplitude: 0.5 * pow(10, -1.0 / 20)
        )

        #expect(try MonoDetector.isMono(url: url))
    }

    @Test func aSilentTwoChannelFileIsMono() throws {
        let url = try file()
        try writeTone(to: url, seconds: 1, bitrate: 128_000, channels: 2, amplitude: 0)

        #expect(try MonoDetector.isMono(url: url))
    }

    @Test func theSameToneOnFourLaidOutChannelsIsMono() throws {
        let url = try root.folder().appending(path: "\(UUID().uuidString).wav")
        try writeMultichannelTone(to: url, seconds: 1, channels: 4, layout: kAudioChannelLayoutTag_Quadraphonic)

        #expect(try MonoDetector.isMono(url: url))
    }

    @Test func theSameToneOnFourChannelsWithNoLayoutIsMonoOrUnsupported() throws {
        let url = try root.folder().appending(path: "\(UUID().uuidString).wav")
        try writeMultichannelTone(to: url, seconds: 1, channels: 4)

        // Without a layout the converter may refuse to mix the channels down, which the player
        // treats as unmeasured; a mix it does make reads the same tone as mono.
        do {
            #expect(try MonoDetector.isMono(url: url))
        } catch {
            #expect(error as? CaptureError == .unsupportedFormat)
        }
    }

    @Test func aCancelledMeasurementStopsDecoding() async throws {
        let url = try file()
        try writeTone(to: url, seconds: 1, bitrate: 128_000, channels: 2)

        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await MonoDetector.measure(url: url)
        }

        await #expect(throws: CancellationError.self) { try await task.value }
    }

    @Test func theSilenceThresholdIsMeanEnergyPerSample() {
        let frames = 1000
        let under = Double(frames) * 1e-10 * 0.99
        let over = Double(frames) * 1e-10 * 1.01

        #expect(MonoDetector.isMono(left: under, right: under, cross: 0, frames: frames))
        #expect(MonoDetector.isMono(left: over, right: over, cross: 0, frames: frames) == false)
    }

    @Test func aChannelMoreThanFortyDecibelsUnderIsMono() {
        #expect(MonoDetector.isMono(left: 1, right: 1e-4 * 0.99, cross: 0, frames: 1000))
        #expect(MonoDetector.isMono(left: 1, right: 1e-4 * 1.01, cross: 0, frames: 1000) == false)
    }

    @Test func aCorrelationOfAtLeastPointNineNineNineIsMono() {
        #expect(MonoDetector.isMono(left: 1, right: 1, cross: 0.999, frames: 1000))
        #expect(MonoDetector.isMono(left: 1, right: 1, cross: 0.9991, frames: 1000))
        #expect(MonoDetector.isMono(left: 1, right: 1, cross: 0.9989, frames: 1000) == false)
    }

    @Test func aFileWithNoFramesIsMono() {
        #expect(MonoDetector.isMono(left: 0, right: 0, cross: 0, frames: 0))
    }
}
