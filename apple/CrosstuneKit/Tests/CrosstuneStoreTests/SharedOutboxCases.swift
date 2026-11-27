import CrosstuneTestSupport
import Testing

@testable import CrosstuneStore

private struct Input: Decodable, Sendable {
    let outbox: [SharedCaseOutboxEntry]
    let enqueue: [SharedCaseOutboxEntry]
}

private struct Expected: Decodable, Sendable {
    let outbox: [SharedCaseOutboxEntry]
}

/// Reads fixtures/outbox, which the web client's outbox also reads.
@Suite struct SharedOutboxCases {
    fileprivate static let cases: [SharedCase<Input, Expected>] = SharedCases.loadOrTrap(
        "outbox", platform: .apple, minimum: 5)

    @Test(arguments: cases)
    fileprivate func queuesLikeTheSharedCase(sharedCase: SharedCase<Input, Expected>) async throws {
        let root = TemporaryRoot()
        let store = try root.open()
        let input = sharedCase.input
        let queued = try await store.write { writer in
            try SharedCaseOutboxEntry.enqueue(input.outbox + input.enqueue, in: writer.db)
            return try SharedCaseOutboxEntry.queued(in: writer.db)
        }
        #expect(queued == sharedCase.expected.outbox)
    }
}
