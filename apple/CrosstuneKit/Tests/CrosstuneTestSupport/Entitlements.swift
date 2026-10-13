import CrosstuneStore
import Foundation
import GRDB

/// Stores the account's entitlements row as a pull does, with nothing queued. `source` nil is a
/// free account; a source with no `expiresAt` is Premium for good.
public func storeEntitlement(
    _ store: CrosstuneStore, source: String?, expiresAt: Timestamp? = nil, serverSeq: Int64 = 0
) async throws {
    let row = Entitlement(
        id: "entitlement-1", createdAt: noon, serverSeq: serverSeq, premiumSource: source, premiumExpiresAt: expiresAt,
        trialStartsAt: source == "trial" ? expiresAt.map { Timestamp($0.date.addingTimeInterval(-30 * 86_400)) } : nil,
        trialEndsAt: source == "trial" ? expiresAt : nil, premiumQuotaBytes: 10_000, freeQuotaBytes: 1_000)
    try await store.write { writer in try row.upsert(writer.db) }
}
