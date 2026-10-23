import Foundation
import Testing

@testable import CrosstuneAudio

private let chunk = 512

private struct Push {
    /// Sample time at the end of the chunk just pushed.
    let endMs: Double
    let reading: Reading?
}

private func feed(_ tracker: PitchTracker, _ samples: [Float], sampleRate: Double, startMs: Double = 0) -> [Push] {
    samples.withUnsafeBufferPointer { buffer in
        stride(from: 0, to: buffer.count, by: chunk).map { at in
            let end = min(at + chunk, buffer.count)
            let reading = tracker.push(UnsafeBufferPointer(rebasing: buffer[at..<end]))
            return Push(endMs: startMs + Double(end) / sampleRate * 1000, reading: reading)
        }
    }
}

/// One reading per analysis, since a push between analyses repeats the last one.
private func readings(of pushes: [Push]) -> [Reading] {
    var seen: [Reading] = []
    for push in pushes {
        guard let reading = push.reading else { continue }
        if let index = seen.firstIndex(where: { $0.atMs == reading.atMs }) {
            seen[index] = reading
        } else {
            seen.append(reading)
        }
    }
    return seen
}

private func median(_ values: [Double]) -> Double {
    let sorted = values.sorted()
    let mid = sorted.count / 2
    return sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

private func centsBetween(_ frequency: Double, _ target: Double) -> Double { 1200 * log2(frequency / target) }

private let violinIndex = ClipFile.shared.clips.firstIndex { $0.id == "violin-a4-flat-2.2" }!
private let violin = ClipFile.shared.clips[violinIndex]

/// Half a second at `from`, then half a second at `to`, with no break in phase, as a string
/// sounds while its peg turns.
private func glide(_ partials: [[Double]], from: Double, to: Double, sampleRate: Double) -> [Float] {
    let count = Int(sampleRate)
    var out = [Float](repeating: 0, count: count)
    var phase = 0.0
    for i in 0..<count {
        var tone = 0.0
        for partial in partials {
            tone += partial[1] * sin(2 * .pi * partial[0] * phase)
        }
        out[i] = Float(0.2 * tone)
        phase += (Double(i) < sampleRate / 2 ? from : to) / sampleRate
    }
    return out
}

extension Tuner {
    @Suite struct PitchTrackerTests {
        @Test(arguments: IndexedClip.all)
        func readsEveryClip(clip indexed: IndexedClip) throws {
            let clip = indexed.clip
            let tracker = PitchTracker(sampleRate: clip.sampleRate, a4: clip.a4)

            let readings = readings(
                of: feed(tracker, synthesize(clip, index: indexed.index), sampleRate: clip.sampleRate))

            guard let expected = clip.expect else {
                #expect(readings.isEmpty)
                return
            }
            let first = try #require(readings.first)
            #expect(first.atMs <= (clip.lockWithinMs ?? 150))
            for reading in readings where reading.atMs > 200 {
                #expect(reading.note.name.rawValue == expected.name)
                #expect(reading.note.octave == expected.octave)
            }
            let lastHalf = readings.filter { $0.atMs >= clip.seconds * 1000 / 2 }
            try #require(!lastHalf.isEmpty)
            // A clip may loosen the bound only so far that the two platforms still agree in cents.
            #expect((clip.toleranceCents ?? 0) <= 1.5)
            let tolerance = clip.vibrato != nil ? 2 : (clip.toleranceCents ?? 0.5)
            let cents = median(lastHalf.map(\.note.cents))
            #expect(abs(cents - expected.cents) <= tolerance)
        }

        @Test func holdsSteadyOnAHeldNote() {
            let tracker = PitchTracker(sampleRate: violin.sampleRate, a4: violin.a4)

            let cents = readings(
                of: feed(tracker, synthesize(violin, index: violinIndex), sampleRate: violin.sampleRate)
            ).map(\.note.cents)

            #expect(!cents.isEmpty)
            #expect(cents.max()! - cents.min()! < 1.0)
        }

        @Test func followsAPegTurnAtOnce() throws {
            let sampleRate = violin.sampleRate
            let turned = 440 * pow(2, 25.0 / 1200)
            let tracker = PitchTracker(sampleRate: sampleRate, a4: 440)

            let pushes = feed(
                tracker, glide(violin.partials, from: 440, to: turned, sampleRate: sampleRate), sampleRate: sampleRate)

            let caughtUp = try #require(
                pushes.first { push in
                    guard push.endMs > 500, let reading = push.reading else { return false }
                    return abs(centsBetween(reading.frequency, turned)) <= 5
                })
            #expect(caughtUp.endMs <= 600)
        }

        @Test func readsABassNoteAfterAHighOneAtOnceAndInItsOwnOctave() throws {
            let sampleRate = 48_000.0
            let e1 = 440 * pow(2, -41.0 / 12)
            let bass: [[Double]] = [[1, 1], [2, 0.8], [3, 0.5]]
            let tracker = PitchTracker(sampleRate: sampleRate, a4: 440)

            let heard = readings(
                of: feed(tracker, glide(bass, from: 440, to: e1, sampleRate: sampleRate), sampleRate: sampleRate))

            let moved = try #require(
                heard.first { $0.atMs > 500 && !($0.note.name == .a && $0.note.octave == 4) })
            #expect(moved.note.name == .e)
            #expect(moved.note.octave == 1)
            // The long window's length of the new note and the median's two estimates, with no gap.
            #expect(moved.atMs <= 650)
        }

        @Test(arguments: [(440.0, true), (100, false)])
        func keepsANoteHeldBetweenTheWindowThresholdsOnItsWindow(from: Double, short: Bool) {
            let sampleRate = violin.sampleRate
            let between = 195.0
            let tracker = PitchTracker(sampleRate: sampleRate, a4: 440)

            let pushes = feed(
                tracker, glide(violin.partials, from: from, to: between, sampleRate: sampleRate),
                sampleRate: sampleRate)

            let settled = pushes.filter { push in
                guard push.endMs > 700, let reading = push.reading else { return false }
                return abs(centsBetween(reading.frequency, between)) <= 5
            }
            #expect(!settled.isEmpty)
            #expect(tracker.usesShortWindow == short)
        }

        @Test func fadesAfterTheNoteStops() throws {
            let sampleRate = violin.sampleRate
            let tracker = PitchTracker(sampleRate: sampleRate, a4: 440)

            let held = feed(
                tracker, synthesize(violin.at(frequency: 440, seconds: 0.5), index: 0), sampleRate: sampleRate)
            let silence = feed(
                tracker, [Float](repeating: 0, count: Int(sampleRate / 2)), sampleRate: sampleRate, startMs: 500)

            #expect(held.last?.reading != nil)
            let faded = try #require(silence.firstIndex { $0.reading == nil })
            #expect(silence[faded].endMs <= 800)
            #expect(silence[faded...].allSatisfy { $0.reading == nil })
        }

        @Test func setA4MovesTheCents() {
            let sampleRate = violin.sampleRate
            let tracker = PitchTracker(sampleRate: sampleRate, a4: 440)
            _ = feed(tracker, synthesize(violin.at(frequency: 440, seconds: 0.5), index: 0), sampleRate: sampleRate)

            tracker.setA4(442)
            let readings = readings(
                of: feed(
                    tracker, synthesize(violin.at(frequency: 440, seconds: 0.5), index: 1), sampleRate: sampleRate,
                    startMs: 500))

            #expect(!readings.isEmpty)
            for reading in readings {
                #expect(reading.note.name == .a)
                #expect(reading.note.octave == 4)
                #expect(abs(reading.note.cents - -7.85) < 0.5)
            }
        }

        @Test func startsOverAfterReset() throws {
            let sampleRate = violin.sampleRate
            let tracker = PitchTracker(sampleRate: sampleRate, a4: 440)
            _ = feed(tracker, synthesize(violin.at(frequency: 440, seconds: 0.5), index: 0), sampleRate: sampleRate)

            tracker.reset()
            let readings = readings(
                of: feed(tracker, synthesize(violin.at(frequency: 440, seconds: 0.3), index: 1), sampleRate: sampleRate)
            )

            let first = try #require(readings.first)
            #expect(first.atMs <= 150)
        }
    }
}
