import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import Foundation
import GRDB
import Observation
import os

/// One fact's change to a tune, applied to the form's values as the store holds them when the
/// write runs.
public typealias FactPatch = @Sendable (inout TuneFormValues) -> Void

/// The tune screen's state: the live tune with its media and lists, and the writes the screen
/// makes against it.
@MainActor
@Observable
public final class TuneModel {
    /// Where the screen stands with its tune.
    public enum Phase: Equatable {
        /// Nothing read yet, which the screen shows as silence.
        case loading
        case shown(TuneDetail)
        /// A confirmed delete is running, or has landed while the screen leaves. Holds the title,
        /// so the screen does not flash the tune as gone on its way out.
        case deleting(title: String)
        /// The tune is not in the catalog, or was deleted elsewhere.
        case gone

        var isShown: Bool {
            if case .shown = self { true } else { false }
        }
    }

    /// Where a failed write reports: beside the control that made it.
    public enum Place: Equatable, Sendable {
        /// Above the rows: an archive or delete.
        case screen
        /// Under the recordings and links.
        case media
        /// Under the lists.
        case lists
        /// Beside the tune's facts: a single-fact edit.
        case facts
        /// Under the notes field.
        case notes

        /// Whether writes here keep their failure apart from every other place's: notes write at
        /// typing speed, and a fact write must not clear another section's failure.
        var isField: Bool { self == .facts || self == .notes }
    }

    /// A failed write's message and where it shows.
    public struct Failure: Equatable, Sendable {
        public let message: String
        public let place: Place
    }

    public let tuneID: String
    /// The tune's scans and the writes the Scans section makes.
    public let scans: ScansModel
    /// The last write failure above the rows, under the media, or under the lists, cleared by the
    /// next write to any of those.
    public private(set) var failure: Failure?
    /// The last fact write's and notes write's failures, each cleared only by the next write to
    /// its own place.
    private var fieldFailures: [Place: String] = [:]

