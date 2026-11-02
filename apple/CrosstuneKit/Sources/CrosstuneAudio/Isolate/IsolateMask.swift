import Accelerate
import CrosstuneVocabulary
import Foundation

private let fftLog2Size: vDSP_Length = 11
private let fftSize = 1 << Int(fftLog2Size)
private let halfSize = fftSize / 2
private let hop = 512
private let bins = halfSize + 1
// Hann windows at a quarter-size hop sum to 2.
private let overlapScale: Float = 0.5
// A forward then inverse real FFT in vDSP returns the input scaled by twice the size.
private let roundTripScale = 1 / Float(2 * fftSize)
private let panEdge: Float = 10
private let freqEdgeOctaves: Float = 1.0 / 6
private let panMin = Float(Vocabulary.Ranges.Recording.isolatePanStart.lowerBound)
private let panMax = Float(Vocabulary.Ranges.Recording.isolatePanEnd.upperBound)
private let hzMin = Float(Vocabulary.Ranges.Recording.isolateLowHz.lowerBound)
private let hzMax = Float(Vocabulary.Ranges.Recording.isolateHighHz.upperBound)
private let smoothPrevious: Float = 0.6
private let smoothNew: Float = 0.4
private let silentMagnitude: Float = 1e-9
let outlinePanBins = 32
let outlineFreqBins = 48

private func raisedCosine(_ t: Float) -> Float {
    if t <= 0 { return 0 }
    if t >= 1 { return 1 }
    return 0.5 - 0.5 * cos(.pi * t)
}

private func rangeWeight(_ x: Float, lo: Float, hi: Float, min: Float, max: Float, edge: Float) -> Float {
    let low = lo <= min ? 1 : raisedCosine((x - lo) / edge + 0.5)
    let high = hi >= max ? 1 : raisedCosine((hi - x) / edge + 0.5)
    return low * high
}

private func panWeight(_ pan: Float, setting: IsolateSetting, isMono: Bool) -> Float {
    isMono
        ? 1
        : rangeWeight(
            pan, lo: Float(setting.panStart), hi: Float(setting.panEnd), min: panMin, max: panMax, edge: panEdge)
}

private func freqWeight(log2Hz: Float, setting: IsolateSetting) -> Float {
    rangeWeight(
        log2Hz, lo: log2(Float(setting.lowHz)), hi: log2(Float(setting.highHz)), min: log2(hzMin),
        max: log2(hzMax), edge: freqEdgeOctaves)
}

private func gain(inRange: Float, effect: Vocabulary.IsolateEffect) -> Float {
    switch effect {
    case .solo: inRange
    case .mute: 1 - inRange
    }
}

/// The mask's gain for a bin at `pan` (-100..100) and `hz`.
public func binGain(pan: Float, hz: Float, setting: IsolateSetting, isMono: Bool) -> Float {
    let inRange = panWeight(pan, setting: setting, isMono: isMono) * freqWeight(log2Hz: log2(hz), setting: setting)
    return gain(inRange: inRange, effect: setting.effect)
}

/// Input magnitude of the mask's last frame by pan and by log frequency, each scaled to 0..1.
public struct IsolateOutline: Equatable, Sendable {
    /// 32 bins from hard left to hard right.
    public var pan: [Float]
    /// 48 bins spaced evenly in log frequency from 40 Hz to 16 kHz.
    public var freq: [Float]

    /// Scales the mask's raw magnitude sums, `outlinePanBins` and `outlineFreqBins` long.
    init(panSums: UnsafePointer<Float>, freqSums: UnsafePointer<Float>) {
        pan = normalized(UnsafeBufferPointer(start: panSums, count: outlinePanBins))
        freq = normalized(UnsafeBufferPointer(start: freqSums, count: outlineFreqBins))
    }
}

/// Short-time Fourier mask that solos or mutes a stereo range and a frequency range of a stereo
/// signal. Sqrt-Hann analysis and synthesis windows at a quarter-size hop overlap-add to a
/// constant, so a gain of 1 everywhere returns the input delayed by ``latencyFrames``.
///
/// ``process(left:right:frames:)``, ``reset()``, ``apply(_:isMono:frequencyWeights:)``, and
/// ``copyOutlineSums(pan:freq:)`` allocate nothing and take no lock, so they run on the render
/// thread. Every buffer is made in `init`.
public final class IsolateMask {
    public let latencyFrames = fftSize
    /// How many frequency bins ``frequencyWeights(for:sampleRate:into:)`` writes.
    public static let binCount = bins

