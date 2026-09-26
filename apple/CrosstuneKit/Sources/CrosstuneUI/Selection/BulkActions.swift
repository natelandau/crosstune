import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import GRDB
import Observation
import os

/// The words of the actions a selection offers.
public enum BulkActionText {
    public static let status = TuneFieldLabels.status
    public static let setStatus = "Set status"
    public static let edit = TuneRowActions.edit
    @MainActor public static let addToList = TuneScreen.addToList
    public static let more = "More"

    /// The bulk edit sheet's title: "Edit 3 tunes".
    public static func editTitle(_ count: Int) -> String {
        "Edit \(CatalogSearch.tunes(count))"
    }

    /// "Archive 3 tunes" or "Unarchive 3 tunes".
    public static func archive(_ archived: Bool, count: Int) -> String {
        "\(TuneRowActions.archiveLabel(archived: !archived)) \(CatalogSearch.tunes(count))"
    }

    /// "Remove 3 from list".
    public static func remove(_ count: Int) -> String {
        "Remove \(count) from list"
    }

    /// "Delete 3 tunes".
    public static func delete(_ count: Int) -> String {
        "Delete \(CatalogSearch.tunes(count))"
    }

    // MARK: What happened, for the undo banner

    /// "Set 3 tunes to Known".
    public static func statusSet(_ status: String, count: Int) -> String {
        "Set \(CatalogSearch.tunes(count)) to \(StatusStyle.label(status))"
    }

    /// "Archived 3 tunes" or "Unarchived 3 tunes".
    public static func archived(_ archived: Bool, count: Int) -> String {
        "\(TuneRowActions.archiveLabel(archived: !archived))d \(CatalogSearch.tunes(count))"
    }

    /// "Removed 3 tunes from Tuesday session".
    public static func removed(_ count: Int, from list: String) -> String {
        "Removed \(CatalogSearch.tunes(count)) from \(list)"
    }

    /// "Edited 3 tunes".
    public static func edited(_ count: Int) -> String {
        "Edited \(CatalogSearch.tunes(count))"
    }

    /// "Added 3 tunes to Waltzes", or "Created Waltzes with 3 tunes" for a new list.
    public static func added(_ addition: ListAddition) -> String {
        addition.created
            ? "Created \(addition.listName) with \(CatalogSearch.tunes(addition.added))"
            : "Added \(CatalogSearch.tunes(addition.added)) to \(addition.listName)"
    }
}

/// The delete confirmation for a selection, read when Delete is pressed.
public struct BulkDeleteQuestion: Identifiable, Sendable {
    public let id = UUID()
    public let title: String
    public let message: String
    /// The user tunes the delete takes.
    public let userTuneIDs: [String]
}

/// What a selection can do to its tunes, and the one place each action is defined: what it
/// writes, what the banner says, and how it is undone. Every action but delete applies at once
/// and offers its undo in a banner and through the system undo manager; delete asks first and
/// offers nothing, because the recordings it takes cannot come back. A failure keeps the
/// selection, so the action can be tried again.
@MainActor
@Observable
public final class BulkActions {
    /// The last failed action outside the edit sheet, cleared by the next.
    public private(set) var failure: String?
    /// The last failed save of the edit sheet, which stays open with it.
    public private(set) var editFailure: String?
    public private(set) var isPending = false
    /// The last action's undo, for the banner.
    public var offer: UndoOffer?
    /// The window's undo manager, which carries each action's undo for Command-Z, the Edit menu,
    /// and shake.
    @ObservationIgnored public weak var undoManager: UndoManager?

