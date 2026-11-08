import CrosstuneAnalytics
import CrosstuneAudio
import CrosstuneAuth
import CrosstuneCommands
import CrosstuneDesign
import CrosstuneStore
import GRDB
import SwiftUI

/// Where the recording page goes: the trim and split editors, its only screens of their own.
enum RecordingRoute: Hashable, Identifiable {
    case trim
    case split

    var id: Self { self }
}

/// A recording's stored rows, as its page reads them.
struct ScreenRows: Equatable, Sendable {
    let recording: Recording
    let file: RecordingFile?
    /// The recording's tune while it still exists.
    let tuneID: String?
    let tuneTitle: String?
    /// The tune's part structure, which names loops.
    let partStructure: String?
    /// The location's name to show: its saved location's while that is live, else the recording's own.
    let shownPlace: String?
    /// Whether a piece split from the recording still plays from its audio.
    var holdsSplitAudio = false
    /// The recording's loops, which its practice keeps while the player holds another recording.
    var loops: [RecordingLoop] = []
    /// The saved location the recording is linked to, while that is live.
    var linkedPlace: SavedPlace?
    /// The musician's own copy of the recording's tune, which says what the tune plays first.
    var userTuneID: String?
    /// Whether the recording's tune plays it first in lists.
    var playsFirst = false

    var view: RecordingView {
        RecordingView(
            recording: recording, file: file, tuneID: tuneID, tuneTitle: tuneTitle, shownPlace: shownPlace,
            holdsSplitAudio: holdsSplitAudio)
    }

    /// How long the trimmed recording plays, or nil when nothing says how long it is.
    var trimmedLengthMs: Int64? { Self.trimmedLengthMs(recording, file: file) }

    /// How long `recording` plays from its trim start to its end on the source timeline.
    nonisolated static func trimmedLengthMs(_ recording: Recording, file: RecordingFile?) -> Int64? {
        RecordingLimits.sourceEndMs(recording, file: file).map { max(0, $0 - recording.trimStartMs) }
    }

    static func fetch(_ db: Database, id: String) throws -> ScreenRows? {
        guard let recording = try Recording.fetchOne(db, key: id), recording.deletedAt == nil else { return nil }
        let tune = try recording.tuneID.flatMap { try Tune.fetchOne(db, key: $0) }
        let live = tune?.deletedAt == nil ? tune : nil
        let linked = try recording.placeID.flatMap { try SavedPlace.fetchOne(db, key: $0) }.flatMap {
            $0.deletedAt == nil ? $0 : nil
        }
        let places = linked.map { [$0.id: $0] } ?? [:]
        let userTune = try live.flatMap { try UserTune.live(tuneID: $0.id, in: db) }
        return ScreenRows(
            recording: recording, file: try RecordingFile.fetchOne(db, key: id), tuneID: live?.id,
            tuneTitle: live?.title, partStructure: live?.partStructure,
            shownPlace: shownPlaceName(recording, places: places),
            holdsSplitAudio: RecordingLimits.holdsSplitAudio(
                recording, waitingParentIDs: try RecordingLimits.waitingParentIDs(db)),
            loops: try RecordingLoop.filter(RecordingLoop.CodingKeys.recordingID == id).fetchAll(db),
            linkedPlace: linked, userTuneID: userTune?.id, playsFirst: userTune?.playRecordingID == id)
    }
}

/// A recording's practice view on its page: the overview, the waveform under a fixed playhead
/// with the readout and zoom over it, the Speed, Pitch, Isolate, and Loops selector, the
/// transport, and the chosen mode's controls. It shows the recording it is given, whatever the
/// player holds: live playback while the player holds it, and otherwise the row's timeline with
/// the model's own playhead, where Play loads it.
struct RecordingScreen: View {
    let practice: PracticeModel
    let rows: ScreenRows
    let peaks: ShownPeaks?
    /// Why the page's last write did not land, or why the trim editor gave way.
    let notice: String?
    /// Why the practice view cannot be used now, as for a plan that holds recordings back.
    let blockedReason: String?
    /// Escape with no name field open and no loop selected.
    let onClose: () -> Void

