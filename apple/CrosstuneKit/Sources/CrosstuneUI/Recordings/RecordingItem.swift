import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneStore
import CrosstuneSync
import SwiftUI

/// The one row every list of recordings shows: it plays what this device holds, fetches what it
/// does not, and asks the musician to retry whichever of an upload or a transcode has stuck it.
/// The row itself is the play, close, or download control.
struct RecordingItem: View {
    let view: RecordingView
    /// The screen the row is on, which its plays are reported as started from.
    let source: ActionSource
    /// True in a list whose heading already names the recording's tune.
    var tuneNamedAbove = false
    /// The account's storage, for a recording the quota blocked.
    var storage: StorageFigures?
    /// The Recordings screen's sort, which picks the date the meta line shows. Nil elsewhere,
    /// which shows when it was played.
    var sort: RecordingSort?
    /// Opens the recording's tune from a tune line under the row's meta. Nil leaves the line out.
    var onOpenTune: (() -> Void)?
    /// True where a tap opens the recording's practice view, paused, rather than playing or
    /// stopping it from the row.
    var opensScreen = false
    /// Retries a stuck upload or transcode; the row's tap and its Retry both land here.
    let onRetry: (RecordingText.Retry) -> Void

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @Environment(\.playerWindow) private var window

    var body: some View {
        let id = view.id
        let offline = session?.isOffline ?? false
        let row = RecordingRowContent(
            recording: view.recording, file: view.file, tuneTitle: view.tuneTitle, tuneNamedAbove: tuneNamedAbove,
            loaded: player?.holds(.recording, id: id) ?? false, downloading: transfers?.isDownloading(id) ?? false,
            downloadFailed: transfers?.failedDownloads.contains(id) ?? false, offline: offline,
            playBlocked: recorders?.isCapturing ?? false, storage: storage, sort: sort, opensScreen: opensScreen)
        MediaRow(
            recording: row,
            sourceLine: MediaRow.SourceLine(recording: view.recording),
            tuneLine: onOpenTune.flatMap { open in view.tuneTitle.map { MediaRow.TuneLine(title: $0, action: open) } },
            perform: { tap in
                let item = PlayerItem.recording(view.recording, tuneTitle: view.tuneTitle)
                switch tap {
                case .play: player?.play(item, origin: .row, source: source)
                case .close: player?.close()
                case .open: player?.open(item, in: window, playing: false, source: source)
                // Refused rather than disabled while offline, so the row keeps its tap and its
                // name; Offline in the meta line says why.
                case .download: if !offline { Task { await transfers?.download(id) } }
                case .retry(let kind): onRetry(kind)
                }
            },
            onRetry: onRetry)
    }
}

/// Words the recording row actions and the recording screen's menu show.
public enum RecordingRowActions {
    public static let edit = "Edit"
    public static let addToTune = "Add to tune"
    public static let removeFromTune = "Remove from tune"
    public static let delete = "Delete"

    /// Opens an imported recording on the site it came from.
    public static func openOn(_ site: String) -> String { "Open on \(site)" }

    /// The page an imported recording opens, when it has a web address.
    static func originPage(_ recording: Recording) -> URL? {
        guard let text = recording.originURL, let url = URL(string: text),
            ["http", "https"].contains(url.scheme?.lowercased())
        else { return nil }
        return url
    }
}

extension MediaRow.SourceLine {
    /// The source of an imported recording with a web page to open; nil for one made here.
    init?(recording: Recording) {
        guard let site = RecordingText.originLabel(recording.origin),
            let page = RecordingRowActions.originPage(recording)
        else { return nil }
        self.init(title: site, url: page)
    }
}

/// One of a recording row's actions.
enum RecordingRowAction: Hashable {
    case edit
    case addToTune
    case removeFromTune
    case goToTune
    case pin
    case openOrigin(site: String)
    case delete

    /// The action's name, or for the pin its name while unpinned.
    var title: String {
        switch self {
        case .edit: RecordingRowActions.edit
        case .addToTune: RecordingRowActions.addToTune
        case .removeFromTune: RecordingRowActions.removeFromTune
        case .goToTune: RecordingsListText.goToTune
        case .pin: PlaySourceText.playFirstInLists
        case .openOrigin(let site): RecordingRowActions.openOn(site)
        case .delete: RecordingRowActions.delete
        }
    }

    /// The context menu's actions, top to bottom. `originSite` nil leaves Open on out.
    static func menu(
        filed: Bool, canAddToTune: Bool, canGoToTune: Bool, canPin: Bool, originSite: String?
    ) -> [Self] {
        [.edit] + filing(filed: filed, canAddToTune: canAddToTune, canGoToTune: canGoToTune)
            + (canPin ? [.pin] : []) + (originSite.map { [.openOrigin(site: $0)] } ?? []) + [.delete]
    }

