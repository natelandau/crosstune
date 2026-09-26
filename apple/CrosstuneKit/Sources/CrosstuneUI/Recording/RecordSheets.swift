import CrosstuneStore
import SwiftUI

/// A take the record sheet is up for.
struct RecordTake: Identifiable {
    let id = UUID()
    let model: RecordSheetModel

    /// Whether a new take may be asked for over `current`: when there is none, or when the
    /// one asked for never showed, as when another sheet was up at the time.
    @MainActor static func mayReplace(_ current: RecordTake?) -> Bool {
        current?.model.isPending ?? true
    }
}

/// The record sheet, presented once over the whole shell, and the tune screen's New recording.
struct RecordSheets: ViewModifier {
    @Binding var take: RecordTake?
    let host: RecorderHost
    let store: CrosstuneStore
    /// Starts a take, filed under a tune or unfiled.
    let record: @MainActor (_ tuneID: String?) -> Void
    /// Shows the Recordings screen, where a saved unfiled take lands.
    let showRecordings: @MainActor () -> Void

    @Environment(\.tuneScreenActions) private var tuneScreenActions
    /// The take on screen, kept past the dismissal that clears `take`.
    @State private var shown: RecordSheetModel?

    func body(content: Content) -> some View {
        content
            .environment(\.tuneScreenActions, withRecord)
            .sheet(item: $take, onDismiss: dismissed) { take in
                RecordSheet(model: take.model) {
                    shown = take.model
                    return host.claim(for: store) != nil
                }
                // Also when a window closes with its sheet up, which runs no onDismiss.
                .onDisappear { release(take.model) }
            }
    }

    private func dismissed() {
        guard let shown else { return }
        release(shown)
        if shown.landsOnRecordings { showRecordings() }
        self.shown = nil
    }

    private func release(_ model: RecordSheetModel) {
        if model.releaseRecorder() { host.release() }
    }

    /// The tune screen's actions as set further out, with New recording opening the sheet.
    private var withRecord: TuneScreenActions {
        var actions = tuneScreenActions
        actions.record = { tuneID in record(tuneID) }
        return actions
    }
}
