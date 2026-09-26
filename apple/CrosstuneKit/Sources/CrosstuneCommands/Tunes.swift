import CrosstuneStore
import Foundation
import GRDB

/// What a screen gathers to create a tune. Values match ``Tune``'s own fields; a field left at
/// its default is stored empty, exactly as an unfilled form control would be.
public struct TuneInput: Sendable {
    public var title: String
    public var alternateTitles: [String]
    public var genre: String?
    public var lyrics: String?
    public var key: String?
    public var tuneType: String?
    public var modes: [String]
    public var composer: String?
    public var tunings: JSONObject
    public var partStructure: String?
    public var timeSignature: String?
    public var isCrooked: Bool

    public init(
        title: String, alternateTitles: [String] = [], genre: String? = nil, lyrics: String? = nil,
        key: String? = nil, tuneType: String? = nil, modes: [String] = [], composer: String? = nil,
        tunings: JSONObject = [:], partStructure: String? = nil, timeSignature: String? = nil,
        isCrooked: Bool = false
    ) {
        self.title = title
        self.alternateTitles = alternateTitles
        self.genre = genre
        self.lyrics = lyrics
        self.key = key
        self.tuneType = tuneType
        self.modes = modes
        self.composer = composer
        self.tunings = tunings
        self.partStructure = partStructure
        self.timeSignature = timeSignature
        self.isCrooked = isCrooked
    }
}

/// What a screen gathers to create the signed-in musician's own row for a tune.
public struct UserTuneInput: Sendable {
    public var status: String
    public var learnedFrom: String?
    public var learnedOn: String?
    public var notes: String?

    public init(status: String, learnedFrom: String? = nil, learnedOn: String? = nil, notes: String? = nil) {
        self.status = status
        self.learnedFrom = learnedFrom
        self.learnedOn = learnedOn
        self.notes = notes
    }
}

/// A partial edit to a tune. Every field defaults to ``Patch/keep``, so a caller sets only what
/// changed.
public struct TunePatch: Sendable {
    public var title: Patch<String>
    public var alternateTitles: Patch<[String]>
    public var genre: Patch<String?>
    public var lyrics: Patch<String?>
    public var key: Patch<String?>
    public var tuneType: Patch<String?>
    public var modes: Patch<[String]>
    public var composer: Patch<String?>
    public var tunings: Patch<JSONObject>
    public var partStructure: Patch<String?>
    public var timeSignature: Patch<String?>
    public var isCrooked: Patch<Bool>

    public init(
        title: Patch<String> = .keep, alternateTitles: Patch<[String]> = .keep, genre: Patch<String?> = .keep,
        lyrics: Patch<String?> = .keep, key: Patch<String?> = .keep, tuneType: Patch<String?> = .keep,
        modes: Patch<[String]> = .keep, composer: Patch<String?> = .keep, tunings: Patch<JSONObject> = .keep,
        partStructure: Patch<String?> = .keep, timeSignature: Patch<String?> = .keep, isCrooked: Patch<Bool> = .keep
    ) {
        self.title = title
        self.alternateTitles = alternateTitles
        self.genre = genre
        self.lyrics = lyrics
        self.key = key
        self.tuneType = tuneType
        self.modes = modes
        self.composer = composer
        self.tunings = tunings
        self.partStructure = partStructure
        self.timeSignature = timeSignature
        self.isCrooked = isCrooked
    }

    /// Whether the patch keeps every field. A new field joins this check; `PatchEmptinessTests`
    /// fails until it does.
    public var isEmpty: Bool {
        title.isKeep && alternateTitles.isKeep && genre.isKeep && lyrics.isKeep && key.isKeep && tuneType.isKeep
            && modes.isKeep && composer.isKeep && tunings.isKeep && partStructure.isKeep && timeSignature.isKeep
            && isCrooked.isKeep
    }
}

/// A partial edit to a musician's own row for a tune.
public struct UserTunePatch: Sendable {
    public var status: Patch<String>
    public var learnedFrom: Patch<String?>
    public var learnedOn: Patch<String?>
    public var notes: Patch<String?>

    public init(
        status: Patch<String> = .keep, learnedFrom: Patch<String?> = .keep, learnedOn: Patch<String?> = .keep,
        notes: Patch<String?> = .keep
    ) {
        self.status = status
        self.learnedFrom = learnedFrom
        self.learnedOn = learnedOn
        self.notes = notes
    }

