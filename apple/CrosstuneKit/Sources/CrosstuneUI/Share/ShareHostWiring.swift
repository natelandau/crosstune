import SwiftUI

/// Shows what the share host holds in this window: the Plan sheet, and a refused file on the
/// Recordings screen.
struct ShareHostWiring: ViewModifier {
    let premium: PremiumPresenter?
    let recordings: RecordingsModel?

    @Environment(ShareHost.self) private var host: ShareHost?
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            // Only a window in the foreground takes the Plan sheet, so it never opens out of sight.
            .onChange(of: host?.plan.value, initial: true) { showPlan() }
            .onChange(of: scenePhase) { showPlan() }
            .onChange(of: premium.map(ObjectIdentifier.init)) { showPlan() }
            .onChange(of: host?.refusals.value, initial: true) { showRefusals() }
            .onChange(of: recordings.map(ObjectIdentifier.init)) { showRefusals() }
    }

    private func showPlan() {
        guard scenePhase == .active, let host, let premium, host.plan.take() else { return }
        premium.present(.recordings, from: .share)
    }

    /// Waits for the Recordings screen's model, which the shell makes after it first appears.
    private func showRefusals() {
        guard let host, let recordings else { return }
        recordings.sharedFilesRefused(host.refusals.take())
    }
}
