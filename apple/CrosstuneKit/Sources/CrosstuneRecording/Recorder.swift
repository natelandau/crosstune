import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import Foundation
import Observation

/// One recording at a time from the microphone, written to the user's audio folder as it
/// records and saved as a recording when it stops.
@MainActor
@Observable
public final class Recorder {
    public enum State: Equatable, Sendable {
        case idle
        case recording
        /// Stopped by an interruption such as a phone call; the recording so far is kept.
        case paused
        /// Saving the stopped recording.
        case finishing
    }

    nonisolated public static let microphoneDenied =
        "Crosstune needs microphone access. Allow it in Settings and try again."
    nonisolated public static let microphoneFailed = "The microphone could not be started."
    nonisolated public static let startFailed = "The recording could not be started."
    nonisolated public static let saveFailed =
        "The recording could not be saved. It will be recovered the next time Crosstune opens."
    nonisolated public static let partialSave = "Part of this recording could not be saved."
    nonisolated public static let sizeLimit = "This recording reached the size limit and was saved."
    nonisolated public static let nothingRecorded = "Nothing was recorded."
    nonisolated public static let discardFailed = "The recording could not be discarded."

    /// A recording stops at this share of the server's largest accepted file, leaving room for the
    /// encoder's last packets and the `.m4a` container so the finished file can still upload.
    static let sizeLimitFraction = 0.95
    /// How long after Stop a fix still pending is saved to the recording. A fix takes seconds to
    /// settle, so a short recording often stops first.
    static let lateFixWindow: Duration = .seconds(10)

    /// Captures still being written in this process, which launch recovery must leave alone.
    static var active: Set<String> = []

    public private(set) var state: State = .idle
    /// Seconds of audio captured, not counting time paused.
    public private(set) var elapsed: TimeInterval = 0
    /// Recent input levels from 0 to 1, oldest first, about ``InputLevels/perSecond`` a second.
    public private(set) var levels: [Float] = []
    /// How many levels this recording has measured in all, so a reader of ``levels`` can tell which
    /// are new once the window is full.
    public private(set) var levelCount = 0
    /// True once an interruption has ended, so the recording can go on.
    public private(set) var resumeAvailable = false
    /// True when the user has refused microphone access.
    public private(set) var permissionDenied = false
    /// What went wrong with the last start, stop, or discard.
    public private(set) var errorMessage: String?
    /// The recording the last stop saved.
    public private(set) var savedRecordingID: String?
    /// True while a start waits on permission and the store. A second start does nothing,
    /// and a stop or discard backs the start out.
    public private(set) var isStarting = false
    /// Where the device was, once its fix settles during the recording. A fix that settles after
    /// the recording stops is saved by ``lateFixes`` instead.
    @ObservationIgnored private(set) var settledCoordinate: Coordinate?
    /// Whether the recording's location request has answered, with a fix or with none.
    @ObservationIgnored private(set) var isFixSettled = false
    /// Saved recordings waiting on a fix that was still pending at Stop, by recording.
    @ObservationIgnored private(set) var lateFixes: [String: Task<Void, Never>] = [:]

    private let store: CrosstuneStore
    private let input: any AudioInput
    private let channels: @MainActor () -> CaptureChannels
    private let location: (any LocationProvider)?
    private let sleep: @MainActor (Duration) async throws -> Void
    /// The recording's request for a fix, until the recording ends.
    @ObservationIgnored private var fix: Task<Coordinate?, Never>?
    /// Notes the fix as the recording's while it records.
    @ObservationIgnored private var locating: Task<Void, Never>?
    private var capture: (id: String, writer: CaptureWriter)?
    private var inputLevels = InputLevels()
    /// Set by a stop or discard that arrives while a start is still under way: the start
    /// backs out at its next step instead of recording.
    private var abandoned = false
    /// The file size at which the recording stops, from the server's per-file cap.
    private var sizeCap: Int64?
    /// The length at which the capture stops, short of the longest source a split parent may have.
    private let captureStopMs: Int64
    /// Why the recording ended early, told once it is saved.
    private var endedEarly: String?
    private var isResuming = false