    /// Whether the patch keeps every field. A new field joins this check; `PatchEmptinessTests`
    /// fails until it does.
    public var isEmpty: Bool {
        status.isKeep && learnedFrom.isKeep && learnedOn.isKeep && notes.isKeep
    }
}

extension StoreWriter {
    /// Creates a tune and the caller's own row for it together, so neither exists without the
    /// other.
    @discardableResult
    public func createTune(
        _ tune: TuneInput, userTune: UserTuneInput, at time: Timestamp = .now
    ) throws -> (tuneID: String, userTuneID: String) {
        let title = tune.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { throw CommandError.tuneTitleRequired }
        let tuneID = newID(at: time)
        let userTuneID = newID(at: time)
        try put(
            Tune(
                id: tuneID, createdAt: time, updatedAt: time, title: title, alternateTitles: tune.alternateTitles,
                composer: tune.composer, genre: tune.genre, tuneType: tune.tuneType, key: tune.key,
                modes: tune.modes, timeSignature: tune.timeSignature, partStructure: tune.partStructure,
                isCrooked: tune.isCrooked, lyrics: tune.lyrics, tunings: tune.tunings), at: time)
        try put(
            UserTune(
                id: userTuneID, createdAt: time, updatedAt: time, tuneID: tuneID, status: userTune.status,
                learnedFrom: userTune.learnedFrom, learnedOn: userTune.learnedOn, notes: userTune.notes), at: time)
        return (tuneID, userTuneID)
    }

    /// Creates a tune and adds it to the end of a list. A list that has gone leaves the tune in
    /// the catalog alone, since the musician still asked for the tune.
    @discardableResult
    public func createTune(
        _ tune: TuneInput, userTune: UserTuneInput, inList listID: String, at time: Timestamp = .now
    ) throws -> (tuneID: String, userTuneID: String) {
        let created = try createTune(tune, userTune: userTune, at: time)
        do {
            try addToList(listID, userTuneID: created.userTuneID, at: time)
        } catch CommandError.listNotFound {
            // Refused before any write, so the tune's rows stand on their own.
        }
        return created
    }

    /// Applies `patch` to a live tune. Refuses a title that trims to nothing before touching the
    /// row, and refuses a missing or tombstoned tune.
    public func updateTune(_ tuneID: String, patch: TunePatch, at time: Timestamp = .now) throws {
        var trimmedTitle: String?
        if case .value(let title) = patch.title {
            let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { throw CommandError.tuneTitleRequired }
            trimmedTitle = trimmed
        }
        guard var tune = try Tune.fetchOne(db, key: tuneID), tune.deletedAt == nil else {
            throw CommandError.tuneNotFound
        }
        if let trimmedTitle { tune.title = trimmedTitle }
        tune.alternateTitles = patch.alternateTitles.resolved(from: tune.alternateTitles)
        tune.genre = patch.genre.resolved(from: tune.genre)
        tune.lyrics = patch.lyrics.resolved(from: tune.lyrics)
        tune.key = patch.key.resolved(from: tune.key)
        tune.tuneType = patch.tuneType.resolved(from: tune.tuneType)
        tune.modes = patch.modes.resolved(from: tune.modes)
        tune.composer = patch.composer.resolved(from: tune.composer)
        tune.tunings = patch.tunings.resolved(from: tune.tunings)
        tune.partStructure = patch.partStructure.resolved(from: tune.partStructure)
        tune.timeSignature = patch.timeSignature.resolved(from: tune.timeSignature)
        tune.isCrooked = patch.isCrooked.resolved(from: tune.isCrooked)
        try put(tune, at: time)
    }

    /// Applies `patch` to a live user tune. Refuses a missing or tombstoned row.
    public func updateUserTune(_ userTuneID: String, patch: UserTunePatch, at time: Timestamp = .now) throws {
        guard var userTune = try UserTune.fetchOne(db, key: userTuneID), userTune.deletedAt == nil else {
            throw CommandError.tuneNotFound
        }
        userTune.status = patch.status.resolved(from: userTune.status)
        userTune.learnedFrom = patch.learnedFrom.resolved(from: userTune.learnedFrom)
        userTune.learnedOn = patch.learnedOn.resolved(from: userTune.learnedOn)
        userTune.notes = patch.notes.resolved(from: userTune.notes)
        try put(userTune, at: time)
    }

