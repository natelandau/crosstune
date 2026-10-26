import CrosstuneStore
import SwiftUI

/// A recording the record sheet is up for.
struct RecordSheetItem: Identifiable {
    let id = UUID()
    let model: RecordSheetModel

    /// Whether a new recording may be asked for over `current`: when there is none, or when the
    /// one asked for never showed, as when another sheet was up at the time.
    @MainActor static func mayReplace(_ current: RecordSheetItem?) -> Bool {
        current?.model.isPending ?? true
    }
}

/// The record sheet, presented once over the whole shell, and the tune screen's New recording.
struct RecordSheets: ViewModifier {
    @Binding var item: RecordSheetItem?
    let host: RecorderHost
    let store: CrosstuneStore
    /// Starts a recording, filed under a tune or unfiled.
    let record: @MainActor (_ tuneID: String?) -> Void
    /// Shows the Recordings screen, where a saved unfiled recording lands.
    let showRecordings: @MainActor () -> Void

    @Environment(\.tuneScreenActions) private var tuneScreenActions
    /// The recording on screen, kept past the dismissal that clears `item`.
    @State private var shown: RecordSheetModel?
    @State private var source = UUID()
    @State private var latestRecord = LatestRecord()

    func body(content: Content) -> some View {
        content
            .environment(\.tuneScreenActions, withRecord)
            .sheet(item: $item, onDismiss: dismissed) { item in
                RecordSheet(model: item.model) {
                    shown = item.model
                    return host.claim(for: store) != nil
                }
                // Also when a window closes with its sheet up, which runs no onDismiss.
                .onDisappear { release(item.model) }
            }
    }

    private func dismissed() {
        guard let shown else { return }
        release(shown)
        shown.markRecent()
        if shown.landsOnRecordings { showRecordings() }
        self.shown = nil
    }

    private func release(_ model: RecordSheetModel) {
        if model.releaseRecorder() { host.release() }
    }

    /// The tune screen's actions as set further out, with New recording opening the sheet.
    private var withRecord: TuneScreenActions {
        // `record` reads the shell's state as of this render, so the action handed down calls
        // the newest one rather than the one captured when the actions last changed.
        latestRecord.record = record
        let latest = latestRecord
        return tuneScreenActions.supplied(by: source) { actions in
            actions.record = { tuneID in latest.record?(tuneID) }
        }
    }
}

/// The newest record closure the shell handed ``RecordSheets``.
@MainActor
private final class LatestRecord {
    var record: (@MainActor (_ tuneID: String?) -> Void)?
}
