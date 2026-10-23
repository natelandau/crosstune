import Accelerate
import Foundation

public struct PitchEstimate: Sendable {
    public let frequency: Double
    /// The normalized square difference at the chosen period, up to 1 for a perfectly periodic window.
    public let clarity: Double

    public init(frequency: Double, clarity: Double) {
        self.frequency = frequency
        self.clarity = clarity
    }
}

private func nextPowerOfTwo(_ n: Int) -> Int {
    var size = 1
    while size < n { size <<= 1 }
    return size
}

/// Scratch for one FFT size: the transform setup, its complex buffer, and the power spectrum.
private final class Spectrum {
    let size: Int
    let log2Size: vDSP_Length
    let setup: FFTSetupD
    let re: UnsafeMutableBufferPointer<Double>
    let im: UnsafeMutableBufferPointer<Double>
    /// Bins 0 through size / 2.
    let power: UnsafeMutableBufferPointer<Double>

    init(size: Int) {
        self.size = size
        log2Size = vDSP_Length(size.trailingZeroBitCount)
        setup = vDSP_create_fftsetupD(log2Size, FFTRadix(kFFTRadix2))!
        re = .allocate(capacity: size)
        im = .allocate(capacity: size)
        power = .allocate(capacity: size / 2 + 1)
    }

    deinit {
        vDSP_destroy_fftsetupD(setup)
        re.deallocate()
        im.deallocate()
        power.deallocate()
    }

    /// In place and unscaled both ways: divide by `size` to undo a forward transform.
    func transform(inverse: Bool) {
        var split = DSPDoubleSplitComplex(realp: re.baseAddress!, imagp: im.baseAddress!)
        let direction = FFTDirection(inverse ? kFFTDirection_Inverse : kFFTDirection_Forward)
        vDSP_fft_zipD(setup, &split, 1, log2Size, direction)
    }
}

/// The McLeod pitch method (normalized square difference function, NSDF). It keeps scratch
/// buffers for every FFT size it has seen, so a caller that alternates window lengths allocates
/// nothing after the first window of each.
final class PitchEstimator {
    private var spectra: [Int: Spectrum] = [:]
    private var nsdf: [Double] = []
    private var overlap: [Double] = []
    private var keyMaxima: [Int] = []

    /// Allocates up front for windows of these lengths.
    init(windowLengths: [Int] = []) {
        for length in windowLengths {
            _ = prepare(fftSize: nextPowerOfTwo(2 * length), nsdfSize: length / 2 + 3)
        }
    }

    func estimate(_ samples: UnsafeBufferPointer<Float>, sampleRate: Double) -> PitchEstimate? {
        let w = samples.count
        var energy = 0.0
        for sample in samples {
            let x = Double(sample)
            energy += x * x
        }
        if w == 0 || 10 * log10(energy / Double(w)) < Tracker.minRmsDbfs { return nil }

        let minLag = Int((sampleRate / Tracker.maxHz).rounded(.down))
        let maxLag = min(Int((sampleRate / Tracker.minHz).rounded(.up)), w / 2)
        if maxLag <= minLag + 1 { return nil }
        let spectrum = prepare(fftSize: nextPowerOfTwo(2 * w), nsdfSize: maxLag + 3)
        let (re, im, power) = (spectrum.re, spectrum.im, spectrum.power)

        // Autocorrelation r(τ) by the Wiener-Khinchin theorem: the inverse FFT of the power
        // spectrum of the zero-padded window.
        re.update(repeating: 0)
        im.update(repeating: 0)
        for i in 0..<w { re[i] = Double(samples[i]) }
        spectrum.transform(inverse: false)
        for k in 0..<spectrum.size {
            re[k] = re[k] * re[k] + im[k] * im[k]
            im[k] = 0
            if k < power.count { power[k] = re[k] }
        }
        spectrum.transform(inverse: true)
        let scale = 1 / Double(spectrum.size)

        // m(τ) = Σ x[j]² + x[j+τ]² over the overlap, shrinking by one sample at each end per lag.
        // Two lags past maxLag, for the neighbors interpolation reads at the edge.
        var m = 2 * energy
        for tau in 0...(maxLag + 2) {
            nsdf[tau] = m > 0 ? 2 * re[tau] * scale / m : 0
            overlap[tau] = m
            if tau < w {
                let head = Double(samples[tau])
                let tail = Double(samples[w - 1 - tau])
                m -= head * head + tail * tail
            }
        }

        let count = findKeyMaxima(minLag: minLag, maxLag: maxLag)
        if count == 0 { return nil }
        var highest = -Double.infinity
        for i in 0..<count { highest = max(highest, nsdf[keyMaxima[i]]) }
        var chosen = 0
        while nsdf[keyMaxima[chosen]] < Tracker.keyMaximumRatio * highest { chosen += 1 }

        var (lag, clarity) = parabolicPeak(at: keyMaxima[chosen])
        // A window whose fundamental is weak can still peak almost as high at half the period, so
        // a clearly higher peak at twice the chosen lag wins.
        for i in (chosen + 1)..<count {
            let peak = parabolicPeak(at: keyMaxima[i])
            let doubled = 2 * lag
            if abs(peak.lag - doubled) <= Tracker.octaveLagTolerance * doubled
                && peak.value > clarity + Tracker.octaveMargin
            {
                (lag, clarity) = peak
                break
            }
        }
        if clarity < Tracker.minClarity { return nil }
        if let refined = refineInSpectrum(from: lag, power: power) { (lag, clarity) = refined }
        let frequency = sampleRate / lag
        // Mains hum is as periodic as any note, so only its frequency gives it away.
        for hum in Tracker.humRejectHz where abs(frequency - hum) <= Tracker.humRejectWidthHz { return nil }
        return PitchEstimate(frequency: frequency, clarity: clarity)
    }

