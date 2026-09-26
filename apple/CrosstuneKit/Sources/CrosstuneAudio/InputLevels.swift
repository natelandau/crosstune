@preconcurrency import AVFoundation

/// The recent input levels behind the live waveform, newest last.
public struct InputLevels: Equatable, Sendable {
    /// Levels measured per second of audio, one per display frame.
    public static let perSecond = 60
    /// How many levels are kept: three seconds, enough to fill the widest sheet.
    public static let capacity = 180

    public private(set) var values: [Float] = []

    public init() {}

    public mutating func append(contentsOf levels: [Float]) {
        values.append(contentsOf: levels)
        if values.count > Self.capacity { values.removeFirst(values.count - Self.capacity) }
    }

    public mutating func removeAll() {
        values.removeAll()
    }
}

/// Measures a stream of microphone buffers as levels, one per 1/60 second of audio, each the
/// root mean square of its slice: 0 for silence, 1 at full scale.
///
/// A slice that a buffer ends partway through is completed by the next buffer, so the rate
/// holds at ``InputLevels/perSecond`` whatever size the buffers arrive in. Each level is the
/// loudest channel's, so a microphone on either side of a stereo interface shows.
public struct LevelMeter: Sendable {
    private var sums: [Float] = []
    private var counted = 0
    private var sampleRate = 0.0

    public init() {}

    public mutating func levels(of buffer: AVAudioPCMBuffer) -> [Float] {
        guard let data = buffer.floatChannelData else { return [] }
        let channels = Int(buffer.format.channelCount)
        if channels != sums.count || buffer.format.sampleRate != sampleRate {
            // A new input starts a new slice rather than mixing two formats in one.
            sums = Array(repeating: 0, count: channels)
            counted = 0
            sampleRate = buffer.format.sampleRate
        }
        let slice = max(1, Int(sampleRate) / InputLevels.perSecond)
        let frames = Int(buffer.frameLength)
        var levels: [Float] = []
        var frame = 0
        while frame < frames {
            let take = min(slice - counted, frames - frame)
            for channel in 0..<channels {
                let samples = data[channel]
                var sum = sums[channel]
                for index in frame..<(frame + take) { sum += samples[index] * samples[index] }
                sums[channel] = sum
            }
            counted += take
            frame += take
            if counted == slice {
                let loudest = sums.max() ?? 0
                levels.append(min(1, (loudest / Float(slice)).squareRoot()))
                sums = Array(repeating: 0, count: channels)
                counted = 0
            }
        }
        return levels
    }
}
