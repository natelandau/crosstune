@preconcurrency import AVFoundation
import AVKit
import Foundation
import Observation
import os

private let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "playback")

/// Plays a recording's audio file with `AVPlayer`: on through the lock screen and in the
/// background, out to AirPlay, headphones, or the speaker, with the lock screen and Control
/// Center showing it and driving it while it is loaded.
@MainActor
@Observable
public final class AudioPlayer: AudioPlayback {
    /// How far the skip controls move, the step podcasts and audiobooks use.
    nonisolated public static let skipInterval: TimeInterval = 15

    public private(set) var isPlaying = false
    public private(set) var elapsed: TimeInterval = 0
    public private(set) var duration: TimeInterval?
    public private(set) var hasFailed = false

    @ObservationIgnored private let player = AVPlayer()
    @ObservationIgnored private var nowPlaying: NowPlaying?
    @ObservationIgnored private var controls: NowPlayingControls?
    @ObservationIgnored private var itemObservers: [NSObjectProtocol] = []
    @ObservationIgnored private var statusObservation: NSKeyValueObservation?
    @ObservationIgnored private var timeObserver: Any?
    /// Counts loads, so a length or failure worked out for an earlier file is dropped.
    @ObservationIgnored private var generation = 0
    /// Set when an interruption such as a call stops playback, so its end can pick it back up.
    @ObservationIgnored private var interruptedWhilePlaying = false
    @ObservationIgnored private var sessionObservers: [NSObjectProtocol] = []

    /// Whether a take is being recorded now, which keeps playback silent.
    private let isCapturing: @MainActor () -> Bool

    /// - Parameter isCapturing: Whether a take is being recorded now. Tests pass their own, so
    ///   they never share the process-wide answer.
    public init(isCapturing: @escaping @MainActor () -> Bool = { Recorder.hasActiveCapture }) {
        self.isCapturing = isCapturing
        observeSession()
    }

    isolated deinit {
        for observer in sessionObservers { NotificationCenter.default.removeObserver(observer) }
        stopObserving()
    }

    public func showRoutes(in picker: AVRoutePickerView) {
        #if os(macOS)
            // The Mac's picker routes only the player it is given; iOS routes the whole session.
            picker.player = player
        #endif
    }

    public func load(_ url: URL, nowPlaying: NowPlaying) {
        unload()
        generation += 1
        let loadGeneration = generation
        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        self.nowPlaying = nowPlaying
        player.replaceCurrentItem(with: item)
        observe(item)
        controls = NowPlayingControls(player: self)
        publish()
        Task { [weak self] in
            do {
                let length = try await asset.load(.duration).seconds
                guard let self, generation == loadGeneration else { return }
                duration = length.isFinite ? length : nil
                publish()
            } catch {
                guard let self, self.generation == loadGeneration else { return }
                self.fail(error)
            }
        }
    }

    public func retitle(_ nowPlaying: NowPlaying) {
        guard self.nowPlaying != nil else { return }
        self.nowPlaying = nowPlaying
        publish()
    }

    public func play() {
        // A take in progress owns the session, and the microphone would hear the playback.
        guard player.currentItem != nil, !hasFailed, !isCapturing() else { return }
        activateSession()
        // A finished file starts over, as a player's play button does at the end.
        if let duration, elapsed >= duration - 0.05 { seek(to: 0) }
        player.play()
        isPlaying = true
        interruptedWhilePlaying = false
        publish()
    }

    public func pause() {
        guard player.currentItem != nil else { return }
        player.pause()
        isPlaying = false
        // Paused on purpose, so the end of an interruption leaves it paused.
        interruptedWhilePlaying = false
        refreshElapsed()
        publish()
    }

    public func seek(to seconds: TimeInterval) {
        guard player.currentItem != nil else { return }
        let target = clampedPosition(seconds, duration: duration)
        elapsed = target
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        publish()
    }

