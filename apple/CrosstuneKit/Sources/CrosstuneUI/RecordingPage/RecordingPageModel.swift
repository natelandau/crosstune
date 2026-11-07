import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import Observation
import SwiftUI

/// What a recording page follows: its recording's stored rows, which leave the page once the
/// recording is gone, and the one report that the page opened. It also runs the page's actions:
/// the trim and split editors, the pin, the delete, and the waveform's load.
@MainActor
@Observable
final class RecordingPageModel {
    let recordingID: String
    @ObservationIgnored let parent: RecordingPageParent
    /// Where the page's open is reported.
    @ObservationIgnored let analytics: AnalyticsClient
    /// The recording's rows, nil until the first read and once the recording is gone.
    private(set) var rows: ScreenRows?
    /// The attributes column's rows and the header's subtitle, made as the rows are read rather
    /// than on each redraw, since both format dates.
    private(set) var attributeRows: [AttributeColumnRow<RecordingAttributeID>] = []
    private(set) var subtitle = ""
    /// Nil inside until the first read, so a page that has not read yet is not taken for one
    /// whose recording is gone.
    @ObservationIgnored private var query: LiveQuery<ScreenRows??>?
    @ObservationIgnored private var following: Task<Void, Never>?
    @ObservationIgnored private var hasLeft = false
    /// The open trim screen's model, kept until the screen has gone.
    var trim: TrimModel?
    /// The open split screen's model, kept until the screen has gone.
    var split: SplitModel?
    /// The trim or split screen pushed over the page.
    var route: RecordingRoute?
    /// The recording whose Delete waits on the confirmation dialog.
    var deleting: RecordingView?
    /// Why the page's last write did not land.
    private(set) var failure: String?
    /// Why the trim or split screen gave way on its own, until the musician next does something
    /// here.
    var trimNotice: String?
    /// The recording's waveform as last read on this device.
    private(set) var peaks: LoadedPeaks?
    /// What the rows' editors write through, made once the store is at hand.
    private(set) var fields: RecordingAttributeModel?

    init(recordingID: String, parent: RecordingPageParent, analytics: AnalyticsClient) {
        self.recordingID = recordingID
        self.parent = parent
        self.analytics = analytics
    }

    /// The player this page loaded its recording into for the trim or split editor, until the
    /// editor closes.
    @ObservationIgnored private var loadedForEditing: PlayerModel?

    /// This page's identity to the player: for the practice visit it opens, so another window's
    /// page ends only its own, and for the playback a play on it starts.
    let screen = UUID()
    /// The player this page has shown itself to.
    @ObservationIgnored private var shownOn: PlayerModel?
    /// From the page's first surface on screen until the player takes it off show. A page that
    /// has left opens no visit, since nothing would close it.
    @ObservationIgnored private var isOnShow = false

    /// A page that goes with its trim or split screen still open lets go of what the screen
    /// holds.
    isolated deinit {
        following?.cancel()
        closeEditors()
        closeVisit()
        shownOn?.pageHidden(screen, surfaces: Set(RecordingPageSurface.allCases))
    }

    /// `surface` is on screen in `window`, where the page's controls take the place of the dock
    /// or player bar while it shows the loaded recording. The visit to `practice`'s recording
    /// opens, or carries on, with it.
    func shown(
        _ surface: RecordingPageSurface = .page, on player: PlayerModel, window: UUID?,
        practice: PracticeModel? = nil
    ) {
        shownOn = player
        isOnShow = true
        player.pageShown(screen, surface: surface, recordingID: recordingID, window: window) { [weak self] in
            self?.isOnShow = false
            self?.closeVisit()
        }
        openVisit(practice)
    }

    /// `surface` has left the screen. With neither the page nor its editor on screen, the page has
    /// left, however it went: its visit is written and its playback stops; see
    /// ``PlayerModel/pageHidden(_:surfaces:)``.
    func hidden(_ surface: RecordingPageSurface = .page) {
        shownOn?.pageHidden(screen, surfaces: [surface])
    }

    /// Loads `item`, paused at its start, where `player` holds another, since the trim and split
    /// editors play it. False when it does not load.
    func loadForEditing(_ item: PlayerItem, on player: PlayerModel) -> Bool {
        guard !player.holds(item.kind, id: item.id) else { return true }
        guard player.loadPaused(item, page: screen) else { return false }
        loadedForEditing = player
        return true
    }

