@preconcurrency import AVFoundation
import Foundation
import Observation
import os

private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "playback")

/// Plays a recording's audio file through `AVAudioEngine`: the player node feeds a time-pitch
/// unit, so the trim window, the speed, and the pitch each change on their own. Plays on
/// through the lock screen and in the background, out to AirPlay, headphones, or the speaker,
/// with the lock screen and Control Center showing it and driving it while it is loaded.
@MainActor
@Observable
public final class AudioPlayer: AudioPlayback {
    /// How far the skip controls move, the step podcasts and audiobooks use.
    nonisolated public static let skipInterval: TimeInterval = 15

    public private(set) var isPlaying = false
    public private(set) var elapsed: TimeInterval = 0
    public private(set) var duration: TimeInterval?
    public private(set) var hasFailed = false

    @ObservationIgnored let engine = AVAudioEngine()
    @ObservationIgnored private let node = AVAudioPlayerNode()
    @ObservationIgnored let timePitch = AVAudioUnitTimePitch()
    @ObservationIgnored private var file: AVAudioFile?
    @ObservationIgnored private var fileDuration: TimeInterval = 0
    /// The part of the file that plays, held within it.
    @ObservationIgnored private var window = PlaybackWindow(from: 0, to: 0)
    /// Where the scheduled segment starts on the trimmed timeline; the node counts from there.
    @ObservationIgnored private var segmentStart: TimeInterval = 0
    /// Counts schedules, so the end of a segment that was stopped or replaced is ignored.
    @ObservationIgnored private var segmentID = 0
    /// The offline renderer has no device to play back to, so it reports rendered data instead.
    @ObservationIgnored private let segmentEnd: AVAudioPlayerNodeCompletionCallbackType
    @ObservationIgnored private var nowPlaying: NowPlaying?
    @ObservationIgnored private var controls: NowPlayingControls?
    /// Where each state the system should show goes: the lock screen and Control Center, or a
    /// test watching what they would be told.
    @ObservationIgnored var publishes: @MainActor (PublishedPlayback) -> Void = { _ in }
    /// Moves `elapsed` on while playing; the node itself reports nothing.
    @ObservationIgnored private var ticker: Task<Void, Never>?
    /// How often the ticker reads the position, and so how often `elapsed` moves while playing.
    nonisolated public static let tick: TimeInterval = 0.25
    /// The last position read from the node and the host time it was rendered at, so a
    /// position asked for after the system stops the engine can be carried on from it.
    @ObservationIgnored private var lastReading: (position: TimeInterval, hostTime: UInt64)?
    /// Set when an interruption such as a call stops playback, so its end can pick it back up.
    @ObservationIgnored private var interruptedWhilePlaying = false
    #if os(iOS)
        /// The session's outputs when playback started or the route last changed, so a
        /// configuration change can tell a device that went away from one that was added.
        @ObservationIgnored private var outputs: Set<OutputPort> = []
    #endif
    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    /// Whether a take is being recorded now, which keeps playback silent.
    private let isCapturing: @MainActor () -> Bool

    /// - Parameter isCapturing: Whether a take is being recorded now. Tests pass their own, so
    ///   they never share the process-wide answer.
    public convenience init(isCapturing: @escaping @MainActor () -> Bool = { Recorder.hasActiveCapture }) {
        self.init(isCapturing: isCapturing, rendersOffline: false)
    }

