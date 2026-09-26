import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneSync

/// Puts a tune and its user tune in one transaction, as creating a tune does, so the outbox
/// holds one entry for each in that order.
@discardableResult
func createTune(_ store: CrosstuneStore, title: String, at time: Timestamp = noon) async throws -> Tune {
    let tune = Tune(createdAt: time, title: title)
    let userTune = UserTune(createdAt: time, tuneID: tune.id, status: "known")
    try await store.write { writer in
        try writer.put(tune, at: time)
        try writer.put(userTune, at: time)
    }
    return tune
}

func serverTune(id: String, title: String = "Server Tune", serverSeq: Int64) -> JSONObject {
    [
        "id": .string(id),
        "created_at": .string(noon.iso),
        "updated_at": .string(noon.iso),
        "deleted_at": .null,
        "server_seq": .integer(serverSeq),
        "owner_user_id": .string("server-user"),
        "title": .string(title),
        "modes": .array([]),
    ]
}

/// A server that answers from memory, recording every request.
@MainActor
final class FakeSyncAPI: SyncAPI {
    var pushes: [[Change]] = []
    var pulls: [Int64] = []
    var storageCalls = 0
    /// Thrown by every call while set.
    var failure: (any Error)?
    /// Thrown by the storage call alone while set.
    var storageFailure: (any Error)?
    var pullQueue: [PullPage] = []
    var figures = StorageFigures(usedBytes: 10, quotaBytes: 1_000, maxFileBytes: 100)
    var respondToPush: @MainActor ([Change]) async throws -> [PushResult] = { changes in
        changes.map { PushResult(table: $0.table, id: $0.id, status: .applied, row: FakeSyncAPI.echo($0)) }
    }
    /// Called at the start of every push, pull, and storage call.
    var onRequest: @MainActor () -> Void = {}
    private var serverSeq: Int64 = 0

    func push(_ changes: [Change]) async throws -> [PushResult] {
        onRequest()
        if let failure { throw failure }
        pushes.append(changes)
        return try await respondToPush(changes)
    }

    func pull(since: Int64) async throws -> PullPage {
        onRequest()
        if let failure { throw failure }
        pulls.append(since)
        return pullQueue.isEmpty ? PullPage(rows: [], nextSince: since, hasMore: false) : pullQueue.removeFirst()
    }

    func storage() async throws -> StorageFigures {
        onRequest()
        if let failure { throw failure }
        storageCalls += 1
        if let storageFailure { throw storageFailure }
        return figures
    }

    func resolveLink(url: String) async throws -> ResolvedLink {
        if let failure { throw failure }
        return ResolvedLink(provider: "other", url: url, title: "Resolved")
    }

    // MARK: Transfers

    /// Every transfer request in order, as `slot r1`, `put r1`, `confirm r1`, `url r1`, `get r1`,
    /// or `retry r1`.
    var transfers: [String] = []
    /// The size and type each slot request declared, by recording.
    var slotRequests: [String: (bytes: Int64, contentType: String)] = [:]
    /// What each PUT sent, by recording: the file's bytes and its type.
    var putBodies: [String: (data: Data, contentType: String)] = [:]
    /// Thrown by a transfer request, by its log entry (`slot r1`), while set.
    var transferFailures: [String: any Error] = [:]
    /// The bytes a GET writes.
    var objectData = Data("downloaded audio".utf8)
    /// Called with each transfer request's log entry before it is answered.
    var onTransfer: @MainActor (String) async -> Void = { _ in }

    private func transfer(_ entry: String) async throws {
        await onTransfer(entry)
        transfers.append(entry)
        if let failure = transferFailures[entry] { throw failure }
    }

    private static func recordingID(in url: URL) -> String { url.lastPathComponent }

    func requestUploadSlot(recordingID: String, bytes: Int64, contentType: String) async throws -> URL {
        slotRequests[recordingID] = (bytes, contentType)
        try await transfer("slot \(recordingID)")
        return URL(string: "https://bucket.test/put/\(recordingID)")!
    }

    func uploadFinished(recordingID: String) async throws {
        try await transfer("confirm \(recordingID)")
    }

    func downloadURL(recordingID: String) async throws -> URL {
        try await transfer("url \(recordingID)")
        return URL(string: "https://bucket.test/get/\(recordingID)")!
    }

    func retryRecording(recordingID: String) async throws {
        try await transfer("retry \(recordingID)")
    }

    func putObject(_ url: URL, file: URL, contentType: String) async throws {
        let id = Self.recordingID(in: url)
        try await transfer("put \(id)")
        putBodies[id] = (try Data(contentsOf: file), contentType)
    }

    func getObject(_ url: URL, to destination: URL) async throws {
        try await transfer("get \(Self.recordingID(in: url))")
        try objectData.write(to: destination)
    }

    /// The row the server stores for an upsert, as push returns it.
    static func echo(_ change: Change) -> JSONObject? {
        guard change.op == .upsert, var row = change.data else { return nil }
        row["id"] = .string(change.id)
        row["updated_at"] = .string(change.updatedAt.iso)
        row["deleted_at"] = .null
        row["server_seq"] = .integer(1)
        return row
    }
}

/// A sleeper the test releases by hand, recording every delay asked for.
@MainActor
final class ManualSleeper {
    private(set) var requested: [Duration] = []
    private var waiting: [(id: Int, duration: Duration, continuation: CheckedContinuation<Void, any Error>)] = []
    private var nextID = 0

    var pendingCount: Int { waiting.count }
    /// The delays still being waited out, oldest first.
    var pendingDurations: [Duration] { waiting.map(\.duration) }

    nonisolated var sleep: Sleeper {
        { [self] duration in try await wait(duration) }
    }

    /// Ends the oldest pending wait.
    func fire() {
        guard !waiting.isEmpty else { return }
        waiting.removeFirst().continuation.resume()
    }

    /// Ends the oldest pending wait for `duration`.
    func fire(_ duration: Duration) {
        guard let index = waiting.firstIndex(where: { $0.duration == duration }) else { return }
        waiting.remove(at: index).continuation.resume()
    }

    private func wait(_ duration: Duration) async throws {
        let id = nextID
        nextID += 1
        requested.append(duration)
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                waiting.append((id, duration, continuation))
            }
        } onCancel: {
            Task { @MainActor in self.cancel(id) }
        }
    }

    private func cancel(_ id: Int) {
        guard let index = waiting.firstIndex(where: { $0.id == id }) else { return }
        waiting.remove(at: index).continuation.resume(throwing: CancellationError())
    }
}

/// A flag a test flips while the engine holds a closure reading it.
@MainActor
final class Toggle {
    var isOn: Bool

    init(_ isOn: Bool) {
        self.isOn = isOn
    }
}

/// Counts calls from a closure the engine holds.
@MainActor
final class Counter {
    var count = 0
}

/// Waits for work on other tasks, such as a retry the sleeper released, to reach `condition`.
@MainActor
func waitUntil(
    _ condition: @MainActor () -> Bool, sourceLocation: SourceLocation = #_sourceLocation
) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("condition never held", sourceLocation: sourceLocation)
}
