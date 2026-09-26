#if DEBUG
    import AVFoundation
    import Foundation

    /// Audio for the sample catalog's recordings, made on the spot rather than shipped.
    enum SampleAudio {
        /// Writes `seconds` of a gentle arpeggio in D as AAC in an `.m4a` file at `url`.
        @concurrent
        static func writeTone(to url: URL, seconds: Double) async throws {
            let sampleRate = 44_100.0
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: 1,
            ]
            let file = try AVAudioFile(
                forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
            let notes = [293.66, 369.99, 440.0, 587.33]
            let noteFrames = Int(sampleRate / 2)
            let totalFrames = Int(sampleRate * seconds)
            let chunk = 4096
            guard
                let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(chunk))
            else { return }
            var frame = 0
            while frame < totalFrames {
                let count = min(chunk, totalFrames - frame)
                let samples = buffer.floatChannelData![0]
                for index in 0..<count {
                    let position = frame + index
                    let frequency = notes[(position / noteFrames) % notes.count]
                    let intoNote = Double(position % noteFrames) / Double(noteFrames)
                    // A plucked shape: a quick rise, then a fade to the next note.
                    let envelope = min(1, intoNote * 40) * (1 - intoNote)
                    samples[index] = Float(0.2 * envelope * sin(2 * .pi * frequency * Double(position) / sampleRate))
                }
                buffer.frameLength = AVAudioFrameCount(count)
                try file.write(from: buffer)
                frame += count
            }
        }
    }
#endif