    @Environment(\.spacing) private var spacing
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(\.practiceIsFullPage) private var isFullPage
    /// The window's height, and off the Mac the page's and the waveform's, from which the waveform
    /// takes the height the rest of the page leaves.
    @State private var viewportHeight: CGFloat?
    #if !os(macOS)
        @State private var pageHeight: CGFloat?
        @State private var waveformHeight: CGFloat?
    #endif
    @FocusState private var focus: PracticeFocus?
    @AccessibilityFocusState private var waveformFocused: Bool

    /// The narrowest the practice view lays out its waveform and controls.
    nonisolated static let minimumWidth: CGFloat = 480

    init(
        practice: PracticeModel, rows: ScreenRows, peaks: ShownPeaks?, notice: String? = nil,
        blockedReason: String? = nil, onClose: @escaping () -> Void = {}
    ) {
        self.practice = practice
        self.rows = rows
        self.peaks = peaks
        self.notice = notice
        self.blockedReason = blockedReason
        self.onClose = onClose
    }

    private var player: PlayerModel { practice.player }

    var body: some View {
        page(practice)
            // The page owns the visit; the practice view only shows and hides its panel.
            .onAppear { practice.showPanel() }
            .onDisappear { practice.leave() }
    }

    private var isCompactHeight: Bool { verticalSizeClass == .compact }

    private func page(_ practice: PracticeModel) -> some View {
        let disabledReason = blockedReason ?? screenUnavailableReason
        // One scrolling page, so a window too short for everything scrolls the waveform away with
        // the controls rather than scrolling the controls under a fixed waveform.
        return ScrollView {
            VStack(spacing: spacing.stackGap) {
                if let message = (practice.isCurrent ? player.failure : nil) ?? notice ?? practice.failure {
                    PlayerFailureText(message)
                        .controlsColumn()
                }
                if disabledReason == nil, practice.isCurrent,
                    let status = RecordingPlayerText.status(
                        player.recordingAudio, hasFailed: player.audio.hasFailed, offline: session?.isOffline == true)
                {
                    RecordingPlayerStatus(player: player, message: status)
                        .controlsColumn()
                }
                if practice.isCurrent {
                    PlaylistControlsRow()
                }
                #if os(macOS)
                    stage(practice, disabledReason: disabledReason)
                #else
                    OverviewStrip(source: practice, peaks: peaks)
                        .dimmedWhenDisabled(disabledReason != nil)
                    waveform(practice, disabledReason: disabledReason)
                        // Outside the dimming, so the reason the screen is blocked reads at full strength.
                        .overlay(alignment: .bottom) {
                            WaveformOverlay(
                                model: practice, disabledReason: disabledReason, showsReadout: !isFullPage)
                        }
                    // On a full page the readout sits under the playhead rather than over the wave.
                    if isFullPage {
                        PracticeReadout(model: practice, disabledReason: disabledReason)
                    }
                #endif
                controls(practice, disabledReason: disabledReason)
            }
            #if os(macOS)
                .padding([.horizontal, .bottom], MacStyle.pageMargin)
                .padding(.top, MacStyle.headingGap)
            #else
                .padding(16)
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: {
                    pageHeight = $0
                }
            #endif
        }
        .scrollBounceBehavior(.basedOnSize)
        .onGeometryChange(for: CGFloat.self) {
            $0.size.height
        } action: {
            viewportHeight = $0
        }
        // The keyboard covers the controls rather than squeezing the waveform, so opening a name
        // field leaves the waveform as it is.
        .ignoresSafeArea(.keyboard)
        .focusable()
        .focusEffectDisabled()
        .focused($focus, equals: .screen)
        .defaultFocus($focus, .screen)
        .modifier(
            PracticeKeys(
                model: practice, focus: $focus, isBlocked: disabledReason != nil, onDeleted: focusWaveform,
                onClose: onClose)
        )
        .onChange(of: focus) { _, _ in practice.commitNudge() }
    }

