import Foundation
import GRDB

public enum PlanKind: Sendable, Equatable {
    /// No entitlements row is stored yet. Gates nothing: the server enforces, and a device that
    /// has not pulled must not show disabled rows.
    case unknown
    case premium
    case free
}

/// A one-time notice, named as `POST /v1/me/notices` names it.
public enum PlanNotice: String, Sendable, CaseIterable {
    case firstRecording = "first_recording"
    case trialReminder = "trial_reminder"
    case trialEnded = "trial_ended"
}

/// Where the live Premium grant came from, as the server names it.
public enum PlanSource: String, Sendable {
    case trial
    case apple
    case stripe
    case comp

    /// The billing providers, in the order the account's subscriptions are listed.
    public static let paid: [PlanSource] = [.apple, .stripe]
}

/// What the account may use at one instant, judged on the device from the stored entitlements
/// row and the device clock, so an offline device still turns free on time.
public struct Plan: Sendable, Equatable {
    public var kind: PlanKind
    /// The live grant's source; nil unless Premium, or when the server names a source this build
    /// does not know.
    public var source: PlanSource?
    /// The reported grant's expiry, before any leeway.
    public var premiumEndsAt: Date?
    public var trialStartsAt: Date?
    public var trialEndsAt: Date?
    /// The Premium quota; nil unless Premium, since a free account adds nothing the quota counts.
    public var quotaBytes: Int64?
    /// Whether the live Premium grant renews on its own; false unless Premium.
    public var autoRenews: Bool
    /// Every store still billing the account, the reported grant's included; empty unless
    /// Premium. A comp that outlasts a subscription is reported over it.
    public var paidSources: [PlanSource]

    /// Whether the account is on a Premium trial.
    public var isTrial: Bool { kind == .premium && source == .trial }

    /// Whether buying Premium makes sense: a free account, or one still on a trial. A grant that
    /// is paid, comped, or of unknown source is not replaced by a purchase.
    public var canSubscribe: Bool {
        switch kind {
        case .free: true
        case .premium: isTrial
        case .unknown: false
        }
    }

    public var recordingsPlay: Bool { kind != .free }
    /// Whether scans open, upload, and download.
    public var scansOpen: Bool { kind != .free }

    public init(
        kind: PlanKind, source: PlanSource? = nil, premiumEndsAt: Date? = nil, trialStartsAt: Date? = nil,
        trialEndsAt: Date? = nil, quotaBytes: Int64? = nil, autoRenews: Bool = false,
        paidSources: [PlanSource] = []
    ) {
        self.kind = kind
        self.source = source
        self.premiumEndsAt = premiumEndsAt
        self.trialStartsAt = trialStartsAt
        self.trialEndsAt = trialEndsAt
        self.quotaBytes = quotaBytes
        self.autoRenews = autoRenews
        let billed = Set(paidSources + [source].compactMap { $0 })
        self.paidSources = kind == .premium ? PlanSource.paid.filter(billed.contains) : []
    }

    public static let unknown = Plan(kind: .unknown)

    public static func from(_ row: Entitlement?, now: Date) -> Plan {
        guard let row else { return .unknown }
        let premium = PlanRules.isPremium(row, now: now)
        let source = row.premiumSource
        return Plan(
            kind: premium ? .premium : .free,
            source: premium ? source.flatMap(PlanSource.init(rawValue:)) : nil,
            premiumEndsAt: source == nil ? nil : row.premiumExpiresAt?.date,
            trialStartsAt: row.trialStartsAt?.date,
            trialEndsAt: row.trialEndsAt?.date,
            quotaBytes: premium ? row.premiumQuotaBytes : nil,
            autoRenews: premium && row.autoRenews,
            paidSources: premium ? PlanRules.livePaidSources(row, now: now) : [])
    }
}

public enum PlanRules {
    /// How long past its reported expiry an auto-renewing grant still counts, for a device that
    /// has not pulled the renewal.
    public static let offlineLeeway: TimeInterval = 604_800
    /// How long before a trial ends the reminder shows.
    public static let trialReminder: TimeInterval = 259_200

