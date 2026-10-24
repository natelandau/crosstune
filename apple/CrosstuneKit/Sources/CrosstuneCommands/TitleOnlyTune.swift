import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import GRDB

/// The status and genre a new tune starts with, from the "New tunes" settings. Every other field
/// starts empty.
public struct NewTuneDefaults: Equatable, Sendable {
    public let status: String
    /// Trimmed, or nil when a new tune starts with no genre.
    public let genre: String?

    public init(_ settings: UserSettings?) {
        status = storedNewTuneStatus(settings)
        let genre = storedNewTuneGenre(settings)?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.genre = genre?.isEmpty == false ? genre : nil
    }
}

/// A tune made from its title alone.
public struct CreatedTune: Sendable {
    public let tuneID: String
    public let userTuneID: String
    /// The title as stored: trimmed and held to its limit.
    public let title: String
    public let defaults: NewTuneDefaults
    /// The recording as it stood before it was filed under the tune, or nil when none was.
    public let filedRecording: Recording?
    /// Why the list or the recording refused the tune, which was created all the same.
    public let filingError: (any Error)?

    public init(
        tuneID: String, userTuneID: String, title: String, defaults: NewTuneDefaults,
        filedRecording: Recording? = nil, filingError: (any Error)? = nil
    ) {
        self.tuneID = tuneID
        self.userTuneID = userTuneID
        self.title = title
        self.defaults = defaults
        self.filedRecording = filedRecording
        self.filingError = filingError
    }
}

/// The title a tune made from typed text is stored with. Trimmed before the cap, so the limit
/// counts the title's own text, and again after, so a cut at a space leaves none behind.
public func titleOnlyTitle(_ typed: String) -> String {
    String(typed.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Vocabulary.Limits.Tune.title))
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

/// Whether the musician has added anything to the tune beyond its title: a recording, link, or
/// scan, a place in a list, notes, or lyrics.
public func tuneHasWork(_ db: Database, tuneID: String) throws -> Bool {
    let live = Column("deleted_at") == nil
    let tuneRow = Column("tune_id") == tuneID
    if try Recording.filter(tuneRow && live).fetchCount(db) > 0 { return true }
    if try RecordingLink.filter(tuneRow && live).fetchCount(db) > 0 { return true }
    if try ScanRecord.filter(tuneRow && live).fetchCount(db) > 0 { return true }
    if let lyrics = try Tune.fetchOne(db, key: tuneID)?.lyrics, !isBlank(lyrics) { return true }
    let userTunes = try UserTune.filter(tuneRow && live).fetchAll(db)
    if userTunes.contains(where: { $0.notes.map(isBlank) == false }) { return true }
    return try ListItem.filter(userTunes.map(\.id).contains(Column("user_tune_id")) && live).fetchCount(db) > 0
}

/// Whether the tune is in the catalog: stored and not deleted.
public func isLiveTune(_ db: Database, tuneID: String) throws -> Bool {
    try Tune.fetchOne(db, key: tuneID).map { $0.deletedAt == nil } ?? false
}

/// What a delete that spares work did.
public enum UnworkedDelete: Sendable {
    case deleted
    /// The tune holds work, so it stays.
    case kept
    /// The tune was already deleted, here or elsewhere, so nothing was written.
    case gone
}

private func isBlank(_ text: String) -> Bool {
    text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}

extension StoreWriter {
    /// Creates a tune from its title, with the status and genre the settings row `settingsID`
    /// gives a new tune, read inside this write so they are never still loading.
    public func createTitleOnlyTune(
        title typed: String, settingsID: String, at time: Timestamp = .now
    ) throws -> CreatedTune {
        let defaults = NewTuneDefaults(try UserSettings.fetchOne(db, key: settingsID))
        let title = titleOnlyTitle(typed)
        let ids = try createTune(
            TuneInput(title: title, genre: defaults.genre), userTune: UserTuneInput(status: defaults.status), at: time)
        return CreatedTune(tuneID: ids.tuneID, userTuneID: ids.userTuneID, title: title, defaults: defaults)
    }

    /// Deletes the tune only while it holds no work, checked in the same transaction as the
    /// delete, so nothing added a moment before is taken with it.
    public func deleteTuneUnlessItHasWork(_ tuneID: String, at time: Timestamp = .now) throws -> UnworkedDelete {
        guard try isLiveTune(db, tuneID: tuneID) else { return .gone }
        guard try !tuneHasWork(db, tuneID: tuneID) else { return .kept }
        try tombstoneTune(tuneID, at: time)
        return .deleted
    }
}

extension Commands {
    /// Creates a tune from its title alone, then files it into `listID` and under `recordingID`.
    /// Each filing is its own write and is tried on its own; a refusal never undoes the tune,
    /// since a retry would create it twice, and the first one is returned in the result.
    public func createTitleOnly(
        title: String, listID: String? = nil, recordingID: String? = nil, at time: Timestamp = .now
    ) async throws -> CreatedTune {
        let settingsRow = settingsID(clerkUserID: store.userID)
        let created = try await store.write { writer in
            try writer.createTitleOnlyTune(title: title, settingsID: settingsRow, at: time)
        }
        var filingError: (any Error)?
        var filedRecording: Recording?
        if let listID {
            do {
                _ = try await addToList(listID, userTuneID: created.userTuneID, at: time)
            } catch {
                filingError = error
            }
        }
        if let recordingID {
            do {
                // Read inside the filing write, so the report classifies by the tune it leaves.
                filedRecording = try await store.write { writer in
                    let before = try Recording.fetchOne(writer.db, key: recordingID)
                    try writer.updateRecording(recordingID, tuneID: .value(created.tuneID), at: time)
                    return before
                }
            } catch {
                filingError = filingError ?? error
            }
        }
        return CreatedTune(
            tuneID: created.tuneID, userTuneID: created.userTuneID, title: created.title, defaults: created.defaults,
            filedRecording: filedRecording, filingError: filingError)
    }

    /// Whether the tune holds anything beyond its title; see ``tuneHasWork(_:tuneID:)``.
    public func tuneHasWork(tuneID: String) async throws -> Bool {
        try await store.read { db in try CrosstuneCommands.tuneHasWork(db, tuneID: tuneID) }
    }

    /// Deletes the tune only while it holds no work, its local files with it.
    public func deleteTuneUnlessItHasWork(_ tuneID: String, at time: Timestamp = .now) async throws
        -> UnworkedDelete
    {
        try await store.writeDroppingFiles { writer in try writer.deleteTuneUnlessItHasWork(tuneID, at: time) }
    }
}
