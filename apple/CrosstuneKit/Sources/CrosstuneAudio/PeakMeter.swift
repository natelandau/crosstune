@preconcurrency import AVFoundation

/// Measures a stream of audio buffers as one byte per ``Peaks/pointsPerSecond`` window: the
/// loudest sample's magnitude across every channel, scaled to 0-255 at full scale, the unit the
/// waveform file stores.
///
/// A window a buffer ends partway through is completed by the next buffer, so the rate holds at
/// ``Peaks/pointsPerSecond`` whatever size the buffers arrive in, the same carry ``LevelMeter``
/// uses for its own windows.
public struct PeakMeter: Sendable {
    private var windowSize = 0
    private var peak: Float = 0
    private var counted = 0
    private var sampleRate = 0.0

    public init() {}

    public mutating func peaks(of buffer: AVAudioPCMBuffer) -> [UInt8] {
        guard let data = buffer.floatChannelData else { return [] }
        let channels = Int(buffer.format.channelCount)
        if buffer.format.sampleRate != sampleRate {
            // A new input starts a fresh window rather than mixing two formats in one.
            sampleRate = buffer.format.sampleRate
            windowSize = max(1, Int(sampleRate) / Peaks.pointsPerSecond)
            peak = 0
            counted = 0
        }
        let frames = Int(buffer.frameLength)
        var values: [UInt8] = []
        var frame = 0
        while frame < frames {
            let take = min(windowSize - counted, frames - frame)
            for channel in 0..<channels {
                let samples = data[channel]
                for index in frame..<(frame + take) {
                    let magnitude = abs(samples[index])
                    if magnitude > peak { peak = magnitude }
                }
            }
            counted += take
            frame += take
            if counted == windowSize {
                values.append(Peaks.byte(from: peak))
                peak = 0
                counted = 0
            }
        }
        return values
    }
}