    /// - Parameters:
    ///   - channels: The device's mono or stereo setting, read as each recording starts.
    ///   - location: Where each recording was made; nil saves no place.
    ///   - sleep: Waits out ``lateFixWindow``.
    public init(
        store: CrosstuneStore, input: (any AudioInput)? = nil,
        channels: @escaping @MainActor () -> CaptureChannels = { CaptureChannels.stored() },
        location: (any LocationProvider)? = nil,
        sleep: @escaping @MainActor (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        captureStopMs: Int64 = RecordingLimits.captureStopMs
    ) {
        self.captureStopMs = captureStopMs
        self.store = store
        self.input = input ?? EngineInput()
        self.channels = channels
        self.location = location
        self.sleep = sleep
    }

    /// Finishes every capture an earlier run left unfinished, as after a crash, except any
    /// this process is still recording, then deletes the audio and scan files no row names. Call
    /// when a user's store opens.
    public static func recoverLeftoverCaptures(in store: CrosstuneStore) async {
        await CaptureFinisher(store: store).recoverLeftovers(skipping: active, startedBefore: .now)
        // Only after recovery, which records a finished file its row does not name yet.
        await store.deleteUnnamedFiles()
    }

    /// Whether this process is recording or saving any recording now. Playback waits until it is not,
    /// since it would change the audio session under the microphone, or be recorded into the recording.
    public static var hasActiveCapture: Bool {
        !active.isEmpty
    }

    /// Whether `recordingID` is a capture this process is still recording, as opposed to one an
    /// earlier run left behind.
    public static func isRecording(_ recordingID: String) -> Bool {
        active.contains(recordingID)
    }

    /// Throws away a capture an earlier run left that recovery could not save, deleting its
    /// audio and its row, so it stops holding up sign-out. A capture still being recorded is
    /// left alone.
    public static func discardUnfinishedCapture(_ recordingID: String, in store: CrosstuneStore) async throws {
        guard !active.contains(recordingID) else { return }
        try await CaptureFinisher(store: store).discard(recordingID)
    }

    /// Starts recording, filed under `tuneID` when it is saved, or unfiled when nil.
    public func start(tuneID: String?) async {
        guard state == .idle, capture == nil, !isStarting else { return }
        isStarting = true
        abandoned = false
        defer { isStarting = false }
        errorMessage = nil
        savedRecordingID = nil
        let granted = await input.requestPermission()
        if abandoned { return }
        guard granted else {
            permissionDenied = true
            errorMessage = Self.microphoneDenied
            return
        }
        permissionDenied = false
        // Asked only once the microphone is granted, so a refused recording never prompts for location.
        startLocating()
        let commands = Commands(store: store)
        let finisher = CaptureFinisher(store: store)
        let recordingID = newID()
        // Claimed before the first await that could let launch recovery run.
        Self.active.insert(recordingID)
        do {
            let bitrate = try await commands.captureBitrate()
            // Without usage from the server yet, the recording has no cap, as on the web. A capture
            // over the plain cap is held on this device until it is split, and uploads as a split
            // parent, so only the split parent's cap stops it.
            let usage = (try? await store.meta(.storage, as: StorageUsage.self)) ?? nil
            let cap = usage.map { $0.splitParentMaxFileBytes ?? $0.maxFileBytes }
            try await commands.beginCapture(
                recordingID, fileName: CaptureFiles.captureName(recordingID), tuneID: tuneID, recordedAt: .now)
            if abandoned { return await backOut(recordingID) }
            let preferred = channels()
            let inputChannels: Int
            do {
                inputChannels = try await input.prepare(preferring: preferred)
            } catch {
                return await microphoneDidFail(recordingID)
            }
            // A stop or discard can arrive while the microphone prepares.
            if abandoned { return await backOut(recordingID) }
            let count = CaptureChannels.resolve(preferred, inputChannels: inputChannels)
            let writer = try CaptureWriter(
                url: finisher.captureURL(recordingID), bitrate: CaptureChannels.bitrate(mono: bitrate, channels: count),
                channels: count)
            capture = (recordingID, writer)
            do {
                try await input.start(
                    writer: writer,
                    onLevels: { [weak self] levels in self?.received(levels) },
                    onEvent: { [weak self] event in self?.handle(event) })
            } catch {
                return await microphoneDidFail(recordingID)
            }
            // A stop or discard can arrive while the microphone starts.
            if abandoned { return await backOut(recordingID) }
            sizeCap = cap.map { Int64(Double($0) * Self.sizeLimitFraction) }
            endedEarly = nil
            elapsed = 0
            inputLevels.removeAll()
            levels = []
            levelCount = 0
            resumeAvailable = false
            state = .recording
        } catch {
            await backOut(recordingID)
            errorMessage = Self.startFailed
        }
    }

    /// Goes on recording into the same recording after an interruption.
    public func resume() async {
        guard state == .paused, resumeAvailable, !isResuming else { return }
        isResuming = true
        defer { isResuming = false }
        do {
            try await input.resume()
            // A stop while the microphone restarted has already ended the recording.
            guard state == .paused else { return }
            resumeAvailable = false
            state = .recording
        } catch {
            // A stop while the microphone restarted has already ended the recording.
            guard state == .paused else { return }
            errorMessage = Self.microphoneFailed
        }
    }

    /// Stops and saves the recording. Returns the saved recording's ID, or nil when there was
    /// nothing to save or saving failed. A stop while the start is still under way backs the
    /// start out, saving nothing.
    @discardableResult
    public func stop() async -> String? {
        if isStarting {
            abandoned = true
            return nil
        }
        guard let capture, state == .recording || state == .paused else { return nil }
        let recordingID = capture.id
        state = .finishing
        let (coordinate, pending) = endLocating()
        let window = pending.map(startLateFixWindow)
        await release(capture.writer)
        // Read only after the tap is fully stopped, so every buffer it wrote is metered too.
        let peaks = capture.writer.recordedPeaks
        defer { reset(recordingID) }
        let finisher = CaptureFinisher(store: store)
        do {
            guard let savedAt = try await finisher.finish(recordingID, peaks: peaks, coordinate: coordinate) else {
                pending?.cancel()
                window?.cancel()
                errorMessage = Self.nothingRecorded
                return nil
            }
            if let pending, let window { saveLateFix(pending, window: window, to: recordingID, savedAt: savedAt) }
            savedRecordingID = recordingID
            errorMessage = endedEarly
            return recordingID
        } catch {
            pending?.cancel()
            window?.cancel()
            errorMessage = Self.saveFailed
            return nil
        }
    }

    /// Stops and throws the recording away, writing no recording. A discard while the start is
    /// still under way backs the start out.
    public func discard() async {
        if isStarting {
            abandoned = true
            return
        }
        guard let capture, state == .recording || state == .paused else { return }
        let recordingID = capture.id
        state = .finishing
        stopLocating()
        await release(capture.writer)
        defer { reset(recordingID) }
        do {
            try await CaptureFinisher(store: store).discard(recordingID)
        } catch {
            errorMessage = Self.discardFailed
        }
    }

    /// Undoes a start that did not reach recording: releases the microphone and its session,
    /// and deletes the capture and its row.
    private func backOut(_ recordingID: String) async {
        stopLocating()
        await input.stop()
        capture?.writer.close()
        capture = nil
        try? await CaptureFinisher(store: store).discard(recordingID)
        Self.active.remove(recordingID)
    }

    /// Asks where the device is without waiting on the answer: a slow, refused, or failed fix
    /// only means the recording has no place.
    private func startLocating() {
        settledCoordinate = nil
        isFixSettled = false
        guard let location else { return }
        let fix = Task { () -> Coordinate? in
            let found = await location.currentLocation()
            return Task.isCancelled ? nil : found
        }
        self.fix = fix
        locating = Task { [weak self] in
            let found = await fix.value
            guard !Task.isCancelled else { return }
            self?.settledCoordinate = found
            self?.isFixSettled = true
        }
    }

    /// Ends the recording's location request.
    private func stopLocating() {
        let (_, pending) = endLocating()
        pending?.cancel()
    }

    /// Lets go of the recording's location request, returning the fix if one settled, or else the
    /// request still pending, which the caller now owns. A request that settled with no fix
    /// returns neither.
    private func endLocating() -> (settled: Coordinate?, pending: Task<Coordinate?, Never>?) {
        locating?.cancel()
        locating = nil
        let pending = fix
        fix = nil
        defer {
            settledCoordinate = nil
            isFixSettled = false
        }
        return isFixSettled ? (settledCoordinate, nil) : (nil, pending)
    }

    /// Cancels `pending` once ``lateFixWindow`` has passed.
    private func startLateFixWindow(_ pending: Task<Coordinate?, Never>) -> Task<Void, Never> {
        Task { [sleep] in
            do { try await sleep(Self.lateFixWindow) } catch { return }
            pending.cancel()
        }
    }

    /// Saves `pending` to the saved recording once it settles, unless the window closes first or the
    /// recording has changed since `savedAt`.
    private func saveLateFix(
        _ pending: Task<Coordinate?, Never>, window: Task<Void, Never>, to recordingID: String, savedAt: Timestamp
    ) {
        let store = store
        lateFixes[recordingID] = Task { [weak self] in
            let found = await pending.value
            window.cancel()
            if let found {
                _ = try? await Commands(store: store).addLateFix(recordingID, coordinate: found, savedAt: savedAt)
            }
            self?.lateFixes[recordingID] = nil
        }
    }

    private func microphoneDidFail(_ recordingID: String) async {
        await backOut(recordingID)
        errorMessage = Self.microphoneFailed
    }

    private func release(_ writer: CaptureWriter) async {
        await input.stop()
        writer.close()
        elapsed = writer.duration
    }

    private func reset(_ recordingID: String) {
        capture = nil
        Self.active.remove(recordingID)
        resumeAvailable = false
        state = .idle
    }

    private func received(_ newLevels: [Float]) {
        guard state == .recording, let capture else { return }
        inputLevels.append(contentsOf: newLevels)
        levels = inputLevels.values
        levelCount += newLevels.count
        elapsed = capture.writer.duration
        let overSize = sizeCap.map { capture.writer.bytesWritten >= $0 } ?? false
        if overSize || Int64(elapsed * 1000) >= captureStopMs {
            endedEarly = Self.sizeLimit
            Task { await stop() }
        }
    }

    private func handle(_ event: AudioInputEvent) {
        guard state == .recording || state == .paused else { return }
        switch event {
        case .interrupted:
            state = .paused
            resumeAvailable = false
        case .interruptionEnded, .failed:
            state = .paused
            resumeAvailable = true
        case .writeFailed:
            // Whatever reached the file is still the recording, so it is kept as Stop would.
            endedEarly = Self.partialSave
            Task { await stop() }
        }
    }
}
