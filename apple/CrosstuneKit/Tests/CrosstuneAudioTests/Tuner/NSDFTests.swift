import Foundation
import Testing

@testable import CrosstuneAudio

private let sampleRate = 48_000.0

private func tone(_ frequency: Double, _ partials: [(Double, Double)], amplitude: Double, ms: Double = 85)
    -> [Float]
{
    (0..<Int((sampleRate * ms / 1000).rounded())).map { i in
        var sum = 0.0
        for (harmonic, weight) in partials {
            sum += weight * sin(2 * .pi * harmonic * frequency * Double(i) / sampleRate)
        }
        return Float(amplitude * sum)
    }
}

private func estimate(_ samples: [Float]) -> PitchEstimate? {
    samples.withUnsafeBufferPointer { estimatePitch($0, sampleRate: sampleRate) }
}

private func cents(_ frequency: Double, _ target: Double) -> Double { 1200 * log2(frequency / target) }

extension Tuner {
    @Suite struct NSDFTests {
        @Test func readsAPureToneToATenthOfACent() throws {
            let estimate = try #require(estimate(tone(440, [(1, 1)], amplitude: 0.2)))

            #expect(abs(cents(estimate.frequency, 440)) < 0.1)
            #expect(estimate.clarity > 0.99)
        }

        @Test func readsABassEWithAWeakFundamentalAtItsFundamentalNotTheOctave() throws {
            let partials = [(1.0, 0.08), (2, 1), (3, 0.6), (4, 0.3)]

            let estimate = try #require(estimate(tone(41.2034, partials, amplitude: 0.25)))

            #expect(abs(cents(estimate.frequency, 41.2034)) < 0.5)
        }

        @Test func readsNothingBelowTheLevelFloor() {
            #expect(estimate(tone(440, [(1, 1)], amplitude: 0.005)) == nil)
        }

        @Test func readsNothingInLoudMainsHum() {
            let hum = [(1.0, 1.0), (2, 0.5), (3, 0.25)]

            #expect(estimate(tone(60, hum, amplitude: 0.0316)) == nil)
            #expect(estimate(tone(50, hum, amplitude: 0.0316)) == nil)
        }

        @Test func readsNothingBelowTheLowestPitchInAnyWindowOfTheClips() {
            var lowest: [Double] = []
            for indexed in IndexedClip.all {
                let clip = indexed.clip
                let samples = synthesize(clip, index: indexed.index)
                let window = Int((clip.sampleRate * Tracker.longWindowSeconds).rounded())
                let hop = Int((clip.sampleRate * Tracker.hopSeconds).rounded())
                // Windows end where a tracker's analyses do.
                let first = (window + hop - 1) / hop * hop
                samples.withUnsafeBufferPointer { buffer in
                    for end in stride(from: first, through: buffer.count, by: hop) {
                        let slice = UnsafeBufferPointer(rebasing: buffer[(end - window)..<end])
                        if let estimate = estimatePitch(slice, sampleRate: clip.sampleRate),
                            estimate.frequency < Tracker.minHz * 0.99
                        {
                            lowest.append(estimate.frequency)
                        }
                    }
                }
            }

            #expect(lowest.isEmpty)
        }

        @Test func readsNothingInAnEmptyWindow() {
            #expect(estimate([Float](repeating: 0, count: 4080)) == nil)
        }
    }
}
