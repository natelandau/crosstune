import CrosstuneStore

extension StorageFigures {
    /// The quota in force: the plan's when it is known, else the reported one when it names one.
    nonisolated static func quota(plan: Plan, reported: StorageFigures?) -> Int64? {
        if plan.kind != .unknown, let quota = plan.quotaBytes { return quota }
        return reported.flatMap { $0.quotaBytes > 0 ? Int64($0.quotaBytes) : nil }
    }

    /// These figures with the plan's quota in place of the reported one, once the plan is known.
    nonisolated func measured(against plan: Plan) -> StorageFigures {
        guard plan.kind != .unknown, let quota = plan.quotaBytes else { return self }
        return StorageFigures(usedBytes: usedBytes, quotaBytes: Int(quota), maxFileBytes: maxFileBytes)
    }
}