    private func prepare(fftSize: Int, nsdfSize: Int) -> Spectrum {
        if nsdf.count < nsdfSize {
            nsdf = [Double](repeating: 0, count: nsdfSize)
            overlap = [Double](repeating: 0, count: nsdfSize)
            keyMaxima = [Int](repeating: 0, count: nsdfSize)
        }
        if let spectrum = spectra[fftSize] { return spectrum }
        let spectrum = Spectrum(size: fftSize)
        spectra[fftSize] = spectrum
        return spectrum
    }

    /// Stores the highest point of each positive lobe after the first negative-going zero
    /// crossing, keeping those at or past `minLag`, and returns how many it stored. A lobe still
    /// open at `maxLag` counts once it has peaked.
    private func findKeyMaxima(minLag: Int, maxLag: Int) -> Int {
        var tau = 1
        while tau <= maxLag && nsdf[tau] > 0 { tau += 1 }
        var count = 0
        var best = -1
        while tau <= maxLag {
            let value = nsdf[tau]
            if value > 0 {
                if best < 0 || value > nsdf[best] { best = tau }
            } else if best >= 0 {
                if best >= minLag {
                    keyMaxima[count] = best
                    count += 1
                }
                best = -1
            }
            tau += 1
        }
        // A lobe still rising at maxLag has no peak in range, and a parabola through its edge
        // extrapolates far past maxLag.
        if best >= minLag && nsdf[best] >= nsdf[best + 1] {
            keyMaxima[count] = best
            count += 1
        }
        return count
    }

    /// Parabolic interpolation through the peak and its two neighbors.
    private func parabolicPeak(at tau: Int) -> (lag: Double, value: Double) {
        let a = nsdf[tau - 1]
        let b = nsdf[tau]
        let c = nsdf[tau + 1]
        let curve = a - 2 * b + c
        let shift = curve < 0 ? (a - c) / (2 * curve) : 0
        return (Double(tau) + shift, b - (a - c) * shift / 4)
    }

    /// m(τ) at a fractional lag, linear between its neighbors, and its slope.
    private func overlap(at lag: Double) -> (m: Double, slope: Double) {
        let below = Int(lag.rounded(.down))
        let slope = overlap[below + 1] - overlap[below]
        return (overlap[below] + slope * (lag - Double(below)), slope)
    }

    /// Polishes a peak's lag with Newton steps on the NSDF between samples, where r(τ) is the
    /// band-limited interpolation of the autocorrelation, summed from the power spectrum, and m(τ)
    /// is linear between its neighbors. A parabola through three samples misplaces a peak that
    /// strong high partials make narrow, by over a cent at 16 kHz. Nil when a step leaves the
    /// peak, so the parabola's answer stands.
    private func refineInSpectrum(from start: Double, power: UnsafeMutableBufferPointer<Double>)
        -> (lag: Double, value: Double)?
    {
        var lag = start
        for _ in 0..<Tracker.refineSteps {
            let (r, r1, r2) = autocorrelation(at: lag, power: power)
            let (m, slope) = overlap(at: lag)
            if !(r2 < 0) || m <= 0 { return nil }
            let shift = (r1 - r * slope / m) / r2
            if abs(shift) > 1 { return nil }
            lag -= shift
        }
        if abs(lag - start) > 1 { return nil }
        let r = autocorrelation(at: lag, power: power).r
        return (lag, 2 * r / overlap(at: lag).m)
    }

    /// r(τ) and its first two derivatives at a fractional lag.
    private func autocorrelation(at lag: Double, power: UnsafeMutableBufferPointer<Double>)
        -> (r: Double, slope: Double, curve: Double)
    {
        let last = power.count - 1
        let n = Double(last * 2)
        let theta = 2 * Double.pi * lag / n
        let stepCos = cos(theta)
        let stepSin = sin(theta)
        // e^{iθk} by repeated rotation, so the sum needs no trigonometry per bin.
        var c = 1.0
        var s = 0.0
        var r = power[0]
        var r1 = 0.0
        var r2 = 0.0
        for k in 1...last {
            let nextC = c * stepCos - s * stepSin
            s = c * stepSin + s * stepCos
            c = nextC
            let weight = (k == last ? 1 : 2) * power[k]
            let omega = 2 * Double.pi * Double(k) / n
            r += weight * c
            r1 -= weight * omega * s
            r2 -= weight * omega * omega * c
        }
        return (r / n, r1 / n, r2 / n)
    }
}

/// One window's pitch. It allocates scratch on every call; a stream of windows goes through a
/// ``PitchTracker``, which keeps its own.
public func estimatePitch(_ samples: UnsafeBufferPointer<Float>, sampleRate: Double) -> PitchEstimate? {
    PitchEstimator().estimate(samples, sampleRate: sampleRate)
}
