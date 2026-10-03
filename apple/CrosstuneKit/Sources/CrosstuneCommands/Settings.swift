import CrosstuneStore
import CrosstuneVocabulary
import Foundation

// Every device derives the same id for a user's single settings row, so offline edits on two
// devices converge by last-write-wins instead of colliding.
private let settingsNamespace = UUID(uuidString: "5d1c0b8a-3e7f-4a92-9c64-2b8e1f0a7d33")!

/// The one settings row a Clerk user has. Deriving it from their id, rather than generating one
/// and syncing it, lets a second device write the same row before it has ever pulled it.
public func settingsID(clerkUserID: String) -> String {
    uuidV5(name: clerkUserID, namespace: settingsNamespace).uuidString.lowercased()
}

/// Known instruments in canonical order, then each unrecognized value once, in first-seen order.
private func normalizeInstruments(_ values: [String]) -> [String] {
    var seen = Set<String>()
    var unique: [String] = []
    for value in values where seen.insert(value).inserted { unique.append(value) }
    let known = Vocabulary.instruments.filter { unique.contains($0) }
    let unknown = unique.filter { !Vocabulary.instruments.contains($0) }
    return known + unknown
}

/// The instruments a settings row holds, deduplicated but otherwise in order, or nil when there
/// is no usable row.
private func storedInstruments(_ row: UserSettings?) -> [String]? {
    guard let row, row.deletedAt == nil else { return nil }
    var seen = Set<String>()
    return row.instruments.filter { seen.insert($0).inserted }
}

/// Every service a tune's recordings can be searched on: each provider but the generic link,
/// in the order the API groups results, services that play inline first. Every stored list and
/// summary follows this order, as the server and the web client do.
public let searchableProviders = [
    "apple_music", "tidal", "internet_archive", "youtube", "spotify", "bandcamp", "soundcloud",
]

/// Known services in ``searchableProviders`` order, then each unrecognized value once, so a
/// newer client's choice survives this one's writes. `other` is never kept.
private func normalizeSearchProviders(_ values: [String]) -> [String] {
    var seen = Set<String>()
    let unique = values.filter { $0 != "other" && seen.insert($0).inserted }
    return searchableProviders.filter(unique.contains) + unique.filter { !searchableProviders.contains($0) }
}

/// The services a settings row searches. No usable row means every service; an empty list
/// stays empty.
private func storedSearchProviders(_ row: UserSettings?) -> [String] {
    guard let row, row.deletedAt == nil else { return searchableProviders }
    return normalizeSearchProviders(row.searchProviders)
}

private func storedAudioQuality(_ row: UserSettings?) -> String {
    guard let row, Vocabulary.audioQualities.contains(row.audioQuality) else { return "standard" }
    return row.audioQuality
}

extension StoreWriter {
    /// Stores the settings row, keeping each of `instruments`, `audioQuality`, and
    /// `searchProviders` that is nil at its current value.
    private func writeSettings(
        id: String, existing: UserSettings?, instruments: [String]? = nil, audioQuality: String? = nil,
        searchProviders: [String]? = nil, at time: Timestamp = .now
    ) throws {
        try put(
            UserSettings(
                id: id, createdAt: existing?.createdAt ?? time, updatedAt: time, deletedAt: nil,
                serverSeq: existing?.serverSeq ?? 0, audioQuality: audioQuality ?? storedAudioQuality(existing),
                instruments: normalizeInstruments(instruments ?? storedInstruments(existing) ?? []),
                searchProviders: searchProviders ?? storedSearchProviders(existing),
                extra: existing?.extra ?? [:]),
            at: time)
    }

    /// Replaces the whole instrument list, in ``Vocabulary/instruments`` order with unrecognized
    /// values kept after it.
    public func setInstruments(clerkUserID: String, instruments: [String], at time: Timestamp = .now) throws {
        let id = settingsID(clerkUserID: clerkUserID)
        try writeSettings(id: id, existing: try UserSettings.fetchOne(db, key: id), instruments: instruments, at: time)
    }

    /// Turns one instrument on or off, computed from the row as read inside this call so a
    /// second toggle issued before the first settles still sees the first's write.
    public func toggleInstrumentSetting(
        clerkUserID: String, instrument: String, on: Bool, at time: Timestamp = .now
    ) throws {
        let id = settingsID(clerkUserID: clerkUserID)
        let existing = try UserSettings.fetchOne(db, key: id)
        var next = storedInstruments(existing) ?? []
        if on {
            if !next.contains(instrument) { next.append(instrument) }
        } else {
            next.removeAll { $0 == instrument }
        }
        try writeSettings(id: id, existing: existing, instruments: next, at: time)
    }

    public func setAudioQuality(clerkUserID: String, quality: String, at time: Timestamp = .now) throws {
        let id = settingsID(clerkUserID: clerkUserID)
        try writeSettings(id: id, existing: try UserSettings.fetchOne(db, key: id), audioQuality: quality, at: time)
    }

    /// Turns one searched service on or off, read inside this call like
    /// ``toggleInstrumentSetting(clerkUserID:instrument:on:at:)``. `other` is never stored.
    public func toggleSearchProvider(
        clerkUserID: String, provider: String, on: Bool, at time: Timestamp = .now
    ) throws {
        let id = settingsID(clerkUserID: clerkUserID)
        let existing = try UserSettings.fetchOne(db, key: id)
        var next = storedSearchProviders(existing)
        if on {
            next.append(provider)
        } else {
            next.removeAll { $0 == provider }
        }
        try writeSettings(id: id, existing: existing, searchProviders: normalizeSearchProviders(next), at: time)
    }
}

extension Commands {
    /// The bit rate a new recording captures at, from the signed-in user's audio quality.
    public func captureBitrate() async throws -> Int {
        let id = settingsID(clerkUserID: store.userID)
        let quality = try await store.read { db in storedAudioQuality(try UserSettings.fetchOne(db, key: id)) }
        return Vocabulary.audioBitrates[quality] ?? Vocabulary.audioBitrates["standard"]!
    }

    public func setInstruments(clerkUserID: String, instruments: [String], at time: Timestamp = .now) async throws {
        try await store.write { writer in
            try writer.setInstruments(clerkUserID: clerkUserID, instruments: instruments, at: time)
        }
    }

    public func toggleInstrumentSetting(
        clerkUserID: String, instrument: String, on: Bool, at time: Timestamp = .now
    ) async throws {
        try await store.write { writer in
            try writer.toggleInstrumentSetting(clerkUserID: clerkUserID, instrument: instrument, on: on, at: time)
        }
    }

    public func setAudioQuality(clerkUserID: String, quality: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in
            try writer.setAudioQuality(clerkUserID: clerkUserID, quality: quality, at: time)
        }
    }

    public func toggleSearchProvider(
        clerkUserID: String, provider: String, on: Bool, at time: Timestamp = .now
    ) async throws {
        try await store.write { writer in
            try writer.toggleSearchProvider(clerkUserID: clerkUserID, provider: provider, on: on, at: time)
        }
    }
}