    private let fft: vDSP.FFT<DSPSplitComplex>
    private let analysisWindow: UnsafeMutablePointer<Float>
    /// The analysis window with the overlap and FFT scales folded in.
    private let synthesisWindow: UnsafeMutablePointer<Float>
    private let binLog2Hz: UnsafeMutablePointer<Float>
    private let binOutlineFreq: UnsafeMutablePointer<Int>
    /// Each bin's frequency weight for the current setting, so a frame computes only pan.
    private let binFreqWeight: UnsafeMutablePointer<Float>
    private let inLeft: UnsafeMutablePointer<Float>
    private let inRight: UnsafeMutablePointer<Float>
    private let outLeft: UnsafeMutablePointer<Float>
    private let outRight: UnsafeMutablePointer<Float>
    private let frame: UnsafeMutablePointer<Float>
    private let packedLeft: DSPSplitComplex
    private let packedRight: DSPSplitComplex
    private let spectrumLeft: DSPSplitComplex
    private let spectrumRight: DSPSplitComplex
    private let gains: UnsafeMutablePointer<Float>
    private let panSums: UnsafeMutablePointer<Float>
    private let freqSums: UnsafeMutablePointer<Float>

    private var setting = IsolateSetting.standard
    private var isMono = false
    /// Ring position shared by the input and overlap-add buffers: the oldest input frame.
    private var position = 0
    private var sinceFrame = 0
    /// True until a frame runs after construction or a reset, so its gains start unsmoothed.
    private var fresh = true
    /// Whether each frame sums the outline. Off, the outline holds its last sums.
    var measuresOutline = true {
        didSet { if measuresOutline && !oldValue { outlineIsCurrent = false } }
    }
    /// False from turning ``measuresOutline`` on until a frame sums the outline, while the sums
    /// still describe audio from before.
    private(set) var outlineIsCurrent = true

    public init(sampleRate: Double) {
        fft = vDSP.FFT(log2n: fftLog2Size, radix: .radix2, ofType: DSPSplitComplex.self)!
        analysisWindow = .zeroed(fftSize)
        synthesisWindow = .zeroed(fftSize)
        binLog2Hz = .zeroed(bins)
        binOutlineFreq = .allocate(capacity: bins)
        binOutlineFreq.initialize(repeating: -1, count: bins)
        binFreqWeight = .zeroed(bins)
        inLeft = .zeroed(fftSize)
        inRight = .zeroed(fftSize)
        outLeft = .zeroed(fftSize)
        outRight = .zeroed(fftSize)
        frame = .zeroed(fftSize)
        packedLeft = .zeroed(halfSize)
        packedRight = .zeroed(halfSize)
        spectrumLeft = .zeroed(halfSize)
        spectrumRight = .zeroed(halfSize)
        gains = .zeroed(bins)
        panSums = .zeroed(outlinePanBins)
        freqSums = .zeroed(outlineFreqBins)

        for i in 0..<fftSize {
            let w = sin(Float.pi * Float(i) / Float(fftSize))
            analysisWindow[i] = w
            synthesisWindow[i] = w * overlapScale * roundTripScale
        }
        setSampleRate(sampleRate)
    }

    deinit {
        for buffer in [
            analysisWindow, synthesisWindow, binLog2Hz, binFreqWeight, inLeft, inRight, outLeft, outRight, frame,
            packedLeft.realp, packedLeft.imagp, packedRight.realp, packedRight.imagp, spectrumLeft.realp,
            spectrumLeft.imagp, spectrumRight.realp, spectrumRight.imagp, gains, panSums, freqSums,
        ] {
            buffer.deallocate()
        }
        binOutlineFreq.deallocate()
    }

    /// Moves every bin to its frequency at `sampleRate` and works out the setting's weights again.
    /// Not for the render thread.
    public func setSampleRate(_ sampleRate: Double) {
        let octaves = log2(hzMax / hzMin)
        for k in 0..<bins {
            let hz = binHz(k, sampleRate: sampleRate)
            binLog2Hz[k] = log2(hz)
            binOutlineFreq[k] =
                hz < hzMin || hz > hzMax
                ? -1
                : min(outlineFreqBins - 1, Int((log2(hz / hzMin) / octaves * Float(outlineFreqBins)).rounded(.down)))
        }
        setSetting(setting, isMono: isMono)
    }

