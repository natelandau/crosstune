import CrosstuneAPI
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneSync

/// Reads fixtures/sync-pull, which the web client's pull apply also reads. Each page goes
/// through the same wire decoding and store apply as a live pull.
@Suite struct SharedSyncPullCases {
    fileprivate static let cases: [SharedCase<SyncPageCaseInput, SyncPageCaseExpected>] = SharedCases.loadOrTrap(
        "sync-pull", platform: .apple, minimum: 9)

    @Test(arguments: cases)
    fileprivate func appliesLikeTheSharedCase(
        sharedCase: SharedCase<SyncPageCaseInput, SyncPageCaseExpected>
    ) async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let input = sharedCase.input
        let expected = sharedCase.expected
        let response = try JSONDecoder().decode(
            Components.Schemas.PullResponse.self, from: try input.page.responseBody())
        let page = try WireFormat.pullPage(response)
        try await store.write { writer in
            try SyncCaseDatabase.seed(input.local, in: writer)
            try writer.applyPullPage(rows: page.rows.map { ($0.table, $0.row) }, nextSince: page.nextSince)
            try SyncCaseDatabase.expectMatches(expected.local, in: writer)
        }
    }
}
