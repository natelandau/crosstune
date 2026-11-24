import AppIntents
import CrosstuneRecordingActivity
import CrosstuneWidgetIntents
import SwiftUI
import WidgetKit

@main
struct WidgetsBundle: WidgetBundle {
    var body: some Widget {
        RecordingsWidget()
        ListWidget()
        TunerWidget()
        RecordingActivityWidget()
    }
}

/// Puts the shared intents' metadata in this bundle, so the Live Activity's buttons and the
/// widgets' taps can name them.
struct WidgetsExtensionIntents: AppIntentsPackage {
    static var includedPackages: [any AppIntentsPackage.Type] {
        [RecordingActivityIntents.self, WidgetIntents.self]
    }
}
