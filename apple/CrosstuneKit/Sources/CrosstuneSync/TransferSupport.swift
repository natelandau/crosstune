import CrosstuneAnalytics
import CrosstuneStore
import Foundation
import GRDB
import os

/// The problem type the API answers a slot request with when the recording would pass the
/// account's quota.
let quotaProblem = "urn:crosstune:quota-exceeded"
/// The problem type of a 403 refusing what only Premium may add, such as a recording's or a
/// scan's upload.
let premiumRequiredProblem = "urn:crosstune:premium-required"

/// The server refusing what the plan does not allow, which a subscription lifts. Never a session
/// problem.
func isPlanRefusal(_ error: any Error) -> Bool {
    guard let refusal = underlying(error) as? APIStatusError, refusal.status == 403 else { return false }
    return refusal.problemType == premiumRequiredProblem
}

/// The server refused an upload as Premium only, so every later upload in the pass would draw
/// the same refusal.
struct RefusedByPlan: Error {}

/// How many recordings the download pass fetches at once. Uploads stay one at a time.
let downloadConcurrency = 3

/// Runs `body` for each of `items`, at most ``downloadConcurrency`` at a time. The first error
/// starts no more, and is thrown once the bodies already under way have finished.
@MainActor
func forEachDownload<Item: Sendable>(
    _ items: [Item], _ body: @escaping @MainActor (Item) async throws -> Void
) async throws {
    let failure = DownloadFailure()
    try await withThrowingTaskGroup(of: Void.self) { group in
        var running = 0
        for item in items {
            if running == downloadConcurrency {
                try await group.next()
                running -= 1
            }
            // `next()` hands back results in the order they finished, so a failure can still be
            // queued behind a success when a slot frees.
            if failure.happened { break }
            group.addTask { try await failure.noting { try await body(item) } }
            running += 1
        }
        try await group.waitForAll()
    }
}

@MainActor
private final class DownloadFailure {
    private(set) var happened = false

    func noting(_ work: @MainActor () async throws -> Void) async throws {
        do {
            try await work()
        } catch {
            happened = true
            throw error
        }
    }
}

/// The first backoff after a transient upload failure, doubling with each one after it.
let uploadRetryBase: Duration = .seconds(30)
/// The longest an upload waits between tries, so a long outage still retries twice an hour.
let uploadRetryMax: Duration = .seconds(30 * 60)

/// How long a file that failed to upload `attempts` times in a row waits before the next try.
func uploadBackoff(attempts: Int) -> Duration {
    // Capped before the shift so a long streak cannot overflow.
    let factor = 1 << min(attempts, 16)
    return min(uploadRetryMax, uploadRetryBase * factor)
}

/// When a file that failed to upload `attempts` times in a row may next try, counted from `now`.
func nextUploadAttempt(attempts: Int, from now: Timestamp) -> Timestamp {
    Timestamp(milliseconds: now.milliseconds + uploadBackoff(attempts: attempts).components.seconds * 1000)
}

/// A refusal of the request itself, such as a bad type or a file too large, which never succeeds
/// as it is. An auth, timeout, or rate-limit refusal might on a retry.
func refusesTheRequestItself(_ refusal: APIStatusError) -> Bool {
    (400..<500).contains(refusal.status) && ![401, 403, 408, 429].contains(refusal.status)
}

/// A stop or a refused session: nothing past it can succeed in this run, so a pass ends at once
/// rather than holding it as one file's failure.
func endsThePass(_ error: any Error) -> Bool {
    error is RunStopped || isAuthFailure(error)
}

/// What ends a download pass: as ``endsThePass(_:)``, or no connection, which every later download
/// would meet too.
func endsTheDownloadPass(_ error: any Error) -> Bool {
    endsThePass(error) || underlying(error) is URLError
}

/// The size of a file on disk, in bytes.
func fileSize(_ url: URL) throws -> Int64 {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path(percentEncoded: false))
    return (attributes[.size] as? NSNumber)?.int64Value ?? 0
}

/// A value the server sent, such as an ID or a revision, refused as part of a local file name.
struct UnsafeFileNamePart: Error {
    // periphery:ignore - shown when the error is printed
    let value: String
}

/// `value` as part of a local file name. Only letters, digits, `-` and `_` pass, so no
/// server-sent value can name a path outside the folder the file goes in.
func fileNamePart(_ value: String) throws -> String {
    guard !value.isEmpty, value.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    else { throw UnsafeFileNamePart(value: value) }
    return value
}

/// The name a downloaded recording's file takes in the audio folder, tagged with the revision it
/// was downloaded for so a re-download after a trim writes a new file rather than overwriting one
/// a player may still hold open.
func downloadedFileName(_ recordingID: String, rev: String, contentType: String?) throws -> String {
    "\(try fileNamePart(recordingID))-\(try fileNamePart(rev)).\(playbackFileExtension(contentType))"
}

/// The name a fetched waveform takes in the audio folder, tagged with the revision it was
/// fetched for. A capture-time waveform (`CaptureFiles.peaksName`, never revisioned) is never
/// this shape, so the two can never collide or be mistaken for one another.
func peaksFileName(_ recordingID: String, rev: String) throws -> String {
    "\(try fileNamePart(recordingID))-\(try fileNamePart(rev)).peaks"
}

/// A downloaded audio file whose revision no longer matches the recording's current playback
/// file, as after a trim. A file never downloaded from the server (the raw capture or an import,
/// kept as is) has no revision of its own and is never stale.
func isStale(_ recording: Recording, _ file: RecordingFile) -> Bool {
    file.blobRev != nil && file.blobRev != recording.playbackRev
}

/// Why a file waiting to upload is stuck when its audio is no longer on this device.
let missingAudio = "The audio file is missing from this device."

extension RecordingOrigin {
    /// Where a recording came from. The archive it was saved from comes first, since a save
    /// from the archive is an import by source.
    public init(_ recording: Recording) {
        self =
            if recording.origin == "slippery_hill" {
                .slipperyHill
            } else if recording.source == "microphone" {
                .recorded
            } else {
                .imported
            }
    }
}

/// Why a transfer failed, as a recording's row shows it.
func transferMessage(_ error: any Error) -> String {
    switch underlying(error) {
    case let refusal as APIStatusError: refusal.message
    case let failure as TransferError: failure.message
    case let other: other.localizedDescription
    }
}
