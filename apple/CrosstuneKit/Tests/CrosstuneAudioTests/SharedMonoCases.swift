import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneAudio

private struct Input: Decodable, Sendable {
    let left: Double
    let right: Double
    let cross: Double
    let frames: Int
}

private struct Expected: Decodable, Sendable {
    let isMono: Bool

    enum CodingKeys: String, CodingKey {
        case isMono = "is_mono"
    }
}

/// Reads fixtures/mono, which the API's mono job also reads.
@Suite struct SharedMonoCases {
    fileprivate static let cases: [SharedCase<Input, Expected>] = SharedCases.loadOrTrap(
        "mono", platform: .apple, minimum: 10)

    @Test(arguments: cases)
    fileprivate func decidesLikeTheSharedCase(sharedCase: SharedCase<Input, Expected>) {
        let input = sharedCase.input
        let result = MonoDetector.isMono(left: input.left, right: input.right, cross: input.cross, frames: input.frames)

        #expect(result == sharedCase.expected.isMono)
    }
}
