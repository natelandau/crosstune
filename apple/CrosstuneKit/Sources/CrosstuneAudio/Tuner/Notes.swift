import Foundation

public enum NoteName: String, CaseIterable, Sendable {
    case c = "C"
    case cSharp = "C♯"
    case d = "D"
    case dSharp = "D♯"
    case e = "E"
    case f = "F"
    case fSharp = "F♯"
    case g = "G"
    case gSharp = "G♯"
    case a = "A"
    case aSharp = "A♯"
    case b = "B"
}

public struct Note: Equatable, Sendable {
    public let name: NoteName
    public let octave: Int
    /// Offset from the nearest equal-tempered note, -50 to 50.
    public let cents: Double

    public init(name: NoteName, octave: Int, cents: Double) {
        self.name = name
        self.octave = octave
        self.cents = cents
    }
}

/// Where a note sits: inside the target zone, just outside it, or far off.
public enum TuneStep: Sendable {
    case zone, close, far
}

/// The furthest off, in cents either way, a note counts as in tune.
private let inTuneCents = 3.0
/// The target zone's reach, in cents either way, inside which a note turns toward in tune.
public let zoneCents = 10.0
/// The furthest off, in cents either way, a note outside the zone counts as close.
private let closeCents = 15.0

/// The nearest note to `frequency`, nil when the frequency or `a4` is not a positive number.
public func noteFor(frequency: Double, a4: Double) -> Note? {
    let midi = 69 + 12 * log2(frequency / a4)
    guard midi.isFinite else { return nil }
    // Halves round up, as the web detector's Math.round does.
    let nearest = (midi + 0.5).rounded(.down)
    let pitchClass = (Int(nearest) % 12 + 12) % 12
    return Note(
        name: NoteName.allCases[pitchClass], octave: Int((nearest / 12).rounded(.down)) - 1,
        cents: (midi - nearest) * 100)
}

/// `cents` to the tenth the tuner shows. Every check below judges this, so what shows and what is
/// judged agree. Halves round up, as the web's `Math.round` does.
public func tenths(_ cents: Double) -> Double {
    (cents * 10 + 0.5).rounded(.down) / 10
}

public func tuneStep(cents: Double) -> TuneStep {
    let off = abs(tenths(cents))
    if off <= zoneCents { return .zone }
    return off <= closeCents ? .close : .far
}

public func isInTune(cents: Double) -> Bool {
    abs(tenths(cents)) <= inTuneCents
}

/// How far a note `cents` off has come toward in tune: 0 outside the target zone, 1 in tune, and
/// rising evenly between, so a peg turn inside the zone shows as steady progress.
public func inTuneFraction(cents: Double) -> Double {
    min(1, max(0, (zoneCents - abs(tenths(cents))) / (zoneCents - inTuneCents)))
}

/// Which side of the in-tune band a note sits on.
public enum TuneHint: Sendable {
    case flat, sharp
}

/// The side past the in-tune band, nil within it.
public func tuneHint(cents: Double) -> TuneHint? {
    let shown = tenths(cents)
    if shown < -inTuneCents { return .flat }
    return shown > inTuneCents ? .sharp : nil
}
