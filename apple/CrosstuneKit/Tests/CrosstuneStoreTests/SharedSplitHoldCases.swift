import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

private struct Input: Decodable, Sendable {
    let recordings: [JSONObject]
    let excludedPieceIDs: [String]

    enum CodingKeys: String, CodingKey {
        case recordings
        case excludedPieceIDs = "excluded_piece_ids"
    }
}

private struct Expected: Decodable, Sendable {
    let waitingParentIDs: [String]
    let heldParentIDs: [String]

    enum CodingKeys: String, CodingKey {
        case waitingParentIDs = "waiting_parent_ids"
        case heldParentIDs = "held_parent_ids"
    }
}

/// Reads fixtures/split-hold, which the web client's split hold rules also read.
@Suite struct SharedSplitHoldCases {
    fileprivate static let cases: [SharedCase<Input, Expected>] = SharedCases.loadOrTrap(
        "split-hold", platform: .apple, minimum: 6)

    @Test(arguments: cases)
    fileprivate func holdsLikeTheSharedCase(sharedCase: SharedCase<Input, Expected>) throws {
        let rows = try sharedCase.input.recordings.map(Recording.init(wire:))
        let waiting = RecordingLimits.waitingParentIDs(in: rows, excluding: Set(sharedCase.input.excludedPieceIDs))
        let held = rows.filter { RecordingLimits.holdsSplitAudio($0, waitingParentIDs: waiting) }.map(\.id)

        #expect(waiting.sorted() == sharedCase.expected.waitingParentIDs)
        #expect(held.sorted() == sharedCase.expected.heldParentIDs)
    }
}
