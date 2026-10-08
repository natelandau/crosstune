import CrosstuneAnalytics
import SwiftUI

extension EnvironmentValues {
    /// Where views report analytics. The app sets the live client at the root of each scene;
    /// previews and tests that set nothing send nowhere.
    @Entry public var analytics: AnalyticsClient = .noop
}

extension View {
    /// Reports `screen` as a screen view each time this view appears. Put it on content that
    /// appears once per visit, never on a container whose child swaps from a placeholder.
    func screenView(_ screen: Screen) -> some View {
        modifier(ScreenViewModifier(screen: screen))
    }

    /// Reports `screen` as `screenView(_:)` does, for content its page can swap out and back
    /// within one visit, as a failed delete does. `visit` is the page's state of whether this
    /// visit has been reported; `stillShown` says, as the content disappears, whether the page
    /// still means to show it, which only leaving the screen does.
    func screenView(_ screen: Screen, visit: Binding<Bool>, stillShown: @escaping () -> Bool) -> some View {
        modifier(ScreenViewModifier(screen: screen, visit: visit, stillShown: stillShown))
    }
}

private struct ScreenViewModifier: ViewModifier {
    let screen: Screen
    var visit: Binding<Bool>?
    var stillShown: (() -> Bool)?
    @Environment(\.analytics) private var analytics

    func body(content: Content) -> some View {
        content
            .onAppear {
                if let visit {
                    guard !visit.wrappedValue else { return }
                    visit.wrappedValue = true
                }
                analytics.screen(screen)
            }
            .onDisappear {
                if let visit, stillShown?() ?? true { visit.wrappedValue = false }
            }
    }
}
