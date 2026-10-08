import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import Foundation
import GRDB
import Observation
import os

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
    }

    /// A failed write's message and where it shows.
    public struct Failure: Equatable, Sendable {
        public let message: String
        public let place: Place
    }

    public let tuneID: String
    /// The tune's scans and the writes the Scans section makes.
    public let scans: ScansModel
    /// The last write failure, cleared by the next write.
    public private(set) var failure: Failure?

    private let store: CrosstuneStore
    private let analytics: AnalyticsClient
    private let detail: LiveQuery<TuneDetail??>
    private var deletingTitle: String?
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "tune")

    public init(store: CrosstuneStore, tuneID: String, analytics: AnalyticsClient = .noop) {
        self.store = store
        self.tuneID = tuneID
        self.analytics = analytics
        let settingsRow = settingsID(clerkUserID: store.userID)
        detail = LiveQuery(store, initial: nil) { db in
            .some(try TuneDetail.fetch(db, tuneID: tuneID, settingsID: settingsRow))
        }
        scans = ScansModel(store: store, tuneID: tuneID, analytics: analytics)
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

    /// Runs a write, keeping its failure's message for the screen to show at `place`. True
    /// when it landed.
    @discardableResult
    private func run(_ place: Place, _ write: (Commands) async throws -> Void) async -> Bool {
        failure = nil
        do {
            try await write(Commands(store: store))
            return true
        } catch {
            Self.logger.warning("A tune screen write failed: \(error)")
            failure = Failure(
                message: failureMessage(error), place: place)
            return false
        }
    }

    /// The failure to show at `place`, if the last write failed there.
    public func failure(at place: Place) -> String? {
        failure?.place == place ? failure?.message : nil
    }
}
