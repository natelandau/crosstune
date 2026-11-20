import AppIntents
import CrosstuneRecordingActivity
import SwiftUI
import WidgetKit

@main
struct RecordingActivityBundle: WidgetBundle {
    var body: some Widget {
        RecordingActivityWidget()
    }
}

/// Puts the shared intents' metadata in this bundle, so the Live Activity's buttons can name them.
struct RecordingActivityExtensionIntents: AppIntentsPackage {
    static var includedPackages: [any AppIntentsPackage.Type] { [RecordingActivityIntents.self] }
}
