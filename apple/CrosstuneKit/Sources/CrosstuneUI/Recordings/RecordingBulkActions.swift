import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneDesign
import CrosstuneStore
import Foundation
import Observation

/// The delete confirmation for selected recordings, read when Delete is pressed.
public struct RecordingBulkDeleteQuestion: Identifiable, Sendable {
    public let id = UUID()
    public let title: String
    public let message: String
    /// The recordings the musician selected, held ones included.
    public let views: [RecordingView]
    /// The selected recordings the delete keeps, since a piece split from each still plays from
    /// its audio.
    public let held: Set<String>

    /// The recordings the delete takes.
    public var deleting: [RecordingView] { Self.deleting(views, held: held) }

    /// The recordings among `views` that a delete takes, all but the `held` ones.
    nonisolated static func deleting(_ views: [RecordingView], held: Set<String>) -> [RecordingView] {
        views.filter { !held.contains($0.id) }
    }
}

/// What a selection of recordings can do to them: link them to a tune, with its undo in a banner
/// and through the system undo manager, or delete them after asking, with nothing to undo. A
/// failure keeps the selection, so the action can be tried again.
@MainActor
@Observable
public final class RecordingBulkActions: BulkActionRunner {
    /// The last failed action, cleared by the next.
    public internal(set) var failure: String?
    public internal(set) var isPending = false
    /// The last action's undo, for the banner.
    public var undoBannerItem: UndoBannerItem?
    /// The window's undo manager, which carries each action's undo for Command-Z, the Edit menu,
    /// and shake.
    @ObservationIgnored public weak var undoManager: UndoManager?

    let store: CrosstuneStore
    private let analytics: AnalyticsClient

    public init(store: CrosstuneStore, analytics: AnalyticsClient = .noop) {
        self.store = store
        self.analytics = analytics
    }

    /// Files every recording under `tuneID`, moving one filed under another tune. Undo puts each
    /// back on its earlier tune, or unfiled.
    public func link(_ views: [RecordingView], to tuneID: String, tuneTitle: String) async -> Bool {
        await run { commands in
            try await link(views, to: tuneID, tuneTitle: tuneTitle, with: commands)
        }
    }

    /// Makes a tune by `title` alone and links every recording to it. A link refused once the
    /// tune is made says so, and the tune stays.
    public func linkToNewTune(_ views: [RecordingView], title: String) async -> Bool {
        await run { commands in
            let created = try await commands.createTitleOnly(
                title: title, source: .recordingsList, analytics: analytics)
            return try await link(views, to: created.tuneID, tuneTitle: created.title, with: commands)
        }
    }

    private func link(
        _ views: [RecordingView], to tuneID: String, tuneTitle: String, with commands: Commands
    ) async throws -> BulkUndoable? {
        let ids = views.map(\.id)
        let earlier = try await commands.linkRecordings(ids, to: tuneID)
        for view in views where earlier[view.id] != nil {
            analytics.recordingFiled(view.recording, under: tuneID)
        }
        guard !earlier.isEmpty else { return nil }
        let moved = Array(earlier.keys)
        return BulkUndoable(
            message: RecordingsListText.linked(views.count, to: tuneTitle),
            actionName: RecordingsListText.linkToTune
        ) {
            try await $0.restoreRecordingTunes(earlier)
        } redo: {
            _ = try await $0.linkRecordings(moved, to: tuneID)
        }
    }

    /// Why Delete cannot be used on `views` now, or nil when it can: every one still holds the
    /// audio of a piece split from it, so the delete would take none.
    public static func deleteDisabledReason(_ views: [RecordingView]) -> String? {
        guard !views.isEmpty, views.allSatisfy(\.holdsSplitAudio) else { return nil }
        return RecordingScreenText.deleteWhileSplitting
    }

    /// The question to ask before deleting the recordings: how many go, what that costs, and
    /// how many stay because a piece split from them still plays from their audio. Read as it
    /// is asked, since it only has to be right for that moment.
    public func deleteQuestion(_ views: [RecordingView]) async -> RecordingBulkDeleteQuestion? {
        guard !views.isEmpty, !isPending else { return nil }
        let held: Set<String>
        do {
            held = try await Commands(store: store).recordingsHeldByDelete(views.map(\.id))
        } catch {
            BulkActions.logger.warning("Could not read the recordings a delete keeps: \(error)")
            failure = failureMessage(error)
            return nil
        }
        return RecordingBulkDeleteQuestion(
            title: RecordingsListText.deleteTitle(views.count),
            message: RecordingsListText.deleteMessage(views, held: held), views: views, held: held)
    }

    /// Deletes the recordings the question named, but those still splitting. There is nothing
    /// to undo.
    public func delete(_ question: RecordingBulkDeleteQuestion) async -> Bool {
        let views = question.views
        return await run { commands in
            let deleted = Set(try await commands.deleteRecordings(views.map(\.id)))
            for view in views where deleted.contains(view.id) {
                analytics.recordingDeleted(view.recording)
            }
            return nil
        }
    }
}
