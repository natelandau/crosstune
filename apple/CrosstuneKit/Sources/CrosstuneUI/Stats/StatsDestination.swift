import SwiftUI

/// The stats screen as a push from the summary row, where the form sits in a stack.
struct StatsDestination: ViewModifier {
    let isPushed: Bool

    func body(content: Content) -> some View {
        if isPushed {
            content.navigationDestination(for: StatsRoute.self) { _ in
                StatsScreen()
                    // A tune opened from the stats screen is not the tab's own pushed tune.
                    .environment(\.stackTune, nil)
            }
        } else {
            content
        }
    }
}
