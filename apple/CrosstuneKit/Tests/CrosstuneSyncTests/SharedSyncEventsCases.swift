import CrosstuneAPI
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneSync

/// Reads fixtures/sync-events, which the web client's events apply also reads. Each page goes
/// through the same wire decoding and store apply as a live events pull.
@Suite struct SharedSyncEventsCases {
    fileprivate static let cases: [SharedCase<SyncPageCaseInput, SyncPageCaseExpected>] = SharedCases.loadOrTrap(
        "sync-events", platform: .apple, minimum: 3)

    @Test(arguments: cases)
    fileprivate func appliesLikeTheSharedCase(
        sharedCase: SharedCase<SyncPageCaseInput, SyncPageCaseExpected>
    ) async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let input = sharedCase.input
        let expected = sharedCase.expected
        let response = try JSONDecoder().decode(
            Components.Schemas.EventsResponse.self, from: try input.page.responseBody())
        let page = try WireFormat.eventsPage(response)
        try await store.write { writer in
            try SyncCaseDatabase.seed(input.local, in: writer)
            try writer.applyEventsPage(rows: page.rows.map { ($0.table, $0.row) }, nextSince: page.nextSince)
            try SyncCaseDatabase.expectMatches(expected.local, in: writer)
        }
    }
}