    /// Saves an edit to a tune and the musician's own row for it, both or neither. A row whose
    /// patch keeps every field is left alone, so it queues no push.
    public func updateTuneEntry(
        tuneID: String, userTuneID: String, tune: TunePatch, userTune: UserTunePatch, at time: Timestamp = .now
    ) throws {
        if !tune.isEmpty { try updateTune(tuneID, patch: tune, at: time) }
        if !userTune.isEmpty { try updateUserTune(userTuneID, patch: userTune, at: time) }
    }

    /// Archives or unarchives a user tune through `archivedAt`.
    public func setArchived(_ userTuneID: String, archived: Bool, at time: Timestamp = .now) throws {
        guard var userTune = try UserTune.fetchOne(db, key: userTuneID), userTune.deletedAt == nil else {
            throw CommandError.tuneNotFound
        }
        userTune.archivedAt = archived ? time : nil
        try put(userTune, at: time)
    }

    /// Tombstones a tune and everything that hangs off it: its user tune, that user tune's list
    /// items, its recording links, and its recordings. Only the tune's own delete is queued; the
    /// rest ride along with it, as the server's own cascade does.
    public func tombstoneTune(_ tuneID: String, at time: Timestamp = .now) throws {
        try tombstone(Tune.self, id: tuneID, at: time)
        let userTunes = try UserTune.filter(Column("tune_id") == tuneID).fetchAll(db)
        for userTune in userTunes {
            let items = try ListItem.filter(Column("user_tune_id") == userTune.id).fetchAll(db)
            for item in items {
                try tombstone(ListItem.self, id: item.id, at: time, enqueueDelete: false)
            }
            try tombstone(UserTune.self, id: userTune.id, at: time, enqueueDelete: false)
        }
        let links = try RecordingLink.filter(Column("tune_id") == tuneID).fetchAll(db)
        for link in links {
            try tombstone(RecordingLink.self, id: link.id, at: time, enqueueDelete: false)
        }
        try tombstoneTuneRecordings(tuneID: tuneID, at: time)
    }

    /// Tombstones every recording linked to a tune and drops its local audio file entry. Called
    /// from a tune's own delete; a recording deleted on its own goes through its own command.
    public func tombstoneTuneRecordings(tuneID: String, at time: Timestamp = .now) throws {
        let recordings = try Recording.filter(Column("tune_id") == tuneID).fetchAll(db)
        for recording in recordings {
            try tombstone(Recording.self, id: recording.id, at: time, enqueueDelete: false)
            try RecordingFile.deleteOne(db, key: recording.id)
        }
    }
}

extension Commands {
    /// Creates a tune and the caller's own row for it together.
    @discardableResult
    public func createTune(
        _ tune: TuneInput, userTune: UserTuneInput, at time: Timestamp = .now
    ) async throws -> (tuneID: String, userTuneID: String) {
        try await store.write { writer in try writer.createTune(tune, userTune: userTune, at: time) }
    }

    /// Creates a tune and adds it to a list in one write; see
    /// ``StoreWriter/createTune(_:userTune:inList:at:)``.
    @discardableResult
    public func createTune(
        _ tune: TuneInput, userTune: UserTuneInput, inList listID: String, at time: Timestamp = .now
    ) async throws -> (tuneID: String, userTuneID: String) {
        try await store.write { writer in try writer.createTune(tune, userTune: userTune, inList: listID, at: time) }
    }

    public func updateTune(_ tuneID: String, patch: TunePatch, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.updateTune(tuneID, patch: patch, at: time) }
    }

    public func updateUserTune(_ userTuneID: String, patch: UserTunePatch, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.updateUserTune(userTuneID, patch: patch, at: time) }
    }

    /// Saves an edit to a tune and the musician's own row for it, both or neither.
    public func updateTuneEntry(
        tuneID: String, userTuneID: String, tune: TunePatch, userTune: UserTunePatch, at time: Timestamp = .now
    ) async throws {
        try await store.write { writer in
            try writer.updateTuneEntry(
                tuneID: tuneID, userTuneID: userTuneID, tune: tune, userTune: userTune, at: time)
        }
    }

    public func setArchived(_ userTuneID: String, archived: Bool, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.setArchived(userTuneID, archived: archived, at: time) }
    }

    /// Deletes a tune and everything that hangs off it, its recordings' audio on this device
    /// included.
    public func deleteTune(_ tuneID: String, at time: Timestamp = .now) async throws {
        try await store.writeDroppingAudio { writer in try writer.tombstoneTune(tuneID, at: time) }
    }
}
