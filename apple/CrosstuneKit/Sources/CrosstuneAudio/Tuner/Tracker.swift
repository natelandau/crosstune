/// Every tuned constant of the detector. The web twin's `TRACKER` in
/// `web/src/features/tuner/pitch/constants.ts` has the same names and values, and both pass the
/// clips in `fixtures/tuner/clips.json`.
enum Tracker {
    /// Lowest pitch read, in Hz: below a five-string bass's low B.
    static let minHz = 30.0
    /// Highest pitch read, in Hz.
    static let maxHz = 4200.0
    /// Input kept for analysis, in seconds; at least the long window.
    static let bufferSeconds = 0.17
    /// New input between analyses, in seconds.
    static let hopSeconds = 0.02
    /// Window while unlocked or below `shortWindowMinHz`: several periods of a low E.
    static let longWindowSeconds = 0.085
    /// Window once locked at or above `shortWindowMinHz`, for a faster response.
    static let shortWindowSeconds = 0.032
    /// Smoothed pitch, in Hz, at or above which a locked tracker moves to the short window.
    static let shortWindowMinHz = 200.0
    /// Smoothed pitch, in Hz, below which it moves back to the long window.
    static let longWindowBelowHz = 190.0
    /// The first key maximum at least this fraction of the highest one is the period.
    static let keyMaximumRatio = 0.9
    /// How close, as a fraction of twice the chosen lag, a peak must be to count as its octave.
    static let octaveLagTolerance = 0.03
    /// How much higher than the chosen peak the peak at twice its lag must be to win.
    static let octaveMargin = 0.05
    /// Newton steps that polish the chosen peak's lag between samples.
    static let refineSteps = 2
    /// Lowest clarity that counts as a pitch.
    static let minClarity = 0.85
    /// Quietest window RMS analyzed, in dBFS.
    static let minRmsDbfs = -42.0
    /// Mains hum and its second harmonic, in Hz; an estimate this close to one is no note.
    static let humRejectHz: [Double] = [50, 60, 100, 120]
    /// Half-width, in Hz, of the band rejected around each `humRejectHz`.
    static let humRejectWidthHz = 0.3
    /// Estimates the median runs over.
    static let medianCount = 3
    /// Weight of each new median in the exponential average of cents.
    static let smoothing = 0.35
    /// An estimate this many cents from the average counts toward a snap.
    static let snapCents = 15.0
    /// Consecutive estimates past `snapCents` that snap the average to the newest; outlasts one vibrato swing.
    static let snapCount = 3
    /// Time without an estimate, in seconds, before the reading clears and the tracker unlocks.
    static let holdSeconds = 0.2
}