    public func unload() {
        guard player.currentItem != nil || nowPlaying != nil else { return }
        generation += 1
        player.pause()
        stopObserving()
        player.replaceCurrentItem(with: nil)
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

    // MARK: Item

    private func observe(_ item: AVPlayerItem) {
        let center = NotificationCenter.default
        let reasonKey = AVPlayer.rateDidChangeReasonKey
        itemObservers = [
            center.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) {
                [weak self] _ in
                MainActor.assumeIsolated { self?.reachedEnd() }
            },
            center.addObserver(
                forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main
            ) { [weak self] note in
                let error = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? any Error
                MainActor.assumeIsolated { self?.fail(error) }
            },
            // The rate also changes from outside the app: a route that goes away, or an
            // AirPlay receiver's own controls.
            center.addObserver(forName: AVPlayer.rateDidChangeNotification, object: player, queue: .main) {
                [weak self] note in
                let interrupted =
                    note.userInfo?[reasonKey] as? AVPlayer.RateDidChangeReason == .audioSessionInterrupted
                MainActor.assumeIsolated { self?.rateChanged(interrupted: interrupted) }
            },
        ]
        let loadGeneration = generation
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            let error = item.error
            Task { @MainActor in
                // A failure queued as the file was replaced belongs to the file that is gone.
                guard let self, self.generation == loadGeneration else { return }
                self.fail(error)
            }
        }
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated { self?.timeAdvanced(time.seconds) }
        }
    }

    private func stopObserving() {
        for observer in itemObservers { NotificationCenter.default.removeObserver(observer) }
        itemObservers = []
        statusObservation?.invalidate()
        statusObservation = nil
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
    }

    private func timeAdvanced(_ seconds: Double) {
        guard seconds.isFinite, player.currentItem != nil else { return }
        elapsed = clampedPosition(seconds, duration: duration)
    }

    private func refreshElapsed() {
        timeAdvanced(player.currentTime().seconds)
    }

    private func reachedEnd() {
        isPlaying = false
        if let duration { elapsed = duration }
        publish()
    }

    /// `interrupted` marks the system pausing for an interruption, which can arrive before the
    /// session says the interruption began.
    private func rateChanged(interrupted: Bool) {
        guard player.currentItem != nil else { return }
        let playing = player.rate != 0
        guard playing != isPlaying else { return }
        if interrupted && isPlaying { interruptedWhilePlaying = true }
        isPlaying = playing
        refreshElapsed()
        publish()
    }

    private func fail(_ error: (any Error)?) {
        guard player.currentItem != nil, !hasFailed else { return }
        logger.error("A recording could not be played: \(String(describing: error), privacy: .public)")
        player.pause()
        hasFailed = true
        isPlaying = false
        publish()
    }

    private func publish() {
        guard let nowPlaying else { return }
        controls?.publish(nowPlaying, duration: duration, elapsed: elapsed, isPlaying: isPlaying)
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
            sessionObservers = [interruptions, routeChanges]
        }

        private func interruption(_ type: AVAudioSession.InterruptionType?, shouldResume: Bool) {
            guard player.currentItem != nil else { return }
            switch type {
            case .began:
                if isPlaying { interruptedWhilePlaying = true }
                isPlaying = false
                refreshElapsed()
                publish()
            case .ended:
                // The system says when picking up again is expected, as after a call but not
                // after another app starts its own audio.
                if interruptedWhilePlaying && shouldResume { play() }
                interruptedWhilePlaying = false
            default:
                break
            }
        }

        /// Headphones pulled out, or a Bluetooth device gone, pause rather than carry on out
        /// loud from the speaker.
        private func routeChanged(_ reason: AVAudioSession.RouteChangeReason?) {
            guard reason == .oldDeviceUnavailable, isPlaying else { return }
            pause()
        }
    #else
        private func activateSession() {}
        private func deactivateSession() {}
        private func observeSession() {}
    #endif
}