    /// Lets go of the trim or split editor, and of the recording it loaded where it never played.
    func closeEditors() {
        trim?.leave()
        trim = nil
        split?.leave()
        split = nil
        guard let player = loadedForEditing else { return }
        loadedForEditing = nil
        player.closeIfUnplayed(recordingID)
    }

    /// The practice visit this page opened, which the page, not its practice view, owns, so a
    /// switch between Details and Practice, or across the fold width, keeps it.
    @ObservationIgnored private var visitPlayer: PlayerModel?

    /// The page is on show, or the player has just taken its recording: opens the visit to the
    /// recording once the player holds it. A recording the player does not hold, or a page off
    /// show, has no visit.
    func openVisit(_ practice: PracticeModel?) {
        guard isOnShow, let practice, practice.isCurrent else { return }
        practice.openVisit(screen: screen)
        visitPlayer = practice.player
    }

    /// The page has left the screen, or gone: its visit is written.
    func closeVisit() {
        guard let visitPlayer else { return }
        self.visitPlayer = nil
        visitPlayer.screenClosed(by: screen)
    }

    /// Reads the recording's rows from `store` and follows them, leaving the page once the
    /// recording is deleted, here or on another device.
    func follow(_ store: CrosstuneStore) {
        following?.cancel()
        let id = recordingID
        fields = RecordingAttributeModel(store: store, recordingID: id, analytics: analytics)
        let query = LiveQuery<ScreenRows??>(store, initial: nil) { .some(try ScreenRows.fetch($0, id: id)) }
        self.query = query
        following = Task { [weak self] in
            for await read in Observations({ @MainActor in query.value }) {
                guard let self, let read else { continue }
                self.take(read)
            }
        }
    }

    private func take(_ read: ScreenRows?) {
        if read != rows {
            rows = read
            attributeRows = read.map { RecordingPageRows.rows($0) } ?? []
            subtitle = read.map { RecordingPageRows.subtitle($0) } ?? ""
        }
        guard read == nil, !hasLeft else { return }
        hasLeft = true
        parent.leave()
    }

    /// Reports the page opening for `open`, in the layout it shows then.
    func reportOpen(_ open: PageOpen, layout: RecordingPageLayout) {
        analytics.send(.recordingPageOpened(recordingID: recordingID, layout: layout, source: open.source))
    }

    // MARK: Notices

    /// Why the page's last write did not land, or why the trim editor gave way.
    var pageNotice: String? { failure ?? trimNotice }

    // MARK: The trim and split editors

    /// Opens the trim editor over the page, unless it cannot open now.
    func openTrim(
        _ rows: ScreenRows, disabledReason: String?, recordingsPlay: Bool, commands: CrosstuneCommands.Commands?,
        player: PlayerModel
    ) {
        guard let commands,
            canOpenEditor(rows, disabledReason: disabledReason, recordingsPlay: recordingsPlay, player: player)
        else { return }
        let id = rows.recording.id
        let editor = TrimModel(
            recording: rows.recording, file: rows.file,
            write: { try await commands.updateRecording($0, trimStartMs: .value($1), trimEndMs: .value($2)) },
            hold: { [player] in player.hold(id, $0) }, analytics: player.analytics)
        editor.open()
        trim = editor
        trimNotice = nil
        route = .trim
    }

    /// Opens the split editor over the page, unless it cannot open now.
    func openSplit(
        _ rows: ScreenRows, disabledReason: String?, recordingsPlay: Bool, commands: CrosstuneCommands.Commands?,
        player: PlayerModel
    ) {
        guard let commands,
            canOpenEditor(rows, disabledReason: disabledReason, recordingsPlay: recordingsPlay, player: player)
        else { return }
        let id = rows.recording.id
        let editor = SplitModel(
            recording: rows.recording, file: rows.file,
            write: { _ = try await commands.splitRecording($0, cutsMs: $1) },
            hold: { [player] in player.hold(id, $0) }, analytics: player.analytics)
        editor.open()
        split = editor
        trimNotice = nil
        route = .split
    }

