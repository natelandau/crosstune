#if DEBUG
    @preconcurrency import AVFoundation
    import Foundation

    /// A microphone that plays an audio file, for marketing captures where the simulator's
    /// microphone would record silence. Debug builds only.
    ///
    /// The file is fed to the writer at real time in buffers of about 100 ms and loops when a
    /// take outlasts it.
    @MainActor
    public final class FileInput: AudioInput {
        private nonisolated static let chunk = 0.1

        private let url: URL
        private var file: AVAudioFile?
        private var writer: CaptureWriter?
        private var onLevels: (@MainActor @Sendable ([Float]) -> Void)?
        private var onEvent: (@MainActor @Sendable (AudioInputEvent) -> Void)?
        private var meters = Meters()
        private var feed: Task<Void, Never>?

        public init(url: URL) {
            self.url = url
        }

        public func requestPermission() async -> Bool { true }

        public func prepare(preferring channels: CaptureChannels) async throws -> Int {
            let file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
            self.file = file
            return Int(file.processingFormat.channelCount)
        }

        public func start(
            writer: CaptureWriter, onLevels: @escaping @MainActor @Sendable ([Float]) -> Void,
            onEvent: @escaping @MainActor @Sendable (AudioInputEvent) -> Void
        ) async throws {
            self.writer = writer
            self.onLevels = onLevels
            self.onEvent = onEvent
            meters = Meters()
            try await resume()
        }

        public func resume() async throws {
            guard feed == nil, let file, let writer, let onEvent else { return }
            let meters = meters
            // Levels are handed over without waiting, so a busy main actor never stalls the feed;
            // reading `onLevels` there drops any that arrive after stop.
            let report: @Sendable ([Float]) -> Void = { [weak self] levels in
                Task { @MainActor [weak self] in self?.onLevels?(levels) }
            }
            feed = Task {
                let failed = await Self.pump(file, to: writer, meters: meters, report: report)
                guard failed, !Task.isCancelled else { return }
                // The failed feed is over, so a later resume starts a new one.
                feed = nil
                onEvent(.writeFailed)
            }
        }

        public func stop() async {
            feed?.cancel()
            await feed?.value
            feed = nil
            file = nil
            writer = nil
            onLevels = nil
            onEvent = nil
        }

        /// Feeds `file` to `writer` until cancelled, off the main actor so reading and encoding
        /// never hold up the interface being captured. Returns true when a read or write failed.
        private nonisolated static func pump(
            _ file: AVAudioFile, to writer: CaptureWriter, meters: Meters,
            report: @Sendable ([Float]) -> Void
        ) async -> Bool {
            let format = file.processingFormat
            let frames = AVAudioFrameCount(format.sampleRate * chunk)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return true }
            let started = ContinuousClock.now
            var sent = 0.0
            while !Task.isCancelled {
                do {
                    // Reading at the end throws, so rewind before the file runs out.
                    if file.framePosition >= file.length { file.framePosition = 0 }
                    try file.read(into: buffer, frameCount: frames)
                    try writer.write(buffer)
                    writer.appendPeaks(meters.peak.peaks(of: buffer))
                } catch {
                    return true
                }
                report(meters.level.levels(of: buffer))
                sent += Double(buffer.frameLength) / format.sampleRate
                // Pace to real time so the waveform and the clock move as they do on a live take.
                try? await Task.sleep(until: started + .seconds(sent), clock: .continuous)
            }
            return false
        }
    }

    /// One take's metering state, carried across resumes and touched only by the running feed.
    private final class Meters: @unchecked Sendable {
        var level = LevelMeter()
        var peak = PeakMeter()
    }
#endif
