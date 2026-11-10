import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneAudio

/// The cases the web mask passes too, so both clients shape a recording the same way.
private let gainCasesURL = URL(filePath: #filePath)
    .deletingLastPathComponent()  // CrosstuneAudioTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // CrosstuneKit
    .deletingLastPathComponent()  // apple
    .deletingLastPathComponent()  // repository root
    .appending(path: "fixtures/isolate/gain-cases.json")

private struct GainCase: Decodable {
    struct Setting: Decodable {
        var effect: String
        var panStart: Int
        var panEnd: Int
        var lowHz: Int
        var highHz: Int
    }

    var setting: Setting
    var isMono: Bool
    var pan: Float
    var hz: Float
    var gain: Float

    var isolateSetting: IsolateSetting {
        IsolateSetting(
            effect: Vocabulary.IsolateEffect(rawValue: setting.effect)!, panStart: setting.panStart,
            panEnd: setting.panEnd, lowHz: setting.lowHz, highHz: setting.highHz)
    }
}

private let sampleRates: [Double] = [44_100, 48_000]
private let block = 128
private let fftSize = 2048

private func tone(_ hz: Double, sampleRate: Double, frames: Int, amplitude: Float = 0.5) -> [Float] {
    (0..<frames).map { amplitude * Float(sin(2 * .pi * hz * Double($0) / sampleRate)) }
}

/// Deterministic white noise in -1..1 from a linear congruential generator.
private func noise(seed: UInt64, frames: Int) -> [Float] {
    var state = seed
    return (0..<frames).map { _ in
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return Float(state >> 40) / Float(1 << 24) * 2 - 1
    }
}

/// Runs the mask over whole buffers in render-sized blocks and returns the output.
private func run(_ mask: IsolateMask, _ left: [Float], _ right: [Float]) -> (left: [Float], right: [Float]) {
    var outLeft = left
    var outRight = right
    outLeft.withUnsafeMutableBufferPointer { l in
        outRight.withUnsafeMutableBufferPointer { r in
            var start = 0
            while start < l.count {
                let frames = min(block, l.count - start)
                mask.process(left: l.baseAddress! + start, right: r.baseAddress! + start, frames: frames)
                start += frames
            }
        }
    }
    return (outLeft, outRight)
}

/// RMS after the latency and a few frames of gain smoothing have passed.
private func steadyRms(_ signal: [Float]) -> Float {
    let tail = signal[(4 * fftSize)...]
    return (tail.reduce(0) { $0 + $1 * $1 } / Float(tail.count)).squareRoot()
}

private func db(_ ratio: Float) -> Float { 20 * log10(ratio) }

private func mask(
    sampleRate: Double, effect: Vocabulary.IsolateEffect = .solo, panStart: Int = -100, panEnd: Int = 100,
    lowHz: Int = 40, highHz: Int = 16_000, isMono: Bool = false
) -> IsolateMask {
    let mask = IsolateMask(sampleRate: sampleRate)
    mask.setSetting(
        IsolateSetting(effect: effect, panStart: panStart, panEnd: panEnd, lowHz: lowHz, highHz: highHz),
        isMono: isMono)
    return mask
}

struct IsolateMaskTests {
    @Test func binGainMatchesEveryParityCase() throws {
        let cases = try JSONDecoder().decode([GainCase].self, from: Data(contentsOf: gainCasesURL))
        #expect(cases.isEmpty == false)
        for c in cases {
            let gain = binGain(pan: c.pan, hz: c.hz, setting: c.isolateSetting, isMono: c.isMono)
            #expect(abs(gain - c.gain) < 1e-6, "pan \(c.pan) hz \(c.hz) \(c.setting)")
        }
    }

    @Test(arguments: sampleRates) func defaultSettingReconstructsTheInput(sampleRate: Double) {
        let frames = Int(sampleRate)
        let left = noise(seed: 1, frames: frames)
        let right = noise(seed: 2, frames: frames)
        let mask = mask(sampleRate: sampleRate)

        let out = run(mask, left, right)

        #expect(mask.latencyFrames == fftSize)
        var maxError: Float = 0
        for i in mask.latencyFrames..<frames {
            maxError = max(
                maxError, abs(out.left[i] - left[i - mask.latencyFrames]),
                abs(out.right[i] - right[i - mask.latencyFrames]))
        }
        #expect(maxError < 1e-4)
    }

    @Test(arguments: sampleRates) func soloLeftRejectsAHardRightTone(sampleRate: Double) {
        let frames = Int(sampleRate)
        let right = tone(1000, sampleRate: sampleRate, frames: frames)

        let out = run(
            mask(sampleRate: sampleRate, panStart: -100, panEnd: -20), [Float](repeating: 0, count: frames), right)

        let outRms = hypot(steadyRms(out.left), steadyRms(out.right))
        #expect(db(outRms / steadyRms(right)) < -40)
    }

    @Test(arguments: sampleRates) func soloBandPassesAnInBandToneAndRejectsAnOutOfBandTone(sampleRate: Double) {
        let frames = Int(sampleRate)
        let inBand = tone(300, sampleRate: sampleRate, frames: frames)
        let passed = run(mask(sampleRate: sampleRate, lowHz: 200, highHz: 1000), inBand, inBand)
        #expect(abs(db(steadyRms(passed.left) / steadyRms(inBand))) < 1)
        #expect(abs(db(steadyRms(passed.right) / steadyRms(inBand))) < 1)

        let outOfBand = tone(3000, sampleRate: sampleRate, frames: frames)
        let rejected = run(mask(sampleRate: sampleRate, lowHz: 200, highHz: 1000), outOfBand, outOfBand)
        #expect(db(steadyRms(rejected.left) / steadyRms(outOfBand)) < -30)
        #expect(db(steadyRms(rejected.right) / steadyRms(outOfBand)) < -30)
    }

    /// At 48 kHz a mask that assumed 44.1 kHz would place a 4400 Hz tone at about 4040 Hz,
    /// inside the 1/6-octave edge above a 4000 Hz band with a gain near 0.36 (-9 dB).
    @Test func binFrequenciesUseTheRealSampleRate() {
        let sampleRate = 48_000.0
        let frames = Int(sampleRate)
        let input = tone(4400, sampleRate: sampleRate, frames: frames)

        let out = run(mask(sampleRate: sampleRate, lowHz: 40, highHz: 4000), input, input)

        #expect(db(steadyRms(out.left) / steadyRms(input)) < -30)
        #expect(db(steadyRms(out.right) / steadyRms(input)) < -30)
    }

    @Test(arguments: sampleRates) func muteWithFullRangesSilences(sampleRate: Double) {
        let frames = Int(sampleRate)

        let out = run(
            mask(sampleRate: sampleRate, effect: .mute), noise(seed: 3, frames: frames), noise(seed: 4, frames: frames))

        #expect(out.left.allSatisfy { $0 == 0 })
        #expect(out.right.allSatisfy { $0 == 0 })
    }

    @Test(arguments: sampleRates) func monoIgnoresPan(sampleRate: Double) {
        let frames = Int(sampleRate)
        let right = tone(1000, sampleRate: sampleRate, frames: frames)

        let out = run(
            mask(sampleRate: sampleRate, panStart: -100, panEnd: -50, isMono: true),
            [Float](repeating: 0, count: frames), right)

        #expect(abs(db(steadyRms(out.right) / steadyRms(right))) < 1)
    }

    @Test(arguments: sampleRates) func resetClearsBufferedAudio(sampleRate: Double) {
        let frames = Int(sampleRate)
        let mask = mask(sampleRate: sampleRate)
        let loud = tone(440, sampleRate: sampleRate, frames: frames, amplitude: 0.9)
        _ = run(mask, loud, loud)

        mask.reset()
        let silence = [Float](repeating: 0, count: frames)
        let out = run(mask, silence, silence)

        #expect(out.left.allSatisfy { $0 == 0 })
        #expect(out.right.allSatisfy { $0 == 0 })
    }

    @Test(arguments: sampleRates) func outlinesWhereTheInputSitsInPanAndFrequency(sampleRate: Double) throws {
        let frames = Int(sampleRate)
        let mask = mask(sampleRate: sampleRate)
        #expect(mask.outline().pan.allSatisfy { $0 == 0 })

        _ = run(mask, [Float](repeating: 0, count: frames), tone(1000, sampleRate: sampleRate, frames: frames))
        let outline = mask.outline()

        #expect(outline.pan.count == 32)
        #expect(outline.freq.count == 48)
        #expect(outline.pan.max() == 1)
        #expect(outline.pan.firstIndex(of: 1) == 31)
        let peak = try #require(outline.freq.firstIndex(of: 1))
        #expect(40 * pow(16_000 / 40, Float(peak) / 48) <= 1000)
        #expect(40 * pow(16_000 / 40, Float(peak + 1) / 48) > 1000)
        #expect((outline.pan + outline.freq).allSatisfy { $0 >= 0 })

        mask.reset()
        #expect(mask.outline().freq.allSatisfy { $0 == 0 })
    }

    @Test(arguments: [Float(-100).nextDown, -100, 0, 100, Float(100).nextUp])
    func everyPanLandsInAnOutlineBin(pan: Float) {
        #expect((0..<outlinePanBins).contains(outlinePanBin(pan)))
    }

    /// Rounding puts this left-only magnitude's pan just under -100.
    @Test func aLeftOnlyBinLandsInTheFirstOutlineBin() {
        let left: Float = 1.2207125e-06
        let right: Float = 0
        #expect(outlinePanBin(100 * (right - left) / (left + right)) == 0)
    }

    @Test(arguments: sampleRates) func outlinesAHardLeftToneInTheFirstPanBin(sampleRate: Double) {
        let frames = Int(sampleRate)
        let mask = mask(sampleRate: sampleRate)
        _ = run(mask, tone(1000, sampleRate: sampleRate, frames: frames), [Float](repeating: 0, count: frames))
        #expect(mask.outline().pan.firstIndex(of: 1) == 0)
    }

    @Test func skippingTheOutlineLeavesTheAudioAndTheLastSums() {
        let left = noise(seed: 1, frames: 8 * fftSize)
        let right = noise(seed: 2, frames: 8 * fftSize)
        let measured = mask(sampleRate: 44_100, effect: .mute, panStart: -40, panEnd: 20, lowHz: 300, highHz: 3000)
        let skipped = mask(sampleRate: 44_100, effect: .mute, panStart: -40, panEnd: 20, lowHz: 300, highHz: 3000)
        skipped.measuresOutline = false

        #expect(run(skipped, left, right) == run(measured, left, right))
        #expect(skipped.outline().pan.allSatisfy { $0 == 0 })

        skipped.measuresOutline = true
        #expect(skipped.outlineIsCurrent == false)
        #expect(run(skipped, right, left) == run(measured, right, left))
        #expect(skipped.outlineIsCurrent)
        #expect(skipped.outline() == measured.outline())
    }
}