    /// The instant a grant stops counting, or nil when it never expires.
    private static func grantEnd(_ row: Entitlement) -> Date? {
        end(row.premiumExpiresAt, autoRenews: row.autoRenews)
    }

    private static func end(_ expiresAt: Timestamp?, autoRenews: Bool) -> Date? {
        expiresAt.map { $0.date.addingTimeInterval(autoRenews ? offlineLeeway : 0) }
    }

    /// The stores whose paid grant still counts at `now`, each judged as the reported grant is.
    static func livePaidSources(_ row: Entitlement, now: Date) -> [PlanSource] {
        row.paidGrants
            .filter { grant in end(grant.expiresAt, autoRenews: grant.autoRenews).map { $0 > now } ?? true }
            .compactMap { PlanSource(rawValue: $0.source) }
    }

    static func isPremium(_ row: Entitlement, now: Date) -> Bool {
        guard row.premiumSource != nil else { return false }
        guard let end = grantEnd(row) else { return true }
        return end > now
    }

    /// The one notice to show now, in precedence order. Only a trial or a lapsed trial sees any.
    public static func dueNotice(_ row: Entitlement?, now: Date, holdsRecordings: Bool) -> PlanNotice? {
        guard let row else { return nil }
        let plan = Plan.from(row, now: now)
        let trialEnd = row.trialEndsAt?.date
        // The row is not rewritten when a grant expires, so an ended trial may still name its source.
        if plan.kind == .free, let trialEnd, trialEnd <= now, row.trialEndSeenAt == nil,
            row.premiumSource == nil || row.premiumSource == "trial"
        {
            return .trialEnded
        }
        guard plan.isTrial else { return nil }
        if let trialEnd, now < trialEnd, now >= trialEnd.addingTimeInterval(-trialReminder),
            row.trialReminderSeenAt == nil
        {
            return .trialReminder
        }
        if holdsRecordings, row.recordingNoticeSeenAt == nil { return .firstRecording }
        return nil
    }

    /// The next instant ``Plan/from(_:now:)`` or ``dueNotice(_:now:holdsRecordings:)`` would
    /// answer differently for this row, or nil when none is ahead, so one timer replaces polling.
    public static func nextChange(_ row: Entitlement?, now: Date) -> Date? {
        guard let row else { return nil }
        var candidates: [Date] = []
        if row.premiumSource != nil {
            if let end = grantEnd(row) { candidates.append(end) }
            candidates += row.paidGrants.compactMap { end($0.expiresAt, autoRenews: $0.autoRenews) }
        }
        if let trialEnd = row.trialEndsAt?.date {
            candidates.append(trialEnd)
            candidates.append(trialEnd.addingTimeInterval(-trialReminder))
        }
        return candidates.filter { $0 > now }.min()
    }
}

extension Entitlement {
    /// Whether the row records the account as having seen `notice`.
    public func hasSeen(_ notice: PlanNotice) -> Bool {
        switch notice {
        case .firstRecording: recordingNoticeSeenAt != nil
        case .trialReminder: trialReminderSeenAt != nil
        case .trialEnded: trialEndSeenAt != nil
        }
    }

    /// This row as it will read once the server has heard of `notices`.
    public func seeing(_ notices: Set<PlanNotice>, at time: Timestamp) -> Entitlement {
        var row = self
        for notice in notices where !row.hasSeen(notice) {
            switch notice {
            case .firstRecording: row.recordingNoticeSeenAt = time
            case .trialReminder: row.trialReminderSeenAt = time
            case .trialEnded: row.trialEndSeenAt = time
            }
        }
        return row
    }

    /// The account's live row, nil until the first pull that carries it.
    public static func current(_ db: Database) throws -> Entitlement? {
        try Entitlement.filter(CodingKeys.deletedAt == nil).fetchOne(db)
    }
}
