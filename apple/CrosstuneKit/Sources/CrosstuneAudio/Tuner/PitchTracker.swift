import Foundation

public struct Reading: Equatable, Sendable {
    public let frequency: Double
    public let note: Note
    /// Sample time of the analysis, in ms since construction or `reset`.
    public let atMs: Double

    public init(frequency: Double, note: Note, atMs: Double) {
        self.frequency = frequency
        self.note = note
        self.atMs = atMs
    }
}

private func centsOf(_ frequency: Double) -> Double { 1200 * log2(frequency) }
private func frequencyOf(_ cents: Double) -> Double { pow(2, cents / 1200) }

private func samples(_ seconds: Double, at sampleRate: Double) -> Int {
    Int((sampleRate * seconds).rounded())
}

/// Turns microphone input into a steady reading. Not thread-safe: one queue owns it.
public final class PitchTracker {
    private let sampleRate: Double
    private var a4: Double
    private let estimator: PitchEstimator
    private var ring: [Float]
    private let hop: Int
    private let holdSamples: Int
    private var longWindow: [Float]
    private var shortWindow: [Float]
    /// The last `medianCount` estimates, in absolute cents, oldest overwritten first.
    private var history = [Double](repeating: 0, count: Tracker.medianCount)
    private var sorted = [Double](repeating: 0, count: Tracker.medianCount)

    private var writeAt = 0
    private var filled = 0
    private var total = 0
    private var sinceAnalysis = 0
    private var historyCount = 0
    private var historyAt = 0
    /// Smoothed pitch in absolute cents, or nil while unlocked.
    private var smoothed: Double?
    private var outliers = 0
    private var lastEstimateAt = 0
    private var useShortWindow = false
    private var reading: Reading?

    /// Whether the short window is the one analyzed now.
    var usesShortWindow: Bool { useShortWindow }

    public init(sampleRate: Double, a4: Double) {
        self.sampleRate = sampleRate
        self.a4 = a4
        ring = [Float](repeating: 0, count: samples(Tracker.bufferSeconds, at: sampleRate))
        hop = samples(Tracker.hopSeconds, at: sampleRate)
        holdSamples = samples(Tracker.holdSeconds, at: sampleRate)
        longWindow = [Float](repeating: 0, count: samples(Tracker.longWindowSeconds, at: sampleRate))
        shortWindow = [Float](repeating: 0, count: samples(Tracker.shortWindowSeconds, at: sampleRate))
        estimator = PitchEstimator(windowLengths: [longWindow.count, shortWindow.count])
    }

    /// Appends input; returns the reading after the newest analysis, or nil when nothing confident is heard.
    public func push(_ samples: UnsafeBufferPointer<Float>) -> Reading? {
        for sample in samples {
            ring[writeAt] = sample
            writeAt = (writeAt + 1) % ring.count
            filled = min(filled + 1, ring.count)
            total += 1
            sinceAnalysis += 1
            if sinceAnalysis >= hop {
                sinceAnalysis = 0
                analyze()
            }
        }
        return reading
    }

    public func setA4(_ a4: Double) {
        self.a4 = a4
        if let reading {
            self.reading = noteFor(frequency: reading.frequency, a4: a4).map {
                Reading(frequency: reading.frequency, note: $0, atMs: reading.atMs)
            }
        }
    }

    public func reset() {
        writeAt = 0
        filled = 0
        total = 0
        sinceAnalysis = 0
        unlock()
    }

    private func unlock() {
        historyCount = 0
        historyAt = 0
        smoothed = nil
        outliers = 0
        reading = nil
        useShortWindow = false
    }

    private func analyze() {
        let locked = smoothed != nil
        if let smoothed {
            // Two thresholds, so a note near the boundary does not flip windows every analysis.
            let heard = frequencyOf(smoothed)
            if heard >= Tracker.shortWindowMinHz {
                useShortWindow = true
            } else if heard < Tracker.longWindowBelowHz {
                useShortWindow = false
            }
        }
        var estimate: PitchEstimate?
        if useShortWindow {
            guard filled >= shortWindow.count else { return }
            estimate = estimateNewest(&shortWindow)
        } else {
            guard filled >= longWindow.count else { return }
            estimate = estimateNewest(&longWindow)
        }
        if useShortWindow, (estimate?.frequency ?? 0) < Tracker.longWindowBelowHz {
            // The short window holds too few periods of a low note to read it, so it hears one
            // after a high note an octave up or not at all; the long window reads it now.
            useShortWindow = false
            estimate = estimateNewest(&longWindow)
        }

        guard let estimate else {
            if locked && total - lastEstimateAt >= holdSamples { unlock() }
            return
        }
        lastEstimateAt = total
        let smoothed = smooth(centsOf(estimate.frequency))
        let frequency = frequencyOf(smoothed)
        reading = noteFor(frequency: frequency, a4: a4).map {
            Reading(frequency: frequency, note: $0, atMs: Double(total) / sampleRate * 1000)
        }
    }

    /// Copies the newest samples into `window` and estimates its pitch.
    private func estimateNewest(_ window: inout [Float]) -> PitchEstimate? {
        var from = (writeAt - window.count + ring.count) % ring.count
        for i in 0..<window.count {
            window[i] = ring[from]
            from = from + 1 == ring.count ? 0 : from + 1
        }
        return window.withUnsafeBufferPointer { estimator.estimate($0, sampleRate: sampleRate) }
    }

    /// Folds an estimate into the smoothed pitch and returns it.
    private func smooth(_ cents: Double) -> Double {
        history[historyAt] = cents
        historyAt = (historyAt + 1) % history.count
        historyCount = min(historyCount + 1, history.count)
        let median = median()

        guard let current = smoothed else {
            smoothed = median
            return median
        }
        if abs(cents - current) > Tracker.snapCents {
            outliers += 1
            if outliers >= Tracker.snapCount {
                outliers = 0
                smoothed = cents
                return cents
            }
        } else {
            outliers = 0
        }
        let heard = noteFor(frequency: frequencyOf(median), a4: a4)
        let shown = noteFor(frequency: frequencyOf(current), a4: a4)
        if heard?.name != shown?.name || heard?.octave != shown?.octave {
            smoothed = median
            return median
        }
        let next = current + Tracker.smoothing * (median - current)
        smoothed = next
        return next
    }

    /// Median of the stored estimates; with an even count, the mean of the middle two.
    private func median() -> Double {
        let n = historyCount
        for i in 0..<n {
            // Insertion sort: at most `medianCount` values.
            let value = history[i]
            var j = i
            while j > 0 && sorted[j - 1] > value {
                sorted[j] = sorted[j - 1]
                j -= 1
            }
            sorted[j] = value
        }
        let mid = n / 2
        return n % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }
}