    private let store: CrosstuneStore
    private let analytics: AnalyticsClient
    private let detail: LiveQuery<TuneDetail??>
    private var deletingTitle: String?
    /// The last fact write or notes step queued. Each waits for the one before, so writes land in
    /// the order they were made and a notes session ends after its last keystroke has landed.
    private var factSteps: Task<Void, Never>?
    private var notesSessionOpen = false
    /// The stored notes when the open session began, or nil when they could not be read.
    private var notesAtSessionStart: String??
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "tune")

    public init(store: CrosstuneStore, tuneID: String, analytics: AnalyticsClient = .noop, plan: PlanModel? = nil) {
        self.store = store
        self.tuneID = tuneID
        self.analytics = analytics
        let settingsRow = settingsID(clerkUserID: store.userID)
        detail = LiveQuery(store, initial: nil) { db in
            .some(try TuneDetail.fetch(db, tuneID: tuneID, settingsID: settingsRow))
        }
        scans = ScansModel(store: store, tuneID: tuneID, analytics: analytics, plan: plan)
    }

    public var phase: Phase {
        if let deletingTitle { return .deleting(title: deletingTitle) }
        switch detail.value {
        case nil: return .loading
        case .some(nil): return .gone
        case .some(.some(let detail)): return .shown(detail)
        }
    }

    /// True once the tune's read has failed, which leaves the phase loading for good.
    public var readFailed: Bool { detail.error != nil }

    /// The tune as last read, or nil while loading, deleting, or gone.
    public var shown: TuneDetail? {
        if case .shown(let detail) = phase { return detail }
        return nil
    }

    /// Archives the tune, or brings it back.
    public func setArchived(_ archived: Bool) async {
        guard let userTuneID = shown?.userTune.id else { return }
        let landed = await run(.screen) { try await $0.setArchived(userTuneID, archived: archived) }
        if landed { analytics.send(archived ? .tuneArchived(tuneID: tuneID) : .tuneUnarchived(tuneID: tuneID)) }
    }

    /// Deletes the tune with its links, list entries, and recordings. True once the delete has
    /// landed, when the screen should leave.
    public func delete() async -> Bool {
        guard let title = shown?.tune.title, deletingTitle == nil else { return false }
        deletingTitle = title
        let tuneID = tuneID
        let counts = await Result { try await store.read { db in try Self.deletionCounts(db, tuneID: tuneID) } }
        let deleted = await run(.screen) { try await $0.deleteTune(tuneID) }
        if deleted {
            if let event = Self.deletedEvent(tuneID: tuneID, counts: counts) { analytics.send(event) }
        } else {
            deletingTitle = nil
        }
        return deleted
    }

    /// What a delete takes along: the tune's live recordings, links, and scans.
    typealias DeletionCounts = (recordings: Int, links: Int, scans: Int)

    /// The report of a landed delete, or nil when its counts were not read, since the plan
    /// requires them.
    static func deletedEvent(tuneID: String, counts: Result<DeletionCounts, any Error>) -> AnalyticsEvent? {
        switch counts {
        case .success(let counts):
            return .tuneDeleted(tuneID: tuneID, recordings: counts.recordings, links: counts.links, scans: counts.scans)
        case .failure(let error):
            logger.error("A deleted tune's counts were not read, so it is not reported: \(error)")
            return nil
        }
    }

    nonisolated private static func deletionCounts(_ db: Database, tuneID: String) throws -> DeletionCounts {
        (
            try Recording.filter(Recording.CodingKeys.tuneID == tuneID && Recording.CodingKeys.deletedAt == nil)
                .fetchCount(db),
            try RecordingLink.filter(
                RecordingLink.CodingKeys.tuneID == tuneID && RecordingLink.CodingKeys.deletedAt == nil
            ).fetchCount(db),
            try ScanRecord.filter(ScanRecord.CodingKeys.tuneID == tuneID && ScanRecord.CodingKeys.deletedAt == nil)
                .fetchCount(db)
        )
    }

    /// Takes the tune out of one list.
    public func removeFromList(itemID: String, listID: String) async {
        if await run(.lists, { try await $0.removeFromList(itemID) }) {
            analytics.send(.tunesRemovedFromList(listID: listID, count: 1))
        }
    }

    /// Removes one of the tune's links.
    public func removeLink(_ linkID: String) async {
        let link = shown?.links.first { $0.id == linkID }
        let removed = await run(.media) { try await $0.removeLink(linkID) }
        if removed, let link {
            analytics.send(.linkRemoved(service: LinkService(provider: link.provider), linkID: link.id))
        }
    }

    /// Saves a link's audio as one of the tune's recordings.
    public func addRecordingFromLink(_ linkID: String) async {
        let source = shown?.links.first { $0.id == linkID }.flatMap { ArchiveSource(rawValue: $0.provider) }
        var recordingID: String?
        let saved = await run(.media) { recordingID = try await $0.addRecordingFromLink(linkID) }
        if saved, let source, let recordingID {
            analytics.send(.archiveRecordingSaved(source: source, recordingID: recordingID, tuneID: tuneID))
        }
    }

    /// Takes one of the tune's recordings out of it, leaving it unfiled.
    public func unfileRecording(_ recording: Recording) async {
        let removed = await run(.media) { try await $0.updateRecording(recording.id, tuneID: .value(nil)) }
        if removed { analytics.recordingUnfiled(recording) }
    }

    /// Deletes one of the tune's recordings.
    public func deleteRecording(_ recording: Recording) async {
        let deleted = await run(.media) { try await $0.deleteRecording(recording.id) }
        if deleted { analytics.recordingDeleted(recording) }
    }

    /// Reports a link followed out to its provider's own site.
    public func reportOpened(_ link: RecordingLink) {
        analytics.linkOpened(link)
    }

    /// Pins a recording or link as the one lists play first for this tune, or clears the pin when
    /// `pinned` says it already is.
    public func setPlaySource(_ pin: PlaySourcePin, pinned: Bool) async {
        guard let userTuneID = shown?.userTune.id else { return }
        await run(.media) { try await $0.setPlaySource(userTuneID, to: pinned ? nil : pin) }
    }

    /// Runs something the screen starts but another part of the app owns, such as a recording's
    /// retry, reporting its failure under the media.
    public func runMediaAction(_ action: @MainActor () async throws -> Void) async {
        await run(.media) { _ in try await action() }
    }

    /// What a tap on the tune menu's Find recordings item does. Offline it does nothing, since the
    /// item shows its reason; a service's own search page opens through `open`, and why it could
    /// not shows under the media.
    public func chooseFindRecordings(
        _ entry: FindRecordingsEntry, tuneID: String, query: String, offline: Bool,
        search: FindRecordingsModel.Search?,
        openSheet: (@MainActor (_ tuneID: String, _ service: String?) -> Void)?,
        open: @MainActor (URL) -> Void
    ) async {
        guard !offline else { return }
        switch entry {
        case .sheet(let service): openSheet?(tuneID, service)
        case .searchPage(let provider):
            await runMediaAction {
                switch await FindRecordingsModel.searchPage(for: provider, query: query, search: search) {
                case .success(let url): open(url)
                case .failure(let reason): throw reason
                case nil: break
                }
            }
        }
    }

    /// Writes one fact to this tune under the tune form's rules: a type fills an unset time
    /// signature, a title never empties, and only a whole learned-on date saves. Reports the
    /// fields it changed once it lands, leaving notes typed in an open session to that session.
    public func write(_ change: @escaping FactPatch) {
        write(change, at: .facts)
    }

    /// Writes the notes as typed, reporting a refusal under the notes field.
    public func writeNotes(_ notes: String) {
        write({ $0.notes = notes }, at: .notes)
    }

    private func write(_ change: @escaping FactPatch, at place: Place) {
        let tuneID = tuneID
        let inNotesSession = notesSessionOpen
        enqueueFactStep { [self] in
            var landed: FactWrite?
            await run(place) { _ in
                landed = try await store.write { writer in try Self.applyFact(writer, tuneID: tuneID, change: change) }
            }
            guard let landed else { return }
            var after = landed.after
            if inNotesSession { after.notes = landed.before.notes }
            reportEdit(
                analytics: analytics, before: landed.before, after: after, storedTunings: landed.storedTunings,
                tuneID: tuneID)
        }
    }

    /// Opens or closes a notes editing session. Closing it reports the notes once, when they differ
    /// from where the session began.
    public func noteEditing(began: Bool) {
        guard began != notesSessionOpen else { return }
        notesSessionOpen = began
        let tuneID = tuneID
        enqueueFactStep { [self] in
            let notes = await storedNotes(tuneID)
            if began {
                notesAtSessionStart = notes
            } else if let notes, let start = notesAtSessionStart, notes != start {
                analytics.send(.tuneEdited(fieldsChanged: [.notes], tuneID: tuneID))
            }
        }
    }

    private func enqueueFactStep(_ step: @escaping @MainActor () async -> Void) {
        let previous = factSteps
        factSteps = Task {
            await previous?.value
            await step()
        }
    }

    /// The tune's stored notes, or nil when they could not be read.
    private func storedNotes(_ tuneID: String) async -> String?? {
        do {
            return try await store.read { db in try UserTune.live(tuneID: tuneID, in: db)?.notes }
        } catch {
            Self.logger.warning("A tune's notes could not be read: \(error)")
            return nil
        }
    }

    /// A landed fact write: the form's values before and after it, and the tunings it wrote over.
    private struct FactWrite: Sendable {
        let before: TuneFormValues
        let after: TuneFormValues
        let storedTunings: JSONObject
    }

    /// A fact write the form's rules refuse, in the form's own words.
    private struct FactRefusal: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// Reads the tune and applies `change` in the write's own transaction, so a keystroke or a
    /// sync pull that landed since the screen last read is never written over.
    nonisolated private static func applyFact(_ writer: StoreWriter, tuneID: String, change: FactPatch) throws
        -> FactWrite
    {
        guard let tune = try Tune.fetchOne(writer.db, key: tuneID), tune.deletedAt == nil,
            let userTune = try UserTune.live(tuneID: tuneID, in: writer.db)
        else { throw CommandError.tuneNotFound }
        let before = TuneFormValues(tune: tune, userTune: userTune)
        var after = before
        change(&after)
        if after.tuneType != before.tuneType {
            after.setType(after.tuneType)
        }
        guard !after.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw FactRefusal(message: TuneFormModel.titleRequired)
        }
        // Only a change that sets the date answers for it; a stored one is the form's to fix.
        if after.learnedOn != before.learnedOn, !after.learnedOn.isEmpty, CalendarDay.date(after.learnedOn) == nil {
            throw FactRefusal(message: LearnedOnEditor.incomplete)
        }
        let patches = after.patches(from: before, storedTunings: tune.tunings)
        try writer.updateTuneEntry(
            tuneID: tuneID, userTuneID: userTune.id, tune: patches.tune, userTune: patches.userTune)
        return FactWrite(before: before, after: after, storedTunings: tune.tunings)
    }

    /// Runs a write, keeping its failure's message for the screen to show at `place`. True
    /// when it landed.
    @discardableResult
    private func run(_ place: Place, _ write: (Commands) async throws -> Void) async -> Bool {
        if place.isField { fieldFailures[place] = nil } else { failure = nil }
        do {
            try await write(Commands(store: store))
            return true
        } catch {
            Self.logger.warning("A tune screen write failed: \(error)")
            let message = failureMessage(error)
            if place.isField {
                fieldFailures[place] = message
            } else {
                failure = Failure(message: message, place: place)
            }
            return false
        }
    }

    /// The failure to show at `place`, if the last write failed there.
    public func failure(at place: Place) -> String? {
        if place.isField { return fieldFailures[place] }
        return failure?.place == place ? failure?.message : nil
    }
}

extension TuneModel {
    /// Starts Find recordings for the tune, as the Recordings add menu and the start card both
    /// do: the sheet, or a service's own search page.
    func findRecordings(
        _ entry: FindRecordingsEntry, for detail: TuneDetail, offline: Bool, engine: SyncEngine?,
        openSheet: (@MainActor (_ tuneID: String, _ service: String?) -> Void)?,
        open: @escaping @MainActor (URL) -> Void
    ) {
        var search: FindRecordingsModel.Search?
        if let engine {
            search = { q, providers, country in
                await engine.searchRecordings(q: q, providers: providers, country: country)
            }
        }
        let tuneID = detail.tune.id
        let query = FindRecordingsSnapshot.prefill(detail.tune)
        Task {
            await chooseFindRecordings(
                entry, tuneID: tuneID, query: query, offline: offline, search: search, openSheet: openSheet, open: open)
        }
    }
}
