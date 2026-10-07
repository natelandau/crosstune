import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneVocabulary
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

/// What a capture recovery could not save shows in its row. The row answers a tap by asking to
/// delete it, since there is nothing else to do with it.
public struct UnfinishedCaptureRowContent: Hashable, Sendable {
    public static let note = "This recording could not be recovered."

    public let title: String
    /// What a tap on the row does, spoken before its title.
    public let verb = RecordingRowActions.delete

    public init(capture: RecordingFile, locale: Locale = .current, timeZone: TimeZone = .current) {
        let started = RecordingText.recordedDate(
            capture.recordedAt ?? capture.updatedAt, precision: .time, locale: locale, timeZone: timeZone)
        title = "\(RecordingText.recording), \(started)"
    }
}

/// Everything the recordings screen reads from the store in one go.
struct RecordingsSnapshot: Equatable, Sendable {
    var views: [RecordingView]
    /// The views in the same order, with what the list sorts and searches by worked out.
    var recordings: [ArrangeableRecording]
    /// Captures an earlier run left that recovery could not save, newest first.
    var unfinished: [RecordingFile]
}

/// The recordings screen's settings from the store's meta, read apart from the recordings so a
/// meta write never refetches every recording.
struct RecordingsSettings: Equatable, Sendable {
    var storage: StorageFigures?
    /// The stored origin choice: `all`, `own`, or an import source.
    var choice: String
}

/// The recordings screen's state: every live recording, captures left unfinished, the account's
/// storage, and the writes the screen makes. One model lives as long as the signed-in shell, so
/// the query lasts the app session, as the catalog's does.
@MainActor
@Observable
public final class RecordingsModel {
    nonisolated public static let deleteTitle = "Delete this recording?"
    nonisolated public static let deleteUnsyncedNote = "It has not been uploaded, so this cannot be undone."
    nonisolated public static let deleteSyncedNote = "It is removed from every device."

    nonisolated public static let allChoice = "all"

    /// Why the last write failed, until the next one.
    public private(set) var failure: String?
    /// A choice made here, shown before the store reports it back.
    private var chosen: String?
    /// What the search box holds.
    public var query = ""

