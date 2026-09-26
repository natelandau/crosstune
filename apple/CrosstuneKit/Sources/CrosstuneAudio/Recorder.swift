import CrosstuneCommands
import CrosstuneStore
import Foundation
import Observation

#if canImport(UIKit)
    import UIKit
#endif

/// One recording at a time from the microphone, written to the user's audio folder as it
/// records and saved as a recording when it stops.
@MainActor
@Observable
public final class Recorder {
    public enum State: Equatable, Sendable {
        case idle
        case recording
        /// Stopped by an interruption such as a phone call; the take so far is kept.
        case paused
        /// Saving the stopped take as a recording.
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

    /// A take stops at this share of the server's largest accepted file, leaving room for the
    /// encoder's last packets and the `.m4a` container so the finished file can still upload.
    static let sizeLimitFraction = 0.95

    /// Where the user grants microphone access to Crosstune.
    public static var settingsURL: URL? {
        #if os(iOS)
            URL(string: UIApplication.openSettingsURLString)
        #else
            URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        #endif
    }

    /// Captures still being written in this process, which launch recovery must leave alone.
    static var active: Set<String> = []

    public private(set) var state: State = .idle
    /// Seconds of audio captured, not counting time paused.
    public private(set) var elapsed: TimeInterval = 0
    /// Recent input levels from 0 to 1, oldest first, about ``InputLevels/perSecond`` a second.
    public private(set) var levels: [Float] = []
    /// How many levels this take has measured in all, so a reader of ``levels`` can tell which
    /// are new once the window is full.
    public private(set) var levelCount = 0
    /// True once an interruption has ended, so the take can go on.
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

    private let store: CrosstuneStore
    private let input: any AudioInput
    private var capture: (id: String, writer: CaptureWriter)?
    private var inputLevels = InputLevels()
    /// Set by a stop or discard that arrives while a start is still under way: the start
    /// backs out at its next step instead of recording.
    private var abandoned = false
    /// The file size at which the take stops, from the server's per-file cap.
    private var sizeCap: Int64?
    /// Why the take ended early, told once it is saved.
    private var endedEarly: String?
    private var isResuming = false

    public init(store: CrosstuneStore, input: (any AudioInput)? = nil) {
        self.store = store
        self.input = input ?? EngineInput()
    }

    /// Finishes every capture an earlier run left unfinished, as after a crash, except any
    /// this process is still recording, then deletes the audio files no recording names. Call
    /// when a user's store opens.
    public static func recoverLeftoverCaptures(in store: CrosstuneStore) async {
        await CaptureFinisher(store: store).recoverLeftovers(skipping: active, startedBefore: .now)
        // Only after recovery, which records a finished file its row does not name yet.
        await store.deleteUnnamedAudio()
    }

    /// Whether this process is recording or saving any take now. Playback waits until it is not,
    /// since it would change the audio session under the microphone, or be recorded into the take.
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
        let commands = Commands(store: store)
        let finisher = CaptureFinisher(store: store)
        let recordingID = newID()
        // Claimed before the first await that could let launch recovery run.
        Self.active.insert(recordingID)
        do {
            let bitrate = try await commands.captureBitrate()
            // Without figures from the server yet, the take has no cap, as on the web.
            let cap = (try? await store.meta(.storage, as: StorageFigures.self))??.maxFileBytes
            try await commands.beginCapture(
                recordingID, fileName: CaptureFiles.captureName(recordingID), tuneID: tuneID, recordedAt: .now)
            if abandoned { return await backOut(recordingID) }
            let writer = try CaptureWriter(url: finisher.captureURL(recordingID), bitrate: bitrate)
            capture = (recordingID, writer)
            do {
                try await input.start(
                    writer: writer,
                    onLevels: { [weak self] levels in self?.received(levels) },
                    onEvent: { [weak self] event in self?.handle(event) })
            } catch {
                await backOut(recordingID)
                errorMessage = Self.microphoneFailed
                return
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

    /// Goes on recording into the same take after an interruption.
    public func resume() async {
        guard state == .paused, resumeAvailable, !isResuming else { return }
        isResuming = true
        defer { isResuming = false }
        do {
            try await input.resume()
            // A stop while the microphone restarted has already ended the take.
            guard state == .paused else { return }
            resumeAvailable = false
            state = .recording
        } catch {
            // A stop while the microphone restarted has already ended the take.
            guard state == .paused else { return }
            errorMessage = Self.microphoneFailed
        }
    }

    /// Stops and saves the take. Returns the saved recording's ID, or nil when there was
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
        await release(capture.writer)
        defer { reset(recordingID) }
        do {
            guard try await CaptureFinisher(store: store).finish(recordingID) else {
                errorMessage = Self.nothingRecorded
                return nil
            }
            savedRecordingID = recordingID
            errorMessage = endedEarly
            return recordingID
        } catch {
            errorMessage = Self.saveFailed
            return nil
        }
    }

    /// Stops and throws the take away, writing no recording. A discard while the start is
    /// still under way backs the start out.
    public func discard() async {
        if isStarting {
            abandoned = true
            return
        }
        guard let capture, state == .recording || state == .paused else { return }
        let recordingID = capture.id
        state = .finishing
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
        await input.stop()
        capture?.writer.close()
        capture = nil
        try? await CaptureFinisher(store: store).discard(recordingID)
        Self.active.remove(recordingID)
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
        if let sizeCap, capture.writer.bytesWritten >= sizeCap {
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
            // Whatever reached the file is still the take, so it is kept as Stop would.
            endedEarly = Self.partialSave
            Task { await stop() }
        }
    }
}
