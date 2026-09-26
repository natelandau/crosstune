import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import GRDB

/// Fields that describe many tunes at once; per-tune text such as titles and notes stays out.
public struct BulkTunePatch: Equatable, Sendable {
    public var genre: Patch<String?>
    public var lyrics: Patch<String?>
    public var key: Patch<String?>
    public var tuneType: Patch<String?>
    public var modes: Patch<[String]>
    public var composer: Patch<String?>
    public var partStructure: Patch<String?>
    public var timeSignature: Patch<String?>
    public var isCrooked: Patch<Bool>

    public init(
        genre: Patch<String?> = .keep, lyrics: Patch<String?> = .keep, key: Patch<String?> = .keep,
        tuneType: Patch<String?> = .keep, modes: Patch<[String]> = .keep, composer: Patch<String?> = .keep,
        partStructure: Patch<String?> = .keep, timeSignature: Patch<String?> = .keep, isCrooked: Patch<Bool> = .keep
    ) {
        self.genre = genre
        self.lyrics = lyrics
        self.key = key
        self.tuneType = tuneType
        self.modes = modes
        self.composer = composer
        self.partStructure = partStructure
        self.timeSignature = timeSignature
        self.isCrooked = isCrooked
    }
}

/// The user tune fields a bulk edit can set; per-tune text such as notes stays out.
public struct BulkUserTunePatch: Equatable, Sendable {
    public var status: Patch<String>
    public var learnedFrom: Patch<String?>
    public var learnedOn: Patch<String?>

    public init(status: Patch<String> = .keep, learnedFrom: Patch<String?> = .keep, learnedOn: Patch<String?> = .keep) {
        self.status = status
        self.learnedFrom = learnedFrom
        self.learnedOn = learnedOn
    }
}

/// A write across every selected tune: shared tune and user tune fields, plus a tuning per
/// instrument. `.value(nil)` clears a field or a tuning; an instrument left out of `tunings` is
/// untouched, and its capo and every other instrument's tuning are kept.
public struct BulkPatch: Equatable, Sendable {
    public var tune: BulkTunePatch
    public var userTune: BulkUserTunePatch
    public var tunings: [String: Patch<String?>]

    public init(
        tune: BulkTunePatch = BulkTunePatch(), userTune: BulkUserTunePatch = BulkUserTunePatch(),
        tunings: [String: Patch<String?>] = [:]
    ) {
        self.tune = tune
        self.userTune = userTune
        self.tunings = tunings
    }
}

/// The previous values of the fields a bulk write changed on one row, restorable with
/// ``StoreWriter/restoreFields(_:at:)``.
public enum Snapshot: Sendable {
    case tune(id: String, before: TunePatch)
    case userTune(id: String, before: UserTunePatch)
    case archivedAt(userTuneID: String, before: Timestamp?)
}

/// What ``StoreWriter/addTunesToList(listID:userTuneIDs:at:)`` added: how many tunes were new to
/// the list, and the item rows it created, which its own undo tombstones.
public struct AddedToList: Sendable {
    public let added: Int
    public let itemIDs: [String]
}

/// The ids in `ids`, each kept only the first time it appears.
private func unique(_ ids: [String]) -> [String] {
    var seen = Set<String>()
    return ids.filter { seen.insert($0).inserted }
}

/// Applies `patch` to `current` and records its old value in `before` when it actually changes.
@discardableResult
private func applyIfChanged<Value: Equatable>(
    _ patch: Patch<Value>, to current: inout Value, before: inout Patch<Value>
)
    -> Bool
{
    guard case .value(let newValue) = patch, newValue != current else { return false }
    before = .value(current)
    current = newValue
    return true
}

extension StoreWriter {
    /// Write back each snapshot's fields onto the row as it stands now, so edits made to other
    /// fields since the bulk write survive. A row deleted since is skipped.
    public func restoreFields(_ snapshots: [Snapshot], at time: Timestamp = .now) throws {
        for snapshot in snapshots {
            switch snapshot {
            case .tune(let id, let before):
                if let tune = try Tune.fetchOne(db, key: id), tune.deletedAt == nil {
                    try updateTune(id, patch: before, at: time)
                }
            case .userTune(let id, let before):
                if let userTune = try UserTune.fetchOne(db, key: id), userTune.deletedAt == nil {
                    try updateUserTune(id, patch: before, at: time)
                }
            case .archivedAt(let userTuneID, let before):
                if var userTune = try UserTune.fetchOne(db, key: userTuneID), userTune.deletedAt == nil {
                    userTune.archivedAt = before
                    try put(userTune, at: time)
                }
            }
        }
    }