    /// The swipe actions, from the trailing edge in.
    static func swipe(filed: Bool, canAddToTune: Bool, canGoToTune: Bool, canPin: Bool) -> [Self] {
        [.delete] + (canPin ? [.pin] : [])
            + filing(filed: filed, canAddToTune: canAddToTune, canGoToTune: canGoToTune) + [.edit]
    }

    private static func filing(filed: Bool, canAddToTune: Bool, canGoToTune: Bool) -> [Self] {
        if filed { return canGoToTune ? [.removeFromTune, .goToTune] : [.removeFromTune] }
        return canAddToTune ? [.addToTune] : []
    }
}

extension View {
    /// Swipe actions and a context menu for a recording row: edit it, file it under a tune or
    /// take it out of one, go to its tune, and delete it.
    /// `onAddToTune` nil leaves Add to tune out, for a list where every recording is already
    /// under the tune being looked at. `onGoToTune` nil leaves Go to tune out. `onTogglePin` nil
    /// leaves the pin action out; `pinned` says whether it unpins. Open on shows in the context
    /// menu only; `onOpenOrigin` nil leaves it out, for a recording made here or one with no page
    /// to open, and `originLabel` names the site it opens.
    func recordingRowActions(
        filed: Bool, pinned: Bool = false, onTogglePin: (() -> Void)? = nil, originLabel: String? = nil,
        onOpenOrigin: (() -> Void)? = nil, onEdit: @escaping () -> Void,
        onAddToTune: (() -> Void)?, onRemoveFromTune: @escaping () -> Void, onGoToTune: (() -> Void)? = nil,
        onDelete: @escaping () -> Void
    ) -> some View {
        let buttons = RecordingRowButtons(
            pinned: pinned, onTogglePin: onTogglePin, onEdit: onEdit, onAddToTune: onAddToTune,
            onRemoveFromTune: onRemoveFromTune, onGoToTune: onGoToTune, onOpenOrigin: onOpenOrigin,
            onDelete: onDelete)
        let canAddToTune = onAddToTune != nil
        let canGoToTune = onGoToTune != nil
        let canPin = onTogglePin != nil
        let originSite = onOpenOrigin == nil ? nil : originLabel
        return
            self
            // A long swipe only reveals the actions; no swipe acts on its own.
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                ForEach(
                    RecordingRowAction.swipe(
                        filed: filed, canAddToTune: canAddToTune, canGoToTune: canGoToTune, canPin: canPin),
                    id: \.self
                ) { action in
                    buttons.button(action, short: true).tint(RecordingRowButtons.swipeTint(action))
                }
            }
            .contextMenu {
                ForEach(
                    RecordingRowAction.menu(
                        filed: filed, canAddToTune: canAddToTune, canGoToTune: canGoToTune, canPin: canPin,
                        originSite: originSite),
                    id: \.self
                ) { action in
                    if action == .delete { Divider() }
                    buttons.button(action, short: false)
                }
            }
    }
}

/// The button for each of a recording row's actions, wired to what it does.
@MainActor
private struct RecordingRowButtons {
    let pinned: Bool
    let onTogglePin: (() -> Void)?
    let onEdit: () -> Void
    let onAddToTune: (() -> Void)?
    let onRemoveFromTune: () -> Void
    let onGoToTune: (() -> Void)?
    let onOpenOrigin: (() -> Void)?
    let onDelete: () -> Void

    static func swipeTint(_ action: RecordingRowAction) -> Color? {
        switch action {
        case .pin: .indigo
        case .addToTune, .removeFromTune: .orange
        case .goToTune: .blue
        case .edit: .gray
        case .openOrigin, .delete: nil
        }
    }

    @ViewBuilder func button(_ action: RecordingRowAction, short: Bool) -> some View {
        switch action {
        case .edit:
            Button(action.title, systemImage: "pencil", action: onEdit)
        case .addToTune:
            if let onAddToTune { Button(action.title, systemImage: "folder.badge.plus", action: onAddToTune) }
        case .removeFromTune:
            Button(action.title, systemImage: "folder.badge.minus", action: onRemoveFromTune)
        case .goToTune:
            if let onGoToTune { Button(action.title, systemImage: "arrow.right.circle", action: onGoToTune) }
        case .pin:
            PinAction(pinned: pinned, onTogglePin: onTogglePin, short: short)
        case .openOrigin:
            if let onOpenOrigin {
                Button(action.title, systemImage: "arrow.up.right.square", action: onOpenOrigin)
            }
        case .delete:
            Button(action.title, systemImage: "trash", role: .destructive, action: onDelete)
        }
    }
}