    private let store: CrosstuneStore
    private let recordings: LiveQuery<RecordingsSnapshot?>
    private let settings: LiveQuery<RecordingsSettings?>
    @ObservationIgnored private var arranged: (key: ArrangementKey, arrangement: RecordingArrangement)?
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "recordings")

    public init(store: CrosstuneStore) {
        self.store = store
        recordings = LiveQuery(store, initial: nil, fetch: Self.fetch)
        settings = LiveQuery(store, initial: nil, fetch: Self.fetchSettings)
    }

    /// The recordings once the settings are read too, so the list never shows unfiltered first.
    private var snapshot: RecordingsSnapshot? {
        settings.value == nil ? nil : recordings.value
    }

    /// The live recording `id`, filtered out or not.
    func view(_ id: String) -> RecordingView? {
        snapshot?.views.first { $0.id == id }
    }

    /// What an arrangement was worked out from.
    private struct ArrangementKey: Equatable {
        let recordings: [ArrangeableRecording]
        let choice: String
        let query: String
        let sort: RecordingSortChoice
    }

    /// The recordings from the chosen source in the chosen order, narrowed by ``query``. Nil until
    /// the store is read, so an unread store never shows as having no recordings. Worked out again
    /// only when the recordings, the source, the query, or the order changes.
    public func arrangement(_ sort: RecordingSortChoice) -> RecordingArrangement? {
        guard let recordings = snapshot?.recordings else { return nil }
        let key = ArrangementKey(recordings: recordings, choice: choice, query: query, sort: sort)
        if let arranged, arranged.key == key { return arranged.arrangement }
        let arrangement = RecordingArrangement.arrange(shown(recordings), choice: sort, query: query)
        arranged = (key, arrangement)
        return arrangement
    }

    /// The list header's count of what `arrangement` shows, out of every live recording whatever
    /// the source or query.
    public func countLabel(_ arrangement: RecordingArrangement) -> String {
        RecordingsListText.countLabel(visible: arrangement.count, total: snapshot?.views.count ?? 0)
    }

    /// Whether the store holds no live recordings at all, whatever the source or query. False
    /// until the store is read.
    public var hasNoRecordings: Bool {
        snapshot?.views.isEmpty ?? false
    }

    /// Which recordings the screen lists: `all`, `own`, or an import source.
    public var choice: String { chosen ?? settings.value?.choice ?? Self.allChoice }

    /// The Source choices: All, Mine, then each import site the recordings come from in
    /// vocabulary order, plus a chosen site nothing is left from, so the list never narrows in
    /// silence.
    public var sourceOptions: [String] {
        let held = Set((snapshot?.views ?? []).map(\.recording.origin))
            .subtracting([RecordingText.ownOrigin])
        let stale = isStale && choice != RecordingText.ownOrigin ? [choice] : []
        return [Self.allChoice, RecordingText.ownOrigin] + Self.sortedOrigins(Array(held.union(stale)))
    }

    /// How many filters are set: the source, unless it is All.
    public var filterCount: Int { choice == Self.allChoice ? 0 : 1 }

    /// Whether the screen shows its Filters control: once the store is read, while an import
    /// gives the sources something to tell apart, or while a set source needs its way back to All.
    var showsFilters: Bool {
        guard let views = snapshot?.views else { return false }
        return filterCount > 0 || views.contains { $0.recording.origin != RecordingText.ownOrigin }
    }

    /// Whether the captures never saved show. They are the musician's own and have no label or
    /// tune for a search to match, so a query or an import site hides them.
    public var showsUnfinished: Bool {
        let searching = !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return !searching && (choice == Self.allChoice || choice == RecordingText.ownOrigin) && !unfinished.isEmpty
    }

    /// Whether recordings or unsaved captures exist but the source, the search, or both leave
    /// nothing on screen.
    public func showsNothingMatches(_ arrangement: RecordingArrangement?) -> Bool {
        guard let arrangement, !(hasNoRecordings && unfinished.isEmpty) else { return false }
        return arrangement.isEmpty && !showsUnfinished
    }

    private var isStale: Bool {
        let choice = choice
        guard choice != Self.allChoice, let views = snapshot?.views else { return false }
        return !views.contains { $0.recording.origin == choice }
    }

    private func shown(_ recordings: [ArrangeableRecording]) -> [ArrangeableRecording] {
        let choice = choice
        return choice == Self.allChoice ? recordings : recordings.filter { $0.view.recording.origin == choice }
    }

    /// Vocabulary order, then alphabetical; an origin this build predates sorts last.
    nonisolated public static func sortedOrigins(_ origins: [String]) -> [String] {
        let rank = { (origin: String) in
            Vocabulary.recordingOrigins.firstIndex(of: origin) ?? Vocabulary.recordingOrigins.count
        }
        return origins.sorted {
            rank($0) != rank($1) ? rank($0) < rank($1) : $0.localizedStandardCompare($1) == .orderedAscending
        }
    }

    /// Lists every recording again, whatever the source.
    public func resetSource() async {
        await setChoice(Self.allChoice)
    }

    /// Lists one source's recordings, or all of them, and keeps the choice on this device.
    public func setChoice(_ next: String) async {
        let previous = chosen
        chosen = next
        failure = nil
        do {
            try await store.setMeta(.recordingsOrigin, to: next)
        } catch {
            chosen = previous
            report(error)
        }
    }

    /// Captures recovery could not save. A capture this app is recording right now is not one.
    public var unfinished: [RecordingFile] {
        (snapshot?.unfinished ?? []).filter { !Recorder.isRecording($0.id) }
    }

    /// The account's storage, once the server has said what its quota is.
    public var storage: StorageFigures? {
        guard let storage = settings.value?.storage, storage.quotaBytes > 0 else { return nil }
        return storage
    }

    /// What a delete costs: a recording the server has never seen exists only on this device.
    nonisolated public static func deleteMessage(_ view: RecordingView) -> String {
        let notUploaded = view.file?.localState.isNotUploaded ?? false
        return view.recording.state == "pending_upload" && notUploaded ? deleteUnsyncedNote : deleteSyncedNote
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
            views: views, recordings: views.map(ArrangeableRecording.init), unfinished: unfinished)
    }

    nonisolated static func fetchSettings(_ db: Database) throws -> RecordingsSettings {
        RecordingsSettings(
            storage: try? MetaKey.storage.value(in: db, as: StorageFigures.self),
            // An unreadable choice reads as All, so a damaged setting never blanks the screen.
            choice: storedChoice(db))
    }

    nonisolated private static func storedChoice(_ db: Database) -> String {
        guard let stored = try? MetaKey.recordingsOrigin.value(in: db, as: String.self), !stored.isEmpty
        else { return allChoice }
        return stored
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

    /// Adds audio files picked or dropped from the device as unfiled recordings, each in turn,
    /// so one refusal never costs the rest of the batch. Keeps the first refusal, named for its
    /// file when there were several.
    public func importAudio(from urls: [URL]) async {
        failure = nil
        var refusal: String?
        for url in urls {
            do {
                try await RecordingImport.add(url, to: store, tuneID: nil)
            } catch {
                Self.logger.warning("An audio import failed: \(error)")
                let message = failureMessage(error)
                refusal =
                    refusal ?? (urls.count > 1 ? RecordingImport.refused(url.lastPathComponent, message) : message)
            }
        }
        if let refusal { failure = refusal }
    }

    /// Drops a failure the musician has left the screen without dismissing, so it is not
    /// waiting when they return.
    public func clearFailure() {
        failure = nil
    }

    /// Keeps the failure of a write made elsewhere on this screen, such as a Retry.
    public func report(_ error: any Error) {
        Self.logger.warning("A recordings write failed: \(error)")
        failure = failureMessage(error)
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
