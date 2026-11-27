import CrosstuneStore
import CrosstuneTestSupport
import Testing

private struct Input: Decodable, Sendable {
    let stored: String?
    let requested: String
}

private struct Expected: Decodable, Sendable {
    let stamped: String
}

/// Reads fixtures/write-timestamp, which the web client's write path also reads.
@Suite struct SharedWriteTimestampCases {
    fileprivate static let cases: [SharedCase<Input, Expected>] = SharedCases.loadOrTrap(
        "write-timestamp", platform: .apple, minimum: 6)

    @Test(arguments: cases)
    fileprivate func stampsLikeTheSharedCase(sharedCase: SharedCase<Input, Expected>) throws {
        let stored = try sharedCase.input.stored.map { try #require(Timestamp(iso: $0)) }
        let requested = try #require(Timestamp(iso: sharedCase.input.requested))
        let expected = try #require(Timestamp(iso: sharedCase.expected.stamped))
        #expect(requested.stamped(after: stored) == expected)
    }
}
