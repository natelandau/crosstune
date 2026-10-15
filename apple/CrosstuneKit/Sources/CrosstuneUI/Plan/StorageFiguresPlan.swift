import CrosstuneStore

extension StorageFigures {
    /// These figures with the plan's quota in place of the reported one, once the plan is known.
    /// A free plan has no quota, so its figures carry none, whatever an older report said.
    nonisolated func measured(against plan: Plan) -> StorageFigures {
        let quota: Int
        switch plan.kind {
        case .unknown: return self
        case .free: quota = 0
        case .premium: quota = plan.quotaBytes.map { Int($0) } ?? quotaBytes
        }
        return StorageFigures(usedBytes: usedBytes, quotaBytes: quota, maxFileBytes: maxFileBytes)
    }
}
