import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import Foundation
import GRDB
import Observation
import os

/// A live recording with what its row needs: its local file and the tune it is filed under.
public struct RecordingView: Identifiable, Hashable, Sendable {
    public let recording: Recording
    public let file: RecordingFile?
    /// The recording's tune while it still exists. Nil files the recording as unfiled, even when
    /// its `tuneID` still names a tune deleted elsewhere.
    public let tuneID: String?
    public let tuneTitle: String?

    public var id: String { recording.id }

    public init(recording: Recording, file: RecordingFile?, tuneID: String?, tuneTitle: String?) {
        self.recording = recording
        self.file = file
        self.tuneID = tuneID
        self.tuneTitle = tuneTitle
    }
}

/// The recordings screen's recordings under one heading: the unfiled ones, or one tune's.
public struct RecordingGroup: Identifiable, Hashable, Sendable {
    public static let unfiled = "Unfiled"

    /// The tune the group heads, nil for the unfiled group.
    public let tuneID: String?
    public let title: String
    public let views: [RecordingView]

    public var id: String { tuneID ?? "" }

    /// Unfiled recordings first, then one group per tune, in the order `views` meets them. Fed
    /// ``RecordingsModel/sorted(_:)``, each tune's group lands in order of its newest recording.
    public static func grouped(_ views: [RecordingView]) -> [RecordingGroup] {
        var order: [String?] = []
        var members: [String?: [RecordingView]] = [:]
        for view in views {
            if members[view.tuneID] == nil { order.append(view.tuneID) }
            members[view.tuneID, default: []].append(view)
        }
        return order.map { tuneID in
            let views = members[tuneID] ?? []
            return RecordingGroup(tuneID: tuneID, title: views.first?.tuneTitle ?? unfiled, views: views)
        }
    }
}

/// What a capture recovery could not save shows in its row. The row answers a tap by asking to
/// delete it, since there is nothing else to do with it.
public struct UnfinishedCaptureRowContent: Hashable, Sendable {
    public static let note = "This recording could not be recovered."

    public let title: String
    /// What a tap on the row does, spoken before its title.
    public let verb = RecordingRowActions.delete

    public init(capture: RecordingFile, locale: Locale = .current, timeZone: TimeZone = .current) {
        let started = RecordingText.recordedAt(
            capture.recordedAt ?? capture.updatedAt, locale: locale, timeZone: timeZone)
        title = "\(RecordingText.recording), \(started)"
    }
}

/// Everything the recordings screen reads from the store in one go.
struct RecordingsSnapshot: Equatable, Sendable {
    var views: [RecordingView]
    /// Captures an earlier run left that recovery could not save, newest first.
    var unfinished: [RecordingFile]
    var storage: StorageFigures?
}

/// The recordings screen's state: every live recording, grouped by tune with the unfiled ones
/// first, captures left unfinished, the account's storage, and the writes the screen makes.
@MainActor
@Observable
public final class RecordingsModel {
    nonisolated public static let deleteTitle = "Delete this recording?"
    nonisolated public static let deleteUnsyncedNote = "It has not been uploaded, so this cannot be undone."
    nonisolated public static let deleteSyncedNote = "It is removed from every device."

    /// Why the last write failed, until the next one.
    public private(set) var failure: String?

    private let store: CrosstuneStore
    private let snapshot: LiveQuery<RecordingsSnapshot?>
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "recordings")

    public init(store: CrosstuneStore) {
        self.store = store
        snapshot = LiveQuery(store, initial: nil, fetch: Self.fetch)
    }

    /// Nil until the store is read, so an unread store never shows as having no recordings.
    public var groups: [RecordingGroup]? {
        snapshot.value.map { RecordingGroup.grouped($0.views) }
    }

    /// Captures recovery could not save. A capture this app is recording right now is not one.
    public var unfinished: [RecordingFile] {
        (snapshot.value?.unfinished ?? []).filter { !Recorder.isRecording($0.id) }
    }

    /// The account's storage, once the server has said what its quota is.
    public var storage: StorageFigures? {
        guard let storage = snapshot.value?.storage, storage.quotaBytes > 0 else { return nil }
        return storage
    }

    /// What a delete costs: a recording the server has never seen exists only on this device.
    nonisolated public static func deleteMessage(_ view: RecordingView) -> String {
        let notUploaded = view.file?.localState.isNotUploaded ?? false
        return view.recording.state == "pending_upload" && notUploaded ? deleteUnsyncedNote : deleteSyncedNote
    }

    /// Live recordings, unfiled first, then newest first.
    nonisolated public static func sorted(_ views: [RecordingView]) -> [RecordingView] {
        views.sorted { a, b in
            if (a.tuneID == nil) != (b.tuneID == nil) { return a.tuneID == nil }
            return a.recording.recordedAt.milliseconds > b.recording.recordedAt.milliseconds
        }
    }

    nonisolated static func fetch(_ db: Database) throws -> RecordingsSnapshot {
        let live = try Recording.filter(Recording.CodingKeys.deletedAt == nil).fetchAll(db)
        let files = try RecordingFile.fetchAll(db)
        let filesByID = Dictionary(files.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let tuneIDs = Set(live.compactMap(\.tuneID))
        let tunes = try Tune.fetchAll(db, keys: tuneIDs).filter { $0.deletedAt == nil }
        let titles = Dictionary(tunes.map { ($0.id, $0.title) }, uniquingKeysWith: { first, _ in first })
        let views = live.map { recording in
            let tuneID = recording.tuneID.flatMap { titles[$0] == nil ? nil : $0 }
            return RecordingView(
                recording: recording, file: filesByID[recording.id], tuneID: tuneID,
                tuneTitle: tuneID.flatMap { titles[$0] })
        }
        let unfinished = files.filter { $0.localState == .capturing }
            .sorted { ($0.recordedAt?.milliseconds ?? 0) > ($1.recordedAt?.milliseconds ?? 0) }
        return RecordingsSnapshot(
            views: sorted(views), unfinished: unfinished,
            storage: try? MetaKey.storage.value(in: db, as: StorageFigures.self))
    }

    /// Deletes a recording and its audio on this device.
    public func delete(_ recordingID: String) async {
        await run { commands in try await commands.deleteRecording(recordingID) }
    }

    /// Takes a recording out of its tune, leaving it unfiled.
    public func removeFromTune(_ recordingID: String) async {
        await run { commands in try await commands.updateRecording(recordingID, tuneID: .value(nil)) }
    }

    /// Throws away a capture recovery could not save.
    public func discard(_ capture: RecordingFile) async {
        let store = store
        await run { _ in try await Recorder.discardUnfinishedCapture(capture.id, in: store) }
    }

    /// Adds an audio file picked from the device as an unfiled recording.
    public func importAudio(from url: URL) async {
        let store = store
        await run { _ in try await RecordingImport.add(url, to: store, tuneID: nil) }
    }

    /// Keeps the failure of a write made elsewhere on this screen, such as a Retry.
    public func report(_ error: any Error) {
        Self.logger.warning("A recordings write failed: \(error)")
        failure = ListModel.message(error)
    }

    /// Runs a write the screen started, keeping its failure's message to show.
    public func run(_ write: (CrosstuneCommands.Commands) async throws -> Void) async {
        failure = nil
        do {
            try await write(CrosstuneCommands.Commands(store: store))
        } catch {
            report(error)
        }
    }
}
