import CrosstuneAnalytics
import CrosstuneStore

@testable import CrosstuneUI

extension AddedTuneUndo {
    /// An Added banner that stays until the test ends it, so a slow runner never times it out
    /// between a test's steps. The model cancels the wait when it goes.
    static func held(store: CrosstuneStore, analytics: AnalyticsClient = .noop) -> AddedTuneUndo {
        AddedTuneUndo(store: store, analytics: analytics, waitOut: { _ in try await Task.sleep(for: .seconds(3600)) })
    }
}
