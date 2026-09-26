import CrosstuneCommands
import CrosstuneStore
import Foundation
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
    }

    /// Where a failed write reports: beside the control that made it.
    public enum Place: Equatable, Sendable {
        /// Above the rows: a status, archive, or delete.
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
    /// The last write failure, cleared by the next write.
    public private(set) var failure: Failure?

    private let store: CrosstuneStore
    private let detail: LiveQuery<TuneDetail??>
    private var deletingTitle: String?
    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "tune")

    public init(store: CrosstuneStore, tuneID: String) {
        self.store = store
        self.tuneID = tuneID
        let settingsRow = settingsID(clerkUserID: store.userID)
        detail = LiveQuery(store, initial: nil) { db in
            .some(try TuneDetail.fetch(db, tuneID: tuneID, settingsID: settingsRow))
        }
    }

    public var phase: Phase {
        if let deletingTitle { return .deleting(title: deletingTitle) }
        switch detail.value {
        case nil: return .loading
        case .some(nil): return .gone
        case .some(.some(let detail)): return .shown(detail)
        }
    }

    /// The tune as last read, or nil while loading, deleting, or gone.
    public var shown: TuneDetail? {
        if case .shown(let detail) = phase { return detail }
        return nil
    }

    /// Sets the tune's status. A required field, so the rail never asks to clear it. Pressing the
    /// status the tune already holds writes nothing, so it queues no push, but still clears an
    /// earlier write's failure, as any other press does.
    public func setStatus(_ status: String) async {
        guard let userTune = shown?.userTune else { return }
        guard userTune.status != status else {
            failure = nil
            return
        }
        let userTuneID = userTune.id
        await run(.screen) { try await $0.updateUserTune(userTuneID, patch: UserTunePatch(status: .value(status))) }
    }

    /// Archives the tune, or brings it back.
    public func setArchived(_ archived: Bool) async {
        guard let userTuneID = shown?.userTune.id else { return }
        await run(.screen) { try await $0.setArchived(userTuneID, archived: archived) }
    }

    /// Deletes the tune with its links, list entries, and recordings. True once the delete has
    /// landed, when the screen should leave.
    public func delete() async -> Bool {
        guard let title = shown?.tune.title, deletingTitle == nil else { return false }
        deletingTitle = title
        let tuneID = tuneID
        let deleted = await run(.screen) { try await $0.deleteTune(tuneID) }
        if !deleted { deletingTitle = nil }
        return deleted
    }

    /// Takes the tune out of one list.
    public func removeFromList(itemID: String) async {
        await run(.lists) { try await $0.removeFromList(itemID) }
    }

    /// Removes one of the tune's links.
    public func removeLink(_ linkID: String) async {
        await run(.media) { try await $0.removeLink(linkID) }
    }

    /// Runs something the screen starts but another part of the app owns, such as a recording's
    /// retry, reporting its failure under the media.
    public func runMediaAction(_ action: @MainActor () async throws -> Void) async {
        await run(.media) { _ in try await action() }
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
                message: (error as? LocalizedError)?.errorDescription ?? CatalogModel.actionFailed, place: place)
            return false
        }
    }

    /// The failure to show at `place`, if the last write failed there.
    public func failure(at place: Place) -> String? {
        failure?.place == place ? failure?.message : nil
    }
}
