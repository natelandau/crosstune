import CrosstuneStore
import Foundation
import GRDB

/// What a screen gathers to attach a recording link to a tune.
public struct LinkInput: Sendable {
    public var url: String
    public var provider: String
    public var providerRef: String?
    public var title: String?
    public var artworkURL: String?
    public var label: String?

    public init(
        url: String, provider: String, providerRef: String? = nil, title: String? = nil,
        artworkURL: String? = nil, label: String? = nil
    ) {
        self.url = url
        self.provider = provider
        self.providerRef = providerRef
        self.title = title
        self.artworkURL = artworkURL
        self.label = label
    }
}

extension StoreWriter {
    /// Appends a link to a live tune's list, after its currently active links.
    @discardableResult
    public func addLink(tuneID: String, link: LinkInput, at time: Timestamp = .now) throws -> String {
        guard let tune = try Tune.fetchOne(db, key: tuneID), tune.deletedAt == nil else {
            throw CommandError.tuneNotFound
        }
        let active = try RecordingLink.filter(Column("tune_id") == tuneID).fetchAll(db).filter { $0.deletedAt == nil }
        let id = newID(at: time)
        try put(
            RecordingLink(
                id: id, createdAt: time, updatedAt: time, tuneID: tuneID,
                url: link.url.trimmingCharacters(in: .whitespacesAndNewlines), provider: link.provider,
                providerRef: link.providerRef, title: link.title, label: link.label,
                artworkURL: link.artworkURL, position: nextPosition(active)), at: time)
        return id
    }

    public func removeLink(_ linkID: String, at time: Timestamp = .now) throws {
        try tombstone(RecordingLink.self, id: linkID, at: time)
    }
}

extension Commands {
    /// Appends a link to a tune's list.
    @discardableResult
    public func addLink(tuneID: String, link: LinkInput, at time: Timestamp = .now) async throws -> String {
        try await store.write { writer in try writer.addLink(tuneID: tuneID, link: link, at: time) }
    }

    public func removeLink(_ linkID: String, at time: Timestamp = .now) async throws {
        try await store.write { writer in try writer.removeLink(linkID, at: time) }
    }
}
