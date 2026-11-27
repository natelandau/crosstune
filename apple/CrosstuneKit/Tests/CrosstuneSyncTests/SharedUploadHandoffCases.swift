import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneSync

private struct Input: Decodable, Sendable {
    struct Handoff: Decodable, Sendable {
        let expiresAt: String
        let attempts: Int
        let refused: Bool
        let putLanded: Bool

        enum CodingKeys: String, CodingKey {
            case expiresAt = "expires_at"
            case attempts, refused
            case putLanded = "put_landed"
        }
    }

    let check: String
    let handoff: Handoff?
    let now: String?
    let put: StepOutcome?
    let confirm: StepOutcome?
}

private struct Expected: Decodable, Sendable {
    let status: String?
    let result: String?
}

extension StepOutcome: Decodable {
    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let status = try? container.decode(Int.self) {
            self = .status(status)
            return
        }
        let name = try container.decode(String.self)
        switch name {
        case "network_error": self = .networkError
        case "skipped": self = .skipped
        default:
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Not a status, network_error, or skipped: \(name)")
        }
    }
}

/// Reads fixtures/upload-handoff, which the web client's service worker rules also read.
@Suite struct SharedUploadHandoffCases {
    fileprivate static let cases: [SharedCase<Input, Expected>] = SharedCases.loadOrTrap(
        "upload-handoff", platform: .apple, minimum: 17)

    @Test(arguments: cases)
    fileprivate func decidesLikeTheSharedCase(sharedCase: SharedCase<Input, Expected>) throws {
        let input = sharedCase.input
        switch input.check {
        case "status":
            let fields = try #require(input.handoff)
            let url = try #require(URL(string: "https://storage.example/upload"))
            let expiresAt = try #require(Timestamp(iso: fields.expiresAt))
            let nowText = try #require(input.now)
            let now = try #require(Timestamp(iso: nowText))
            let handoff = UploadHandoff(
                url: url, confirmToken: "token", contentType: "audio/mp4", expiresAt: expiresAt,
                attempts: fields.attempts, refused: fields.refused, putLanded: fields.putLanded)
            #expect(handoffStatus(handoff, now: now).rawValue == sharedCase.expected.status)
        case "attempt":
            let put = try #require(input.put)
            let confirm = try #require(input.confirm)
            let result = handoffAttemptResult(put: put, confirm: confirm)
            #expect(result.rawValue == sharedCase.expected.result)
        default:
            Issue.record("Unknown check \(input.check), expected status or attempt")
        }
    }
}
