#if DEBUG
    import CrosstuneStore
    import Foundation

    /// An entitlements row for the sample catalog, so the gated screens show without an account.
    /// Debug builds only.
    public enum SamplePlan: String, Sendable {
        /// Free, never trialed: recordings and off-tune scans gated, no notice due.
        case free
        /// A trial two days from its end, so the reminder is due.
        case trial
        /// A trial that ended yesterday, so the plan is free and the trial-ended notice is due.
        case trialEnded = "trial-ended"

        /// The plan named after `-SamplePlan` in the launch arguments, nil without one.
        public static func fromArguments(_ arguments: [String] = CommandLine.arguments) -> SamplePlan? {
            guard let flag = arguments.firstIndex(of: "-SamplePlan"), arguments.indices.contains(flag + 1) else {
                return nil
            }
            return SamplePlan(rawValue: arguments[flag + 1])
        }

        func entitlement(now: Date) -> Entitlement {
            let day: TimeInterval = 86_400
            let trialEnd: Date? =
                switch self {
                case .free: nil
                case .trial: now.addingTimeInterval(2 * day)
                case .trialEnded: now.addingTimeInterval(-day)
                }
            return Entitlement(
                id: "sample-entitlement", premiumSource: self == .free ? nil : "trial",
                premiumExpiresAt: trialEnd.map(Timestamp.init),
                trialStartsAt: trialEnd.map { Timestamp($0.addingTimeInterval(-30 * day)) },
                trialEndsAt: trialEnd.map(Timestamp.init),
                premiumQuotaBytes: 10_000_000_000, freeQuotaBytes: 1_000_000_000)
        }

        /// Stores the row, timed from `now`, as a pull would, with nothing queued.
        func store(in store: CrosstuneStore, now: Date) async throws {
            let row = entitlement(now: now)
            try await store.write { writer in try row.upsert(writer.db) }
        }
    }
#endif