    /// Applies `patch` to every selected tune and its user tune, skipping a field already at the
    /// requested value. Returns a snapshot of each field it actually changed, for undo.
    public func updateTunes(_ userTuneIDs: [String], patch: BulkPatch, at time: Timestamp = .now) throws -> [Snapshot] {
        var snapshots: [Snapshot] = []
        for userTuneID in unique(userTuneIDs) {
            guard var userTune = try UserTune.fetchOne(db, key: userTuneID), userTune.deletedAt == nil else {
                throw CommandError.tuneNotFound
            }
            guard var tune = try Tune.fetchOne(db, key: userTune.tuneID), tune.deletedAt == nil else {
                throw CommandError.tuneNotFound
            }

            var tuningsBefore: JSONObject?
            var tunings = tune.tunings
            for instrument in Vocabulary.instruments {
                guard case .value(let newTuning) = patch.tunings[instrument],
                    tuningEntry(tunings, instrument: instrument).tuning != newTuning
                else { continue }
                if tuningsBefore == nil { tuningsBefore = tune.tunings }
                tunings = setTuning(
                    tunings, instrument: instrument, tuning: newTuning,
                    capo: tuningEntry(tunings, instrument: instrument).capo)
            }

            var tuneBefore = TunePatch()
            let genreChanged = applyIfChanged(patch.tune.genre, to: &tune.genre, before: &tuneBefore.genre)
            let lyricsChanged = applyIfChanged(patch.tune.lyrics, to: &tune.lyrics, before: &tuneBefore.lyrics)
            let keyChanged = applyIfChanged(patch.tune.key, to: &tune.key, before: &tuneBefore.key)
            let tuneTypeChanged = applyIfChanged(patch.tune.tuneType, to: &tune.tuneType, before: &tuneBefore.tuneType)
            let modesChanged = applyIfChanged(patch.tune.modes, to: &tune.modes, before: &tuneBefore.modes)
            let composerChanged = applyIfChanged(patch.tune.composer, to: &tune.composer, before: &tuneBefore.composer)
            let partStructureChanged = applyIfChanged(
                patch.tune.partStructure, to: &tune.partStructure, before: &tuneBefore.partStructure)
            let timeSignatureChanged = applyIfChanged(
                patch.tune.timeSignature, to: &tune.timeSignature, before: &tuneBefore.timeSignature)
            let isCrookedChanged = applyIfChanged(
                patch.tune.isCrooked, to: &tune.isCrooked, before: &tuneBefore.isCrooked)
            if let tuningsBefore {
                tuneBefore.tunings = .value(tuningsBefore)
                tune.tunings = tunings
            }
            let tuneChanged =
                genreChanged || lyricsChanged || keyChanged || tuneTypeChanged || modesChanged || composerChanged
                || partStructureChanged || timeSignatureChanged || isCrookedChanged || tuningsBefore != nil
            if tuneChanged {
                snapshots.append(.tune(id: tune.id, before: tuneBefore))
                try put(tune, at: time)
            }

            var userTuneBefore = UserTunePatch()
            let statusChanged = applyIfChanged(
                patch.userTune.status, to: &userTune.status, before: &userTuneBefore.status)
            let learnedFromChanged = applyIfChanged(
                patch.userTune.learnedFrom, to: &userTune.learnedFrom, before: &userTuneBefore.learnedFrom)
            let learnedOnChanged = applyIfChanged(
                patch.userTune.learnedOn, to: &userTune.learnedOn, before: &userTuneBefore.learnedOn)
            if statusChanged || learnedFromChanged || learnedOnChanged {
                snapshots.append(.userTune(id: userTune.id, before: userTuneBefore))
                try put(userTune, at: time)
            }
        }
        return snapshots
    }

    /// Archives or unarchives every selected user tune, skipping one already at that state.
    /// Returns a snapshot of each one it actually changed, for undo.
    public func setArchivedMany(_ userTuneIDs: [String], archived: Bool, at time: Timestamp = .now) throws
        -> [Snapshot]
    {
        var snapshots: [Snapshot] = []
        for id in unique(userTuneIDs) {
            guard var userTune = try UserTune.fetchOne(db, key: id), userTune.deletedAt == nil else {
                throw CommandError.tuneNotFound
            }
            guard (userTune.archivedAt != nil) != archived else { continue }
            snapshots.append(.archivedAt(userTuneID: id, before: userTune.archivedAt))
            userTune.archivedAt = archived ? time : nil
            try put(userTune, at: time)
        }
        return snapshots
    }

    /// Deletes the tunes behind the given user tunes, each with its links, list entries, and
    /// recordings. Returns how many distinct tunes were deleted. There is no undo: a recording
    /// this takes with it is gone from every device.
    @discardableResult
    public func deleteTunes(_ userTuneIDs: [String], at time: Timestamp = .now) throws -> Int {
        var tuneIDs = Set<String>()
        for id in unique(userTuneIDs) {
            guard let userTune = try UserTune.fetchOne(db, key: id), userTune.deletedAt == nil else {
                throw CommandError.tuneNotFound
            }
            tuneIDs.insert(userTune.tuneID)
        }
        for tuneID in tuneIDs { try tombstoneTune(tuneID, at: time) }
        return tuneIDs.count
    }