    private let store: CrosstuneStore
    static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "bulk")

    public init(store: CrosstuneStore) {
        self.store = store
    }

    /// Sets every tune's status.
    public func setStatus(_ status: String, of entries: [CatalogEntry]) async -> Bool {
        let ids = entries.map(\.userTune.id)
        let patch = BulkPatch(userTune: BulkUserTunePatch(status: .value(status)))
        return await run { commands in
            let snapshots = try await commands.updateTunes(ids, patch: patch)
            return Undoable(
                message: BulkActionText.statusSet(status, count: ids.count), actionName: BulkActionText.setStatus
            ) {
                try await $0.restoreFields(snapshots)
            } redo: {
                try await $0.updateTunes(ids, patch: patch)
            }
        }
    }

    /// Archives or unarchives the tunes not already so.
    public func setArchived(_ archived: Bool, _ entries: [CatalogEntry]) async -> Bool {
        let ids = entries.filter { $0.isArchived != archived }.map(\.userTune.id)
        guard !ids.isEmpty else { return false }
        return await run { commands in
            let snapshots = try await commands.setArchivedMany(ids, archived: archived)
            return Undoable(
                message: BulkActionText.archived(archived, count: ids.count),
                actionName: BulkActionText.archive(archived, count: ids.count)
            ) {
                try await $0.restoreFields(snapshots)
            } redo: {
                try await $0.setArchivedMany(ids, archived: archived)
            }
        }
    }

    /// Takes list items out of the list named `listName`.
    public func remove(itemIDs: [String], from listName: String) async -> Bool {
        guard !itemIDs.isEmpty else { return false }
        return await run { commands in
            let removed = try await commands.removeTunesFromList(itemIDs)
            return Undoable(
                message: BulkActionText.removed(removed.count, from: listName),
                actionName: BulkActionText.remove(removed.count)
            ) {
                try await $0.restoreListItems(removed)
            } redo: {
                try await $0.removeTunesFromList(removed)
            }
        }
    }

    /// Writes the edit sheet's patch over every tune. On failure the reason is in
    /// ``editFailure``, for the sheet still holding the musician's work.
    public func edit(_ entries: [CatalogEntry], patch: BulkPatch) async -> Bool {
        editFailure = nil
        let ids = entries.map(\.userTune.id)
        return await run(failure: \.editFailure) { commands in
            let snapshots = try await commands.updateTunes(ids, patch: patch)
            return Undoable(
                message: BulkActionText.edited(ids.count), actionName: BulkActionText.editTitle(ids.count)
            ) {
                try await $0.restoreFields(snapshots)
            } redo: {
                try await $0.updateTunes(ids, patch: patch)
            }
        }
    }

    /// Clears a failed save's reason as the edit sheet opens.
    public func clearEditFailure() {
        editFailure = nil
    }

    /// Offers the undo of a pick the list picker made, which ran its own write so a failure could
    /// stay in the picker.
    public func added(_ addition: ListAddition) {
        failure = nil
        let current = LatestAddition(addition)
        offer(
            Undoable(message: BulkActionText.added(addition), actionName: BulkActionText.addToList) {
                try await current.value.undo(with: $0)
            } redo: {
                current.value = try await current.value.redo(with: $0)
            })
    }

    /// The question to ask before deleting the tunes, naming what goes with them. Read as it is
    /// asked, since it only has to be right for that moment.
    public func deleteQuestion(_ entries: [CatalogEntry]) async -> BulkDeleteQuestion? {
        guard !entries.isEmpty, !isPending else { return nil }
        let tuneIDs = Array(Set(entries.map(\.tune.id)))
        let files: [RecordingFile?]
        do {
            files = try await store.read { db in try Self.recordingFiles(db, tuneIDs: tuneIDs) }
        } catch {
            Self.logger.warning("Could not read the recordings a delete takes: \(error)")
            failure = ListModel.message(error)
            return nil
        }
        let only = entries.count == 1 ? entries.first : nil
        let subject = CatalogSearch.tunes(entries.count)
        return BulkDeleteQuestion(
            title: only == nil ? "\(BulkActionText.delete(entries.count))?" : DeleteTuneMessage.title,
            message: only.map { DeleteTuneMessage.one(title: $0.tune.title, files: files) }
                ?? DeleteTuneMessage.many(subject: subject, files: files),
            userTuneIDs: entries.map(\.userTune.id))
    }

    /// Deletes the tunes the question named. There is nothing to undo.
    public func delete(_ question: BulkDeleteQuestion) async -> Bool {
        let ids = question.userTuneIDs
        return await run { commands in
            try await commands.deleteTunes(ids)
            return nil
        }
    }

    /// Each live recording's local file for the tunes, nil where this device has none.
    nonisolated static func recordingFiles(_ db: Database, tuneIDs: [String]) throws -> [RecordingFile?] {
        let recordings = try Recording.filter(tuneIDs.contains(Recording.CodingKeys.tuneID))
            .filter(Recording.CodingKeys.deletedAt == nil).fetchAll(db)
        let files = try RecordingFile.fetchAll(db, keys: recordings.map(\.id))
        let byID = Dictionary(files.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return recordings.map { byID[$0.id] }
    }

    /// An action that landed: what the banner says, the undo menu's name for it, its undo, and
    /// the redo that makes it again.
    private struct Undoable {
        let message: String
        let actionName: String
        let undo: @MainActor (Commands) async throws -> Void
        let redo: @MainActor (Commands) async throws -> Void
    }

    private func run(
        failure keyPath: ReferenceWritableKeyPath<BulkActions, String?> = \.failure,
        _ write: (Commands) async throws -> Undoable?
    ) async -> Bool {
        guard !isPending else { return false }
        isPending = true
        failure = nil
        defer { isPending = false }
        do {
            if let undoable = try await write(Commands(store: store)) { offer(undoable) }
            return true
        } catch {
            Self.logger.warning("A bulk action failed: \(error)")
            self[keyPath: keyPath] = ListModel.message(error)
            return false
        }
    }

    /// Shows the banner and registers the same undo with the undo manager. Whichever is used
    /// first withdraws the other, so one action is never undone twice. The undo and redo writes
    /// hold only the store, so they still run after the screen that made this model has gone.
    private func offer(_ undoable: Undoable) {
        let chain = UndoChain()
        let manager = undoManager
        let store = store
        let failed: @MainActor (String) -> Void = { [weak self] message in self?.failure = message }
        let shown = UndoOffer(message: undoable.message) {
            manager?.removeAllActions(withTarget: chain)
            chain.run(undoable.undo, store: store, onFailure: failed)
        }
        Self.registerUndo(undoable, chain: chain, manager: manager, store: store, onFailure: failed) {
            [weak self] in
            if self?.offer?.id == shown.id { self?.offer = nil }
        }
        offer = shown
    }

    /// Registers the undo, which registers the redo as it runs, which registers the undo again,
    /// so the menu steps back and forth through the action.
    private static func registerUndo(
        _ undoable: Undoable, chain: UndoChain, manager: UndoManager?, store: CrosstuneStore,
        onFailure: @escaping @MainActor (String) -> Void, onUndo: @escaping @MainActor () -> Void = {}
    ) {
        manager?.registerUndo(withTarget: chain) { [weak manager] _ in
            MainActor.assumeIsolated {
                onUndo()
                chain.run(undoable.undo, store: store, onFailure: onFailure)
                manager?.registerUndo(withTarget: chain) { [weak manager] _ in
                    MainActor.assumeIsolated {
                        chain.run(undoable.redo, store: store, onFailure: onFailure)
                        registerUndo(undoable, chain: chain, manager: manager, store: store, onFailure: onFailure)
                    }
                }
                manager?.setActionName(undoable.actionName)
            }
        }
        manager?.setActionName(undoable.actionName)
    }
}

/// Runs one action's undos and redos one after another, in the order they were asked for, so a
/// quick undo then redo never lands out of order. The target the action is registered against,
/// so it can be withdrawn on its own. The undo manager does not retain a target, so the
/// registered handlers hold it.
@MainActor
private final class UndoChain {
    private var last: Task<Void, Never>?

    func run(
        _ step: @escaping @MainActor (Commands) async throws -> Void, store: CrosstuneStore,
        onFailure: @escaping @MainActor (String) -> Void
    ) {
        let previous = last
        last = Task { @MainActor in
            await previous?.value
            do {
                try await step(Commands(store: store))
            } catch {
                BulkActions.logger.warning("An undo or redo failed: \(error)")
                onFailure(ListModel.message(error))
            }
        }
    }
}

/// The list pick as it now stands, which a redo that makes the list again replaces.
@MainActor
private final class LatestAddition {
    var value: ListAddition

    init(_ value: ListAddition) {
        self.value = value
    }
}
