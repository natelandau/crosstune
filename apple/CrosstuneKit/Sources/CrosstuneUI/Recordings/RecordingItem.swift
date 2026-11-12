import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// The one row every list of recordings shows: a press on it opens the recording's page, and its
/// action slot plays what this device holds, fetches what it does not, and asks the musician to
/// retry whichever of an upload or a transcode has stuck it.
struct RecordingItem: View {
    let view: RecordingView
    /// The screen the row is on, which its plays and page opens are reported as started from.
    let source: ActionSource
    /// True in a list whose heading already names the recording's tune.
    var tuneNamedAbove = false
    /// The account's storage, for a recording the quota blocked.
    var storage: StorageUsage?
    /// The plain per-file upload cap, for a recording too large to upload until it is split.
    var uploadLimits: StorageUsage?
    /// The Recordings screen's sort, which picks the date the meta line shows. Nil elsewhere,
    /// which shows when it was played.
    var sort: RecordingSort?
    /// Opens the recording's tune from a tune line under the row's meta. Nil leaves the line out.
    var onOpenTune: (() -> Void)?
    /// Where a free plan's press on the slot is reported as coming from.
    var premiumEntry: PremiumEntry = .recordingRow
    /// Retries a stuck upload or transcode; the slot's press and its Retry both land here.
    let onRetry: (RecordingText.Retry) -> Void

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @Environment(\.openRecordingPage) private var openRecordingPage
    @Environment(\.plan) private var plan
    @Environment(\.premium) private var premium

    var body: some View {
        let id = view.id
        let offline = session?.isOffline ?? false
        let row = RecordingRowContent(
            recording: view.recording, file: view.file, uploadLimits: uploadLimits, tuneTitle: view.tuneTitle,
            tuneNamedAbove: tuneNamedAbove,
            loaded: player?.holds(.recording, id: id) ?? false, downloading: transfers?.isDownloading(id) ?? false,
            downloadFailed: transfers?.failedDownloads.contains(id) ?? false, offline: offline,
            playBlocked: recorders?.isCapturing ?? false, storage: storage, sort: sort,
            isLocalUntilSubscribed: plan?.isLocalUntilSubscribed.contains(id) ?? false,
            recordingsPlay: plan.recordingsPlay)
        MediaRow(
            recording: row,
            sourceLine: MediaRow.SourceLine(recording: view.recording),
            tuneLine: onOpenTune.flatMap { open in view.tuneTitle.map { MediaRow.TuneLine(title: $0, action: open) } },
            open: { openPage(openRecordingPage) },
            perform: { tap in
                press(
                    tap, player: player, offline: offline, download: { await transfers?.download($0) },
                    premium: premium)
            },
            onRetry: onRetry)
    }

    /// Opens the recording's page, whatever the player holds and whether or not the recording
    /// can play, and leaves playback as it is.
    func openPage(_ open: RecordingPageOpener?) {
        open?(view.id, source: source)
    }

    /// Runs a press on the action slot, which never opens the page.
    func press(
        _ tap: RecordingRowContent.Tap, player: PlayerModel?, offline: Bool,
        download: @escaping @MainActor (String) async -> Void, premium: PremiumPresenter?
    ) {
        switch tap {
        case .play: player?.play(.recording(view.recording, tuneTitle: view.tuneTitle), origin: .row, source: source)
        case .close: player?.close()
        // Refused rather than disabled while offline, so the slot keeps its press and its name;
        // Offline in the meta line says why.
        case .download:
            if !offline {
                let id = view.id
                Task { await download(id) }
            }
        case .retry(let kind): onRetry(kind)
        case .premium: offerPremium(premium)
        }
    }

    /// Shows the Plan sheet for a press the plan holds back.
    func offerPremium(_ premium: PremiumPresenter?) {
        _ = premium?.gate(.recordings, from: premiumEntry)
    }
}

/// Words the recording row actions and the recording page's menu show.
public enum RecordingRowActions {
    public static let removeFromTune = "Remove from tune"
    public static let delete = RowActionText.delete

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

extension View {
    /// Swipe actions and a context menu for a recording row, which hold Delete alone. Delete
    /// shows disabled with `deleteDisabledReason` while it cannot be used.
    func recordingRowActions(onDelete: @escaping () -> Void, deleteDisabledReason: String? = nil) -> some View {
        self
            // A long swipe only reveals the actions; no swipe acts on its own.
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                SwipeActionButton(.delete, disabledReason: deleteDisabledReason, perform: onDelete)
            }
            .contextMenu {
                RowMenuButton(.delete, disabledReason: deleteDisabledReason, perform: onDelete)
            }
    }

    /// Asks before deleting the recording `deleting` holds, then runs `delete`. Put it on the
    /// row with `deleting` narrowed to that row, so the question points at the row.
    func confirmsRecordingDelete(
        _ deleting: Binding<RecordingView?>, delete: @escaping (RecordingView) -> Void
    ) -> some View {
        self
            .coversShell(deleting.wrappedValue != nil)
            .confirmationDialog(
                RecordingsModel.deleteTitle, item: deleting, titleVisibility: .visible
            ) { view in
                Button(RecordingRowActions.delete, role: .destructive) { delete(view) }
            } message: { view in
                Text(RecordingsModel.deleteMessage(view))
            }
    }
}