    /// - Parameter rendersOffline: Renders only when ``render(seconds:)`` asks, instead of to
    ///   the output device, so a test controls how much plays.
    init(isCapturing: @escaping @MainActor () -> Bool, rendersOffline: Bool) {
        self.isCapturing = isCapturing
        segmentEnd = rendersOffline ? .dataRendered : .dataPlayedBack
        if rendersOffline {
            let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2)!
            do {
                try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
            } catch {
                logger.error("The offline renderer did not start: \(error, privacy: .public)")
            }
        }
        engine.attach(node)
        engine.attach(timePitch)
        observeEngine()
        observeSession()
        publishes = { [weak self] state in
            self?.controls?.publish(
                state.nowPlaying, duration: state.duration, elapsed: state.elapsed,
                isPlaying: state.isPlaying, rate: state.rate)
        }
    }

    isolated deinit {
        ticker?.cancel()
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        engine.stop()
    }

    public func load(_ url: URL, nowPlaying: NowPlaying) {
        unload()
        timePitch.rate = 1
        timePitch.pitch = 0
        self.nowPlaying = nowPlaying
        controls = NowPlayingControls(player: self)
        do {
            let file = try AVAudioFile(forReading: url)
            let format = file.processingFormat
            try probe(file)
            engine.connect(node, to: timePitch, format: format)
            engine.connect(timePitch, to: engine.mainMixerNode, format: format)
            self.file = file
            fileDuration = Double(file.length) / format.sampleRate
            window = PlaybackWindow(from: 0, to: fileDuration)
            duration = window.length
        } catch {
            fail(error)
        }
        publish()
    }

    /// Decodes the file's first frames. The player node reports no error for audio it cannot
    /// decode, and plays silence instead, so a file that opens but does not decode fails here.
    private func probe(_ file: AVAudioFile) throws {
        let frames = AVAudioFrameCount(clamping: min(file.length, 4096))
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames)
        else { return }
        try file.read(into: buffer, frameCount: frames)
        file.framePosition = 0
    }

    public func retitle(_ nowPlaying: NowPlaying) {
        guard self.nowPlaying != nil else { return }
        self.nowPlaying = nowPlaying
        publish()
    }

    public func setWindow(_ window: PlaybackWindow?) {
        guard file != nil else { return }
        refreshElapsed()
        let place = self.window.from + elapsed
        self.window = (window ?? PlaybackWindow(from: 0, to: fileDuration)).clamped(to: fileDuration)
        duration = self.window.length
        elapsed = min(max(place, self.window.from), self.window.to) - self.window.from
        rescheduleIfPlaying()
        publish()
    }

    public func setRate(_ percent: Int) {
        refreshElapsed()
        timePitch.rate = Float(percent) / 100
        publish()
    }

    public func setPitch(cents: Int) {
        timePitch.pitch = Float(cents)
    }

    /// Publishes the outcome once whether or not playback starts, so a caller that stopped
    /// playback just before, such as a configuration change, never leaves the system showing it.
    public func play() {
        startPlayback()
        publish()
    }

    private func startPlayback() {
        // A take in progress owns the session, and the microphone would hear the playback.
        guard file != nil, !hasFailed, !isPlaying, !isCapturing() else { return }
        activateSession()
        // A finished window starts over, as a player's play button does at the end.
        if elapsed >= window.length - 0.05 { elapsed = 0 }
        do {
            if !engine.isRunning { try engine.start() }
        } catch {
            markFailed(error)
            deactivateSession()
            return
        }
        guard schedule(from: elapsed) else {
            engine.pause()
            deactivateSession()
            return
        }
        node.play()
        isPlaying = true
        interruptedWhilePlaying = false
        #if os(iOS)
            outputs = currentOutputs()
        #endif
        startTicking()
    }

    public func pause() {
        guard file != nil else { return }
        refreshElapsed()
        stopPlayback()
        isPlaying = false
        // Paused on purpose, so the end of an interruption leaves it paused.
        interruptedWhilePlaying = false
        publish()
    }

    public func seek(to seconds: TimeInterval) {
        guard file != nil else { return }
        elapsed = clampedPosition(seconds, duration: duration)
        rescheduleIfPlaying()
        publish()
    }

    public func unload() {
        guard file != nil || nowPlaying != nil else { return }
        stopPlayback()
        engine.stop()
        file = nil
        fileDuration = 0
        window = PlaybackWindow(from: 0, to: 0)
        segmentStart = 0
        controls?.remove()
        controls = nil
        nowPlaying = nil
        isPlaying = false
        elapsed = 0
        duration = nil
        hasFailed = false
        interruptedWhilePlaying = false
        NowPlayingControls.clear()
        deactivateSession()
    }

    /// Renders `seconds` of output on the offline renderer, as the output device would pull it.
    func render(seconds: TimeInterval) throws {
        let format = engine.manualRenderingFormat
        let capacity = engine.manualRenderingMaximumFrameCount
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
        var remaining = AVAudioFrameCount(seconds * format.sampleRate)
        while remaining > 0 {
            let frames = min(remaining, capacity)
            _ = try engine.renderOffline(frames, to: buffer)
            remaining -= frames
        }
        refreshElapsed()
    }

    // MARK: Segment

    /// Stops the node and schedules the window from `position` to its end, ready to play.
    /// False when nothing of the window is left.
    private func schedule(from position: TimeInterval) -> Bool {
        segmentID += 1
        node.stop()
        guard
            let file,
            let segment = window.segment(
                at: position, sampleRate: file.processingFormat.sampleRate, fileLength: file.length)
        else { return false }
        segmentStart = position
        lastReading = nil
        let id = segmentID
        node.scheduleSegment(
            file, startingFrame: segment.startFrame, frameCount: segment.frameCount, at: nil,
            completionCallbackType: segmentEnd
        ) { [weak self] _ in
            Task { @MainActor in self?.segmentEnded(id) }
        }
        return true
    }

    private func rescheduleIfPlaying() {
        guard isPlaying else { return }
        if schedule(from: elapsed) { node.play() } else { reachedEnd() }
    }

    /// Stops the node and lets the output hardware rest, keeping the file loaded.
    private func stopPlayback() {
        segmentID += 1
        node.stop()
        ticker?.cancel()
        ticker = nil
        lastReading = nil
        engine.pause()
    }

    /// A segment also ends when the system stops the engine; the interruption and
    /// configuration handlers pick that up from where it stood, so only a running engine ends.
    private func segmentEnded(_ id: Int) {
        guard id == segmentID, isPlaying, engine.isRunning else { return }
        reachedEnd()
    }

    private func reachedEnd() {
        stopPlayback()
        isPlaying = false
        elapsed = 0
        publish()
    }

    private func startTicking() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.tick))
                self?.refreshElapsed()
            }
        }
    }

    /// Reads the position from the node while it plays; paused, `elapsed` already holds it.
    /// Once the system has stopped the engine the node has no position, so the last reading is
    /// carried on by the time since at the playing rate, never by more than a tick.
    private func refreshElapsed() {
        guard isPlaying else { return }
        if let nodeTime = node.lastRenderTime, nodeTime.isSampleTimeValid,
            let playerTime = node.playerTime(forNodeTime: nodeTime)
        {
            elapsed = playbackPosition(
                segmentStart: segmentStart, playedFrames: playerTime.sampleTime,
                sampleRate: playerTime.sampleRate, duration: window.length)
            if nodeTime.isHostTimeValid { lastReading = (elapsed, nodeTime.hostTime) }
        } else if let lastReading {
            let now = mach_absolute_time()
            let since = now > lastReading.hostTime ? AVAudioTime.seconds(forHostTime: now - lastReading.hostTime) : 0
            let played = min(since, Self.tick) * Double(timePitch.rate)
            elapsed = clampedPosition(lastReading.position + played, duration: window.length)
        }
    }

    private func fail(_ error: (any Error)?) {
        guard markFailed(error) else { return }
        publish()
    }

    /// Stops playback for good on this file. False when there was nothing to fail.
    @discardableResult
    private func markFailed(_ error: (any Error)?) -> Bool {
        guard nowPlaying != nil, !hasFailed else { return false }
        logger.error("A recording could not be played: \(String(describing: error), privacy: .public)")
        stopPlayback()
        hasFailed = true
        isPlaying = false
        return true
    }

    private func publish() {
        guard let nowPlaying else { return }
        publishes(
            PublishedPlayback(
                nowPlaying: nowPlaying, duration: duration, elapsed: elapsed, isPlaying: isPlaying,
                rate: timePitch.rate))
    }

    // MARK: Engine

    private func observeEngine() {
        let change = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.configurationChanged() }
        }
        observers.append(change)
    }

    /// A new output device or format stops the engine, so playing goes on from where it stood.
    private func configurationChanged() {
        guard file != nil, isPlaying else { return }
        #if os(iOS)
            // The engine can hear of a lost device before the session's route change does.
            if lostAnOutput(recorded: outputs, current: currentOutputs()) {
                pause()
                return
            }
        #endif
        refreshElapsed()
        stopPlayback()
        isPlaying = false
        play()
    }

    // MARK: Session

    #if os(iOS)
        /// Playback on its own, so it goes on with the screen locked and the ring switch set to
        /// silent, and long-form, so AirPlay treats it as a listening session rather than a
        /// sound effect. Recording sets its own category for the take, and closes the player
        /// before it does.
        private func activateSession() {
            let session = AVAudioSession.sharedInstance()
            do {
                try session.setCategory(.playback, mode: .default, policy: .longFormAudio)
                try session.setActive(true)
            } catch {
                logger.error("The audio session could not start playback: \(error, privacy: .public)")
            }
        }

        private func deactivateSession() {
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                logger.debug("The audio session did not deactivate: \(error, privacy: .public)")
            }
        }

        private func observeSession() {
            let center = NotificationCenter.default
            let session = AVAudioSession.sharedInstance()
            // Observed for the player's whole life, and ignored while nothing is loaded.
            let interruptions = center.addObserver(
                forName: AVAudioSession.interruptionNotification, object: session, queue: .main
            ) {
                [weak self] note in
                let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                    .flatMap(AVAudioSession.InterruptionType.init)
                let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                    .map(AVAudioSession.InterruptionOptions.init)
                MainActor.assumeIsolated {
                    self?.interruption(type, shouldResume: options?.contains(.shouldResume) == true)
                }
            }
            let routeChanges = center.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
            ) {
                [weak self] note in
                let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt)
                    .flatMap(AVAudioSession.RouteChangeReason.init)
                MainActor.assumeIsolated { self?.routeChanged(reason) }
            }
            observers += [interruptions, routeChanges]
        }

        private func interruption(_ type: AVAudioSession.InterruptionType?, shouldResume: Bool) {
            guard file != nil else { return }
            switch type {
            case .began:
                guard isPlaying else { return }
                interruptedWhilePlaying = true
                refreshElapsed()
                stopPlayback()
                isPlaying = false
                publish()
            case .ended:
                // The system says when picking up again is expected, as after a call but not
                // after another app starts its own audio. Play restarts the engine the
                // interruption stopped.
                if interruptedWhilePlaying && shouldResume { play() }
                interruptedWhilePlaying = false
            default:
                break
            }
        }

        /// Headphones pulled out, or a Bluetooth device gone, pause rather than carry on out
        /// loud from the speaker.
        private func routeChanged(_ reason: AVAudioSession.RouteChangeReason?) {
            outputs = currentOutputs()
            guard reason == .oldDeviceUnavailable, isPlaying else { return }
            pause()
        }

        private func currentOutputs() -> Set<OutputPort> {
            Set(
                AVAudioSession.sharedInstance().currentRoute.outputs.map {
                    OutputPort(type: $0.portType.rawValue, uid: $0.uid)
                })
        }
    #else
        private func activateSession() {}
        private func deactivateSession() {}
        private func observeSession() {}
    #endif
}

/// One of the audio session's outputs: headphones, a Bluetooth device, the speaker.
struct OutputPort: Hashable {
    let type: String
    let uid: String
}

/// Whether any output in `recorded` is missing from `current`, as when headphones come out.
func lostAnOutput(recorded: Set<OutputPort>, current: Set<OutputPort>) -> Bool {
    !recorded.isSubset(of: current)
}