    /// Sets what the mask keeps. Writes only into buffers made in `init`, but not for the render
    /// thread while ``process(left:right:frames:)`` may run on it; hand a setting across with
    /// ``apply(_:isMono:frequencyWeights:)`` instead.
    public func setSetting(_ s: IsolateSetting, isMono: Bool) {
        setting = s
        self.isMono = isMono
        for k in 0..<bins { binFreqWeight[k] = freqWeight(log2Hz: binLog2Hz[k], setting: s) }
    }

    /// Each bin's frequency weight for `s` at `sampleRate`, ``binCount`` values, worked out off
    /// the render thread so ``apply(_:isMono:frequencyWeights:)`` only copies them.
    public static func frequencyWeights(
        for s: IsolateSetting, sampleRate: Double, into weights: UnsafeMutablePointer<Float>
    ) {
        for k in 0..<bins { weights[k] = freqWeight(log2Hz: log2(binHz(k, sampleRate: sampleRate)), setting: s) }
    }

    /// Sets what the mask keeps from weights ``frequencyWeights(for:sampleRate:into:)`` wrote for
    /// the mask's sample rate.
    public func apply(_ s: IsolateSetting, isMono: Bool, frequencyWeights: UnsafePointer<Float>) {
        setting = s
        self.isMono = isMono
        binFreqWeight.update(from: frequencyWeights, count: bins)
    }

    /// Copies the last frame's raw magnitude sums: `outlinePanBins` into `pan` and
    /// `outlineFreqBins` into `freq`.
    func copyOutlineSums(pan: UnsafeMutablePointer<Float>, freq: UnsafeMutablePointer<Float>) {
        pan.update(from: panSums, count: outlinePanBins)
        freq.update(from: freqSums, count: outlineFreqBins)
    }

    /// Drops all buffered audio, for a jump in the input: a seek, a loop move, or a restart.
    public func reset() {
        inLeft.update(repeating: 0, count: fftSize)
        inRight.update(repeating: 0, count: fftSize)
        outLeft.update(repeating: 0, count: fftSize)
        outRight.update(repeating: 0, count: fftSize)
        panSums.update(repeating: 0, count: outlinePanBins)
        freqSums.update(repeating: 0, count: outlineFreqBins)
        position = 0
        sinceFrame = 0
        fresh = true
        outlineIsCurrent = true
    }

    /// Masks `frames` samples of each channel in place, for any block length.
    public func process(left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>, frames: Int) {
        for i in 0..<frames {
            let p = position
            let l = left[i]
            let r = right[i]
            left[i] = outLeft[p]
            right[i] = outRight[p]
            outLeft[p] = 0
            outRight[p] = 0
            inLeft[p] = l
            inRight[p] = r
            position = p + 1 == fftSize ? 0 : p + 1
            sinceFrame += 1
            if sinceFrame == hop {
                sinceFrame = 0
                runFrame()
            }
        }
    }

    /// Input magnitude of the last frame by pan and by log frequency, each scaled to 0..1.
    public func outline() -> IsolateOutline {
        IsolateOutline(panSums: panSums, freqSums: freqSums)
    }

