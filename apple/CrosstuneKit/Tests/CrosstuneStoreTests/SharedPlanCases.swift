import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

private struct Input: Decodable, Sendable {
    let row: JSONObject?
    let now: String
    let holdsRecordings: Bool

    enum CodingKeys: String, CodingKey {
        case row
        case now
        case holdsRecordings = "holds_recordings"
    }
}

private struct WirePlan: Decodable, Equatable, Sendable {
    let kind: String
    let source: String?
    let premiumEndsAt: Date?
    let trialStartsAt: Date?
    let trialEndsAt: Date?
    let quotaBytes: Int64?
    let autoRenews: Bool
    let paidSources: [String]
    let lapse: String?

    enum CodingKeys: String, CodingKey {
        case kind
        case source
        case premiumEndsAt = "premium_ends_at"
        case trialStartsAt = "trial_starts_at"
        case trialEndsAt = "trial_ends_at"
        case quotaBytes = "quota_bytes"
        case autoRenews = "auto_renews"
        case paidSources = "paid_sources"
        case lapse
    }

    init(_ plan: Plan) {
        kind =
            switch plan.kind {
            case .unknown: "unknown"
            case .premium: "premium"
            case .free: "free"
            }
        source = plan.source?.rawValue
        premiumEndsAt = plan.premiumEndsAt
        trialStartsAt = plan.trialStartsAt
        trialEndsAt = plan.trialEndsAt
        quotaBytes = plan.quotaBytes
        autoRenews = plan.autoRenews
        paidSources = plan.paidSources.map(\.rawValue)
        lapse =
            switch plan.lapse {
            case .paid: "paid"
            case .trial: "trial"
            case nil: nil
            }
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        func instant(_ key: CodingKeys) throws -> Date? {
            guard let text = try container.decodeIfPresent(String.self, forKey: key) else { return nil }
            guard let timestamp = Timestamp(iso: text) else {
                throw DecodingError.dataCorruptedError(
                    forKey: key, in: container, debugDescription: "\(text) is not an ISO 8601 timestamp")
            }
            return timestamp.date
        }
        kind = try container.decode(String.self, forKey: .kind)
        source = try container.decodeIfPresent(String.self, forKey: .source)
        premiumEndsAt = try instant(.premiumEndsAt)
        trialStartsAt = try instant(.trialStartsAt)
        trialEndsAt = try instant(.trialEndsAt)
        quotaBytes = try container.decodeIfPresent(Int64.self, forKey: .quotaBytes)
        autoRenews = try container.decode(Bool.self, forKey: .autoRenews)
        paidSources = try container.decode([String].self, forKey: .paidSources)
        lapse = try container.decodeIfPresent(String.self, forKey: .lapse)
    }
}

private struct Expected: Decodable, Sendable {
    let plan: WirePlan
    let dueNotice: String?
    let nextChange: String?

    enum CodingKeys: String, CodingKey {
        case plan
        case dueNotice = "due_notice"
        case nextChange = "next_change"
    }
}

/// Reads fixtures/plan, which the web client's plan rules also read.
@Suite struct SharedPlanCases {
    fileprivate static let cases: [SharedCase<Input, Expected>] = SharedCases.loadOrTrap(
        "plan", platform: .apple, minimum: 20)

    @Test(arguments: cases)
    fileprivate func judgesLikeTheSharedCase(sharedCase: SharedCase<Input, Expected>) throws {
        let input = sharedCase.input
        let expected = sharedCase.expected
        let row = try input.row.map(Entitlement.init(wire:))
        let now = try #require(Timestamp(iso: input.now), "now \(input.now)").date
        let nextChange = try expected.nextChange.map { try #require(Timestamp(iso: $0), "next_change \($0)").date }

        #expect(WirePlan(Plan.from(row, now: now)) == expected.plan)
        #expect(
            PlanRules.dueNotice(row, now: now, holdsRecordings: input.holdsRecordings)?.rawValue
                == expected.dueNotice)
        #expect(PlanRules.nextChange(row, now: now) == nextChange)
    }
}
