import Foundation
import Testing

/// A synthetic clip from `fixtures/tuner/clips.json`, which `fixtures/tuner/README.md` describes.
struct ClipRecipe: Decodable, Sendable {
    struct Hum: Decodable, Sendable {
        let hz: Double
        let dbfs: Double
        let partials: [[Double]]?
    }

    struct Vibrato: Decodable, Sendable {
        let cents: Double
        let hz: Double
    }

    struct Expected: Decodable, Sendable {
        let name: String
        let octave: Int
        let cents: Double
    }

    let id: String
    let sampleRate: Double
    let seconds: Double
    let a4: Double
    let f0: Double
    /// `[harmonic, weight]` pairs.
    let partials: [[Double]]
    let amplitude: Double
    let decaySeconds: Double?
    let noiseDbfs: Double?
    let hum: Hum?
    let vibrato: Vibrato?
    /// Nil for a clip that must produce no reading.
    let expect: Expected?
    let lockWithinMs: Double?
    let toleranceCents: Double?

    /// The same recipe at another pitch and length, against A4 = 440.
    func at(frequency: Double, seconds: Double) -> ClipRecipe {
        ClipRecipe(
            id: id, sampleRate: sampleRate, seconds: seconds, a4: 440, f0: frequency, partials: partials,
            amplitude: amplitude, decaySeconds: decaySeconds, noiseDbfs: noiseDbfs, hum: hum, vibrato: vibrato,
            expect: expect, lockWithinMs: lockWithinMs, toleranceCents: toleranceCents)
    }
}

struct ClipFile: Decodable, Sendable {
    let seed: Int
    let clips: [ClipRecipe]

    static let shared: ClipFile = {
        var folder = URL(filePath: #filePath).deletingLastPathComponent()
        while !FileManager.default.fileExists(atPath: folder.appending(path: "fixtures/tuner").path()) {
            // The root's parent is the root, so the walk would never end.
            guard folder.path() != "/" else { fatalError("No fixtures/tuner folder above \(#filePath)") }
            folder = folder.deletingLastPathComponent()
        }
        let data = try! Data(contentsOf: folder.appending(path: "fixtures/tuner/clips.json"))
        return try! JSONDecoder().decode(ClipFile.self, from: data)
    }()
}

/// A clip with its position in the file, which seeds its noise.
struct IndexedClip: Sendable, CustomTestStringConvertible {
    let index: Int
    let clip: ClipRecipe

    var testDescription: String { clip.id }

    static var all: [IndexedClip] {
        ClipFile.shared.clips.enumerated().map { IndexedClip(index: $0.offset, clip: $0.element) }
    }
}

/// Mulberry32, matching the web tests' `seeded`, so both platforms hear the same noise.
struct Mulberry32 {
    private var state: UInt32

    init(seed: Int) { state = UInt32(truncatingIfNeeded: seed) }

    mutating func next() -> Double {
        state = state &+ 0x6D2B_79F5
        var t = (state ^ (state >> 15)) &* (1 | state)
        t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
        return Double(t ^ (t >> 14)) / 4_294_967_296
    }
}

private func level(_ dbfs: Double) -> Double { pow(10, dbfs / 20) }

/// Renders a recipe sample by sample in double precision, as `fixtures/tuner/README.md` lays out.
func synthesize(_ clip: ClipRecipe, index: Int, seed: Int = ClipFile.shared.seed) -> [Float] {
    let count = Int((clip.seconds * clip.sampleRate).rounded())
    var out = [Float](repeating: 0, count: count)
    var random = Mulberry32(seed: seed + index)
    let humPartials = clip.hum.map { $0.partials ?? [[1, 1]] } ?? []
    let humLevel = clip.hum.map { level($0.dbfs) } ?? 0
    let noiseLevel = clip.noiseDbfs.map(level) ?? 0
    var phase = 0.0
    for i in 0..<count {
        let t = Double(i) / clip.sampleRate
        var tone = 0.0
        for partial in clip.partials {
            tone += partial[1] * sin(2 * .pi * partial[0] * phase)
        }
        let envelope = clip.decaySeconds.map { exp(-t / $0) } ?? 1
        var sample = clip.amplitude * envelope * tone
        if let hum = clip.hum {
            for partial in humPartials {
                sample += humLevel * partial[1] * sin(2 * .pi * partial[0] * hum.hz * t)
            }
        }
        if clip.noiseDbfs != nil { sample += noiseLevel * (2 * random.next() - 1) }
        out[i] = Float(sample)
        let bend = clip.vibrato.map { pow(2, $0.cents * sin(2 * .pi * $0.hz * t) / 1200) } ?? 1
        phase += clip.f0 * bend / clip.sampleRate
    }
    return out
}