    private func runFrame() {
        analyze(inLeft, into: packedLeft, spectrum: spectrumLeft)
        analyze(inRight, into: packedRight, spectrum: spectrumRight)

        let measuring = measuresOutline
        if measuring {
            panSums.update(repeating: 0, count: outlinePanBins)
            freqSums.update(repeating: 0, count: outlineFreqBins)
            outlineIsCurrent = true
        }
        for k in 0..<bins {
            // vDSP packs the real-only DC and Nyquist bins into the first slot's real and
            // imaginary parts, and scales every bin by 2.
            let leftMagnitude: Float
            let rightMagnitude: Float
            switch k {
            case 0:
                leftMagnitude = abs(spectrumLeft.realp[0]) / 2
                rightMagnitude = abs(spectrumRight.realp[0]) / 2
            case halfSize:
                leftMagnitude = abs(spectrumLeft.imagp[0]) / 2
                rightMagnitude = abs(spectrumRight.imagp[0]) / 2
            default:
                leftMagnitude = hypot(spectrumLeft.realp[k], spectrumLeft.imagp[k]) / 2
                rightMagnitude = hypot(spectrumRight.realp[k], spectrumRight.imagp[k]) / 2
            }
            let total = leftMagnitude + rightMagnitude
            // A non-finite sample makes the pan NaN, and converting NaN to a bin index traps.
            let pan =
                (leftMagnitude < silentMagnitude && rightMagnitude < silentMagnitude) || !total.isFinite
                ? 0 : 100 * (rightMagnitude - leftMagnitude) / total

            let target = gain(
                inRange: panWeight(pan, setting: setting, isMono: isMono) * binFreqWeight[k], effect: setting.effect)
            let g = fresh ? target : smoothPrevious * gains[k] + smoothNew * target
            gains[k] = g
            switch k {
            case 0:
                spectrumLeft.realp[0] *= g
                spectrumRight.realp[0] *= g
            case halfSize:
                spectrumLeft.imagp[0] *= g
                spectrumRight.imagp[0] *= g
            default:
                spectrumLeft.realp[k] *= g
                spectrumLeft.imagp[k] *= g
                spectrumRight.realp[k] *= g
                spectrumRight.imagp[k] *= g
            }

            if measuring && k > 0 {
                let panBin = min(
                    outlinePanBins - 1,
                    Int(((pan - panMin) / (panMax - panMin) * Float(outlinePanBins)).rounded(.down)))
                panSums[panBin] += total
                let freqBin = binOutlineFreq[k]
                if freqBin >= 0 { freqSums[freqBin] += total }
            }
        }
        fresh = false

        synthesize(spectrumLeft, through: packedLeft, into: outLeft)
        synthesize(spectrumRight, through: packedRight, into: outRight)
    }

    /// Windows the ring's last `fftSize` samples, oldest first, and transforms them.
    private func analyze(_ ring: UnsafeMutablePointer<Float>, into packed: DSPSplitComplex, spectrum: DSPSplitComplex) {
        // The ring's oldest samples run from `position` to its end, then wrap to its start.
        let tail = fftSize - position
        for i in 0..<tail { frame[i] = ring[position + i] * analysisWindow[i] }
        for i in tail..<fftSize { frame[i] = ring[i - tail] * analysisWindow[i] }
        var packed = packed
        frame.withMemoryRebound(to: DSPComplex.self, capacity: halfSize) {
            vDSP_ctoz($0, 2, &packed, 1, vDSP_Length(halfSize))
        }
        var spectrum = spectrum
        fft.forward(input: packed, output: &spectrum)
    }

    /// Inverts `spectrum`, windows it, and adds it into the overlap-add ring.
    private func synthesize(
        _ spectrum: DSPSplitComplex, through packed: DSPSplitComplex, into ring: UnsafeMutablePointer<Float>
    ) {
        var packed = packed
        fft.inverse(input: spectrum, output: &packed)
        frame.withMemoryRebound(to: DSPComplex.self, capacity: halfSize) {
            vDSP_ztoc(&packed, 1, $0, 2, vDSP_Length(halfSize))
        }
        let tail = fftSize - position
        for i in 0..<tail { ring[position + i] += frame[i] * synthesisWindow[i] }
        for i in tail..<fftSize { ring[i - tail] += frame[i] * synthesisWindow[i] }
    }
}

private func binHz(_ k: Int, sampleRate: Double) -> Float {
    Float(Double(k) * sampleRate / Double(fftSize))
}

private func normalized(_ sums: UnsafeBufferPointer<Float>) -> [Float] {
    let peak = sums.max() ?? 0
    return sums.map { peak > 0 ? $0 / peak : 0 }
}

extension UnsafeMutablePointer where Pointee == Float {
    fileprivate static func zeroed(_ count: Int) -> UnsafeMutablePointer<Float> {
        let pointer = UnsafeMutablePointer<Float>.allocate(capacity: count)
        pointer.initialize(repeating: 0, count: count)
        return pointer
    }
}

extension DSPSplitComplex {
    fileprivate static func zeroed(_ count: Int) -> DSPSplitComplex {
        DSPSplitComplex(realp: .zeroed(count), imagp: .zeroed(count))
    }
}
