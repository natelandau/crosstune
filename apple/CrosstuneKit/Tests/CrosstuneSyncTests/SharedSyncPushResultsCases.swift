import CrosstuneAPI
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import GRDB
import Testing

@testable import CrosstuneSync

struct PushResultsCaseInput: Decodable, Sendable {
    let local: SyncCaseLocalState
    let sent: [SharedCaseOutboxEntry]
    let results: [JSONObject]

    /// The results as the API's push response body, for the wire decoder to read.
    func responseBody() throws -> Data {
        try JSONEncoder().encode(["results": results])
    }
}

struct PushResultsCaseExpected: Decodable, Sendable {
    struct Invalid: Decodable, Hashable, Sendable {
        let table: String
        let id: String
        let reason: String?
    }

    let local: SyncCaseLocalState
    let invalid: [Invalid]
    let settled: Int
    let keptLocal: [String]

    enum CodingKeys: String, CodingKey {
        case local, invalid, settled
        case keptLocal = "kept_local"
    }
}

/// Reads fixtures/sync-push-results, which the web client's push apply also reads. The results
/// go through the same wire decoding and store apply as a live push.
@Suite struct SharedSyncPushResultsCases {
    fileprivate static let cases: [SharedCase<PushResultsCaseInput, PushResultsCaseExpected>] = SharedCases.loadOrTrap(
        "sync-push-results", platform: .apple, minimum: 11)

    @Test(arguments: cases)
    fileprivate func appliesLikeTheSharedCase(
        sharedCase: SharedCase<PushResultsCaseInput, PushResultsCaseExpected>
    ) async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let input = sharedCase.input
        let expected = sharedCase.expected
        // The API client reads dates with this transcoder, and a returned row carries typed dates.
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            try APIDateTranscoder().decode(try decoder.singleValueContainer().decode(String.self))
        }
        let response = try decoder.decode(Components.Schemas.PushResponse.self, from: try input.responseBody())
        let results = try WireFormat.pushResults(response)
        try await store.write { writer in
            try SyncCaseDatabase.seed(input.local, in: writer)
            let sent = try input.sent.map { try Self.withQueuedSeq($0, db: writer.db) }

            let (invalid, settled, keptLocal) = try writer.applyPushResults(sent: sent, results: results)

            let actualInvalid = invalid.map {
                PushResultsCaseExpected.Invalid(table: $0.table.rawValue, id: $0.id, reason: $0.reason)
            }
            #expect(actualInvalid == expected.invalid, "invalid")
            #expect(settled == expected.settled, "settled")
            #expect(keptLocal == expected.keptLocal, "kept_local")
            try SyncCaseDatabase.expectMatches(expected.local, in: writer)
        }
    }

    /// A sent entry carries the seq its row holds in the outbox, as a batch read from the queue does.
    private static func withQueuedSeq(_ entry: SharedCaseOutboxEntry, db: Database) throws -> OutboxEntry {
        typealias Column = OutboxEntry.CodingKeys
        let queued = try #require(
            try OutboxEntry.filter(Column.tableName == entry.table && Column.rowID == entry.rowID).fetchOne(db),
            "sent \(entry.table) \(entry.rowID) must be queued")
        var sent = queued
        sent.updatedAt = try #require(Timestamp(iso: entry.updatedAt), "updated_at \(entry.updatedAt)")
        sent.data = entry.data
        return sent
    }
}