    /// Whether the trim or split editor can open, once the recording is loaded for it: false when
    /// the plan holds recordings back, an editor is open already, the menu says why not, or the
    /// recording does not load.
    private func canOpenEditor(
        _ rows: ScreenRows, disabledReason: String?, recordingsPlay: Bool, player: PlayerModel
    ) -> Bool {
        guard recordingsPlay, route == nil, disabledReason == nil else { return false }
        return loadForEditing(.recording(rows.recording, tuneTitle: rows.tuneTitle), on: player)
    }

    /// Back to the page from the trim or split screen, which writes and holds nothing after.
    func leaveEditor() {
        trim?.leave()
        split?.leave()
        route = nil
    }

    /// The trim or split screen gives way to a trim from elsewhere, and the page says why.
    func editorGaveWay() {
        leaveEditor()
        trimNotice = RecordingScreenText.trimChangedElsewhere
        AccessibilityNotification.Announcement(RecordingScreenText.trimChangedElsewhere).post()
    }

    /// Hands new `rows` to the open trim or split editor.
    func followInEditors(_ rows: ScreenRows) {
        trim?.follow(rows.recording)
        split?.follow(rows.recording)
    }

    // MARK: The waveform

    /// Shows the peaks on this device at once, then fetches the server's current waveform when
    /// these are missing or older; the file row it writes reruns this with them.
    func loadPeaks(_ rows: ScreenRows, store: CrosstuneStore, engine: SyncEngine?) async {
        let file = rows.file
        if let data = store.localPeaks(file), let parsed = try? Peaks(file: data) {
            peaks = LoadedPeaks(peaks: parsed, rev: file?.peaksRev)
        } else {
            peaks = nil
        }
        guard let rowRev = rows.recording.peaksRev, file?.peaksRev != rowRev else { return }
        _ = await engine?.peaks(rows.recording.id)
    }

    /// The loaded peaks as `recording`'s waveform shows them.
    func shownPeaks(_ recording: Recording) -> ShownPeaks? {
        peaks.flatMap { ShownPeaks(recording, peaks: $0.peaks, peaksRev: $0.rev, loudest: $0.loudest) }
    }

    // MARK: Writes

    /// Plays the recording first in lists of its tune, or stops that while it is `pinned`.
    func togglePin(pinned: Bool, rows: ScreenRows, commands: CrosstuneCommands.Commands?) {
        guard let userTuneID = rows.userTuneID else { return }
        let source = RecordingMenuItem.playSource(togglingPinned: pinned, recordingID: rows.recording.id)
        Task { await run(commands) { try await $0.setPlaySource(userTuneID, to: source) } }
    }

    /// Deletes the recording. One the player holds is deleted through the player, which lets go
    /// of the audio first and shows a failure on the player bar. The page leaves once the row is
    /// gone.
    func delete(_ view: RecordingView, commands: CrosstuneCommands.Commands?, player: PlayerModel) {
        guard let commands else { return }
        let recording = view.recording
        let analytics = player.analytics
        guard player.holds(.recording, id: view.id) else {
            Task {
                if await run(commands, { try await $0.deleteRecording(view.id) }) {
                    analytics.recordingDeleted(recording)
                }
            }
            return
        }
        Task {
            await player.deleteLoadedRecording {
                try await commands.deleteRecording(view.id)
                analytics.recordingDeleted(recording)
            }
        }
    }

    /// Runs a write on the recording, showing why it failed on the page. True when it landed.
    private func run(
        _ commands: CrosstuneCommands.Commands?, _ write: (CrosstuneCommands.Commands) async throws -> Void
    ) async -> Bool {
        guard let commands else { return false }
        failure = nil
        do {
            try await write(commands)
            return true
        } catch {
            failure = failureMessage(error)
            return false
        }
    }
}

extension RecordingPageModel {
    struct LoadedPeaks: Equatable {
        let peaks: Peaks
        /// The server revision these are, or nil for peaks made while recording.
        let rev: String?
        /// Found once as the peaks load, since every redraw would otherwise scan the whole file.
        let loudest: UInt8

        init(peaks: Peaks, rev: String?) {
            self.peaks = peaks
            self.rev = rev
            loudest = peaks.values.max() ?? 0
        }
    }
}

/// What of a recording page is on screen: the page, or the trim or split screen pushed over it.
enum RecordingPageSurface: CaseIterable {
    case page
    case editor
}