    /// Appends the tunes missing from a list, in the order given, skipping ones already members.
    public func addTunesToList(listID: String, userTuneIDs: [String], at time: Timestamp = .now) throws
        -> AddedToList
    {
        guard let list = try TuneList.fetchOne(db, key: listID), list.deletedAt == nil else {
            throw CommandError.listNotFound
        }
        var items = try activeItems(listID: listID)
        var members = Set(items.map(\.userTuneID))
        var created: [String] = []
        for userTuneID in unique(userTuneIDs) {
            guard !members.contains(userTuneID) else { continue }
            guard let userTune = try UserTune.fetchOne(db, key: userTuneID), userTune.deletedAt == nil else {
                throw CommandError.tuneNotFound
            }
            let id = newID(at: time)
            let item = try put(
                ListItem(
                    id: id, createdAt: time, listID: listID, userTuneID: userTuneID, position: nextPosition(items)),
                at: time)
            items.append(item)
            members.insert(userTuneID)
            created.append(id)
        }
        return AddedToList(added: created.count, itemIDs: created)
    }

    /// Creates a list holding the given tunes. Undo is deleting the list.
    public func createListWithTunes(name: String, userTuneIDs: [String], at time: Timestamp = .now) throws -> String {
        let listID = try createList(name, at: time)
        _ = try addTunesToList(listID: listID, userTuneIDs: userTuneIDs, at: time)
        return listID
    }

    /// Removes the given list items. Returns the ids actually removed, for undo with
    /// ``restoreListItems(_:at:)``.
    @discardableResult
    public func removeTunesFromList(_ itemIDs: [String], at time: Timestamp = .now) throws -> [String] {
        var removed: [String] = []
        for id in unique(itemIDs) {
            guard let item = try ListItem.fetchOne(db, key: id), item.deletedAt == nil else {
                throw CommandError.tuneNotInList
            }
            try tombstone(ListItem.self, id: id, at: time)
            removed.append(id)
        }
        return removed
    }

    /// Puts the given list items back, skipping one whose list or tune is gone, or whose tune
    /// was added back to the list since. Restored items compete for their old position with
    /// whatever the list holds now; a restored item wins a tie.
    public func restoreListItems(_ itemIDs: [String], at time: Timestamp = .now) throws {
        guard !itemIDs.isEmpty else { return }
        var restorable: [ListItem] = []
        for id in itemIDs {
            guard let item = try ListItem.fetchOne(db, key: id), item.deletedAt != nil else { continue }
            guard let list = try TuneList.fetchOne(db, key: item.listID), list.deletedAt == nil else { continue }
            guard let userTune = try UserTune.fetchOne(db, key: item.userTuneID), userTune.deletedAt == nil else {
                continue
            }
            restorable.append(item)
        }

        var byList: [String: [ListItem]] = [:]
        for item in restorable { byList[item.listID, default: []].append(item) }

        for (listID, items) in byList {
            let active = try activeItems(listID: listID)
            let members = Set(active.map(\.userTuneID))
            let toRestore = items.filter { !members.contains($0.userTuneID) }
            guard !toRestore.isEmpty else { continue }

            let restoredIDs = Set(toRestore.map(\.id))
            var restored: [ListItem] = []
            for item in toRestore {
                var revived = item
                revived.deletedAt = nil
                restored.append(try put(revived, at: time))
            }

            let merged = (active + restored).sorted { a, b in
                a.position != b.position
                    ? a.position < b.position
                    : restoredIDs.contains(a.id) && !restoredIDs.contains(b.id)
            }
            try writeOrder(merged, at: time)
        }
    }
}

extension Commands {
    @discardableResult
    public func updateTunes(_ userTuneIDs: [String], patch: BulkPatch, at time: Timestamp = .now) async throws
        -> [Snapshot]
    {
        try await store.write { writer in try writer.updateTunes(userTuneIDs, patch: patch, at: time) }
    }

    @discardableResult
    public func setArchivedMany(_ userTuneIDs: [String], archived: Bool, at time: Timestamp = .now) async throws
        -> [Snapshot]
    {
        try await store.write { writer in try writer.setArchivedMany(userTuneIDs, archived: archived, at: time) }
    }

    @discardableResult
    public func deleteTunes(_ userTuneIDs: [String], at time: Timestamp = .now) async throws -> Int {
        try await store.writeDroppingAudio { writer in try writer.deleteTunes(userTuneIDs, at: time) }
    }

    @discardableResult
    public func addTunesToList(listID: String, userTuneIDs: [String], at time: Timestamp = .now) async throws
        -> AddedToList
    {
        try await store.write { writer in try writer.addTunesToList(listID: listID, userTuneIDs: userTuneIDs, at: time)
        }
    }

    public func createListWithTunes(name: String, userTuneIDs: [String], at time: Timestamp = .now) async throws
        -> String
    {
        try await store.write { writer in try writer.createListWithTunes(name: name, userTuneIDs: userTuneIDs, at: time)
        }
    }

    @discardableResult
    public func removeTunesFromList(_ itemIDs: [String], at time: Timestamp = .now) async throws -> [String] {
        try await store.write { writer in try writer.removeTunesFromList(itemIDs, at: time) }
    }

    public func restoreListItems(_ itemIDs: [String], at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.restoreListItems(itemIDs, at: time) }
    }

    public func restoreFields(_ snapshots: [Snapshot], at time: Timestamp = .now) async throws {
        guard !snapshots.isEmpty else { return }
        try await store.write { writer in try writer.restoreFields(snapshots, at: time) }
    }
}
