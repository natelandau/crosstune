import CrosstuneAuth
import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// The one row every list of recordings shows: it plays what this device holds, fetches what it
/// does not, and asks the musician to retry whichever of an upload or a transcode has stuck it.
/// The row itself is the play, close, or download control.
struct RecordingItem: View {
    let view: RecordingView
    /// True in a list whose heading already names the recording's tune.
    var tuneNamedAbove = false
    /// The account's storage, for a recording the quota blocked.
    var storage: StorageFigures?
    /// Retries a stuck upload or transcode; the row's tap and its Retry both land here.
    let onRetry: (RecordingText.Retry) -> Void

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?

    var body: some View {
        let id = view.id
        let offline = session?.isOffline ?? false
        let row = RecordingRowContent(
            recording: view.recording, file: view.file, tuneTitle: view.tuneTitle, tuneNamedAbove: tuneNamedAbove,
            loaded: player?.holds(.recording, id: id) ?? false, downloading: transfers?.isDownloading(id) ?? false,
            downloadFailed: transfers?.failedDownloads.contains(id) ?? false, offline: offline,
            playBlocked: recorders?.isCapturing ?? false, storage: storage)
        MediaRow(
            recording: row,
            perform: { tap in
                switch tap {
                case .play: player?.play(.recording(view.recording, tuneTitle: view.tuneTitle))
                case .close: player?.close()
                // Refused rather than disabled while offline, so the row keeps its tap and its
                // name; Offline in the meta line says why.
                case .download: if !offline { Task { await transfers?.download(id) } }
                case .retry(let kind): onRetry(kind)
                }
            },
            onRetry: onRetry)
    }
}

/// Words the recording row actions show.
public enum RecordingRowActions {
    public static let rename = "Rename"
    public static let addToTune = "Add to tune"
    public static let removeFromTune = "Remove from tune"
    public static let delete = "Delete"
}

extension View {
    /// Swipe actions and a context menu for a recording row: rename it, file it under a tune or
    /// take it out of one, and delete it. `onAddToTune` nil leaves Add to tune out, for a list
    /// where every recording is already under the tune being looked at.
    func recordingRowActions(
        filed: Bool, onRename: @escaping () -> Void, onAddToTune: (() -> Void)?, onRemoveFromTune: @escaping () -> Void,
        onDelete: @escaping () -> Void
    ) -> some View {
        self
            // A long swipe only reveals the actions; no swipe acts on its own.
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button(RecordingRowActions.delete, systemImage: "trash", role: .destructive, action: onDelete)
                filing(filed: filed, onAddToTune: onAddToTune, onRemoveFromTune: onRemoveFromTune)
                    .tint(.orange)
                Button(RecordingRowActions.rename, systemImage: "pencil", action: onRename)
                    .tint(.gray)
            }
            .contextMenu {
                Button(RecordingRowActions.rename, systemImage: "pencil", action: onRename)
                filing(filed: filed, onAddToTune: onAddToTune, onRemoveFromTune: onRemoveFromTune)
                Divider()
                Button(RecordingRowActions.delete, systemImage: "trash", role: .destructive, action: onDelete)
            }
    }

    @ViewBuilder private func filing(
        filed: Bool, onAddToTune: (() -> Void)?, onRemoveFromTune: @escaping () -> Void
    ) -> some View {
        if filed {
            Button(RecordingRowActions.removeFromTune, systemImage: "folder.badge.minus", action: onRemoveFromTune)
        } else if let onAddToTune {
            Button(RecordingRowActions.addToTune, systemImage: "folder.badge.plus", action: onAddToTune)
        }
    }
}