    /// The transport and the mode panels, under the waveform.
    private func controls(_ practice: PracticeModel, disabledReason: String?) -> some View {
        #if os(macOS)
            // The transport right under the stage it plays, then the mode picker over
            // its panel, so the two read as one unit.
            VStack(spacing: MacStyle.sectionGap) {
                PracticeControls(model: practice, disabledReason: disabledReason)
                VStack(spacing: 16) {
                    ModePicker(model: practice)
                    ModeControls(model: practice, onDeleted: focusWaveform)
                }
                .dimmedWhenDisabled(disabledReason != nil)
            }
            .padding(.top, MacStyle.headingGap)
            .controlsColumn()
        #else
            VStack(spacing: spacing.sectionGap) {
                // On a full page the transport leads, right under the waveform it plays.
                if isFullPage {
                    PracticeControls(model: practice, disabledReason: disabledReason)
                }
                ModePicker(model: practice)
                    .dimmedWhenDisabled(disabledReason != nil)
                if !isFullPage {
                    PracticeControls(model: practice, disabledReason: disabledReason)
                }
                ModeControls(model: practice, onDeleted: focusWaveform)
                    .dimmedWhenDisabled(disabledReason != nil)
            }
            .controlsColumn()
        #endif
    }

    #if !os(macOS)
        /// The height the window has beyond everything on the page but the waveform, less the
        /// waveform's floor; negative when the page is taller than the window and scrolls.
        private var practiceSpareHeight: CGFloat? {
            guard let viewportHeight, let pageHeight, let waveformHeight else { return nil }
            return viewportHeight - (pageHeight - waveformHeight)
                - PracticeLayout.waveformFloor(isCompactHeight: isCompactHeight)
        }

        /// The waveform's height: what the window has left, between its floor and its cap.
        private var waveformTargetHeight: CGFloat {
            PracticeLayout.waveformHeight(spare: practiceSpareHeight.map(Double.init), isCompactHeight: isCompactHeight)
        }
    #endif

    /// The waveform, which takes the height the rest of the page leaves, between its floor and its cap.
    private func waveform(_ practice: PracticeModel, disabledReason: String?) -> some View {
        PracticeWaveform(
            model: practice, peaks: peaks, focus: $focus, accessibilityFocus: $waveformFocused
        )
        .dimmedWhenDisabled(disabledReason != nil)
        #if os(macOS)
            .frame(
                minHeight: PracticeLayout.waveformFloor(isCompactHeight: isCompactHeight),
                maxHeight: PracticeLayout.waveformCap)
        #else
            .frame(height: waveformTargetHeight)
            .onGeometryChange(for: CGFloat.self) {
                $0.size.height
            } action: {
                waveformHeight = $0
            }
        #endif
    }

    #if os(macOS)
        /// The stage: a card holding the overview, the waveform with its zoom over the corner,
        /// and the readout centered under the playhead with the loop switcher at its line's start.
        private func stage(_ practice: PracticeModel, disabledReason: String?) -> some View {
            VStack(spacing: 12) {
                OverviewStrip(source: practice, peaks: peaks)
                    .dimmedWhenDisabled(disabledReason != nil)
                waveform(practice, disabledReason: disabledReason)
                    // Outside the dimming, so the zoom keeps its strength beside a blocked wave.
                    .overlay(alignment: .bottomTrailing) {
                        WaveformOverlay(model: practice, disabledReason: disabledReason, showsReadout: false)
                    }
                // The loop switcher leads the readout's line, and an equal flexible slot trails it,
                // so the readout stays centered under the playhead.
                HStack(spacing: 12) {
                    LoopSwitcher(model: practice, disabledReason: disabledReason)
                    // Outside the dimming, so the reason the screen is blocked reads at full strength.
                    PracticeReadout(model: practice, disabledReason: disabledReason)
                        .layoutPriority(1)
                    Color.clear.frame(maxWidth: .infinity, maxHeight: 0)
                }
            }
            .padding(16)
            .background(Palette.surface, in: .rect(cornerRadius: MacStyle.stageRadius))
        }
    #endif

    /// Delete loop went disabled with the loop it removed, so focus goes to the waveform rather than
    /// to nothing.
    private func focusWaveform() {
        focus = .screen
        waveformFocused = true
    }

    private var screenUnavailableReason: String? {
        RecordingScreenText.screenUnavailableReason(
            file: rows.file, downloading: transfers?.isDownloading(rows.recording.id) == true)
    }
}

extension View {
    /// Disables the view and dims it, so a blocked control reads as unavailable.
    func dimmedWhenDisabled(_ isDisabled: Bool) -> some View {
        disabled(isDisabled).opacity(isDisabled ? 0.5 : 1)
    }
}
