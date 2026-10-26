import CrosstuneAnalytics
import CrosstuneStore
import SwiftUI

/// Words the practice screen's reading pane and its toggle show.
enum PadPracticeText {
    static let showReading = "Show scans and lyrics"
    static let hideReading = "Hide scans and lyrics"
    static let scans = "Scans"
    static let lyrics = "Lyrics"
    /// The pane's Scans and Lyrics control, for VoiceOver.
    static let reading = "Scans and lyrics"
}

extension EnvironmentValues {
    /// Whether the practice screen sets the playing tune's scans and lyrics beside practice, as
    /// the iPad's practice cover does. Everywhere else practice shows by itself.
    @Entry var showsReadingPane = false
    /// Whether the practice screen around this view has scans or lyrics to show, so its header
    /// offers to hide or show them.
    @Entry var readingPaneHasContent = false
    /// The widest practice grows while it has the screen to itself, or nil for no limit.
    @Entry var padPracticeMaxWidth: CGFloat?
    /// The window's practice screen visit, held above its shells so a size change keeps it.
    @Entry var padPracticeVisit: PadPracticeVisit?
}

/// Which loaded item the window's ``PadPracticeScreen`` has reported, so it reports once per visit to an item.
/// A size change swaps the window's shell and with it the practice screen, which appears again for
/// the same item; only closing the player ends the visit.
@MainActor final class PadPracticeVisit {
    private struct Key: Equatable {
        let kind: PlayerItem.Kind
        let id: String
    }

    private struct Reading: Hashable {
        let tuneID: String
        let choice: ReadingChoice
    }

    private var reported: Key?
    private var openedReported = false
    /// The visit's first tune, and each reading reported since.
    private var firstTuneID: String?
    private var readingsReported: Set<Reading> = []

    /// Whether the practice screen for `item` has been reported this visit, for
    /// ``View/screenView(_:visit:stillShown:)``.
    func binding(for item: PlayerItem?) -> Binding<Bool> {
        let key = item.map { Key(kind: $0.kind, id: $0.id) }
        return Binding {
            key != nil && self.reported == key
        } set: { isReported in
            self.reported = isReported ? key : nil
            if !isReported { self.ended() }
        }
    }

    /// The event for the screen's first tune of this visit, or nil once the visit has reported. A
    /// list advancing to its next tune is the same visit. The tune is known only once the screen
    /// has read it, so this is sent then rather than with the screen view.
    func opened(tuneID: String) -> AnalyticsEvent? {
        guard !openedReported else { return nil }
        openedReported = true
        if firstTuneID == nil { firstTuneID = tuneID }
        return .padPracticeOpened(tuneID: tuneID)
    }

    /// The event for the reading pane showing `choice` of `tuneID`, or nil when it reports
    /// nothing. Only the first tune's reading and a segment the musician `picked` report, each
    /// once a visit, so a list moving on to its next tune is not counted as a view.
    func readingShown(_ choice: ReadingChoice, tuneID: String, picked: Bool) -> AnalyticsEvent? {
        let firstTuneID = firstTuneID ?? tuneID
        self.firstTuneID = firstTuneID
        guard picked || tuneID == firstTuneID,
            readingsReported.insert(Reading(tuneID: tuneID, choice: choice)).inserted
        else { return nil }
        return switch choice {
        case .scans: .scanViewed(tuneID: tuneID)
        case .lyrics: .lyricsOpened(tuneID: tuneID)
        }
    }

    /// Ends the visit, so the next one reports again.
    func ended() {
        openedReported = false
        firstTuneID = nil
        readingsReported = []
    }

    /// Whether the practice screen leaving the window ends the visit: the player closed or let go of the
    /// item, rather than a size change swapping the screen out.
    nonisolated static func ends(isExpanded: Bool, hasItem: Bool) -> Bool {
        !isExpanded || !hasItem
    }
}

extension PadPracticeLayout {
    /// Where the device remembers that the musician hid the reading pane.
    static let readingHiddenKey = "crosstune.readingPaneHidden"
}

/// Practice beside the playing tune's scans and lyrics on the iPad, in the arrangement
/// ``PadPracticeLayout`` picks for the window. Passes `practice` through unchanged wherever
/// ``EnvironmentValues/showsReadingPane`` is false, as on the iPhone and the Mac.
struct PadPracticeScreen<Practice: View>: View {
    private let player: PlayerModel
    private let source: Source
    private let practice: Practice

    private enum Source {
        /// Follows what plays, through the store.
        case store
        /// Shows this reading, as for a snapshot.
        case fixed(ReadingPaneContent?)
    }

    @Environment(\.showsReadingPane) private var showsReadingPane
    @Environment(\.padPracticeVisit) private var windowVisit
    /// Replaces the window's visit where no shell holds one, as in a preview.
    @State private var ownVisit = PadPracticeVisit()

    init(player: PlayerModel, @ViewBuilder practice: () -> Practice) {
        self.player = player
        source = .store
        self.practice = practice()
    }

    /// Shows `reading` rather than reading the store, as for a snapshot.
    init(player: PlayerModel, reading: ReadingPaneContent?, @ViewBuilder practice: () -> Practice) {
        self.player = player
        source = .fixed(reading)
        self.practice = practice()
    }

    var body: some View {
        if showsReadingPane {
            PadPracticePanes(player: player, fixed: fixedReading, visit: windowVisit ?? ownVisit, practice: practice)
                .screenView(.padPractice, visit: (windowVisit ?? ownVisit).binding(for: player.item)) {
                    PadPracticeVisit.ends(isExpanded: player.isExpanded, hasItem: player.item != nil)
                }
        } else {
            practice
        }
    }

    private var fixedReading: ReadingPaneContent?? {
        guard case .fixed(let reading) = source else { return nil }
        return .some(reading)
    }
}

/// The panes, laid out for the window and what there is to read.
private struct PadPracticePanes<Practice: View>: View {
    let player: PlayerModel
    /// A reading to show in place of the store's, or nil to follow what plays.
    let fixed: ReadingPaneContent??
    let visit: PadPracticeVisit
    let practice: Practice

    @Environment(\.analytics) private var analytics
    @Environment(\.store) private var store
    @Environment(\.plan) private var plan
    @Environment(ListPlayback.self) private var playback: ListPlayback?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.practiceGround) private var ground
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(PadPracticeLayout.readingHiddenKey) private var readingHidden = false
    /// Nil inside until the first read, so the panes can wait for it.
    @State private var query: LiveQuery<ReadingPaneTune?>?
    @State private var size = CGSize.zero
    /// Practice's laid-out height, and the least it can have with its controls whole.
    @State private var practiceHeight: CGFloat?
    @State private var practiceMinimum: CGFloat?
    /// Whether the panes have shown, after which they never hide again.
    @State private var revealed = false

    /// The longest the panes wait to settle before they show anyway.
    private static var settleLimit: Duration { .seconds(1) }

    /// What decides the tune to read: the loaded item, and the tune a playing list is on.
    private struct ReadingKey: Equatable {
        let store: ObjectIdentifier?
        let kind: PlayerItem.Kind?
        let itemID: String?
        let listTuneID: String?
    }

    private var listTuneID: String? {
        playback?.isActive == true ? playback?.currentTuneID : nil
    }

    /// The reading once it has been read, as nil inside when there is nothing to read; nil
    /// while it is still being read.
    private var read: ReadingPaneContent?? {
        if let fixed { return fixed }
        guard store != nil else { return .some(nil) }
        return query?.value.map(\.reading)
    }

    /// What there is to read, less scans the plan does not open, which have nothing to show.
    private var reading: ReadingPaneContent? {
        guard let reading = read ?? nil else { return nil }
        return reading.withScans(opening: plan?.plan.scansOpen ?? true)
    }

    /// The tune on the practice screen, whether or not it has anything to read.
    private var tuneID: String? {
        if let fixed { return fixed?.tuneID }
        return query?.value?.tuneID
    }

    /// A recording's practice reports the height its controls need; a link's reports none, so it
    /// stacks at its share.
    private func isSettled(_ arrangement: PadPracticeLayout) -> Bool {
        PadPracticeLayout.isSettled(
            arrangement, hasRead: read != nil, practiceMeasures: player.item?.kind == .recording,
            hasPracticeMinimum: practiceMinimum != nil)
    }

    var body: some View {
        // Nothing lays out until the window is measured, and nothing shows until the panes have
        // settled, so practice never opens in a guessed arrangement and moves to the real one.
        Color.clear
            .onGeometryChange(for: CGSize.self) {
                $0.size
            } action: {
                size = $0
            }
            .overlay {
                if size != .zero {
                    panes
                }
            }
            .background {
                if let ground {
                    PhoneStyle.practiceGround(ground).ignoresSafeArea()
                }
            }
            // The panes stay dark on the ground, while the viewer over them takes the appearance
            // outside, as it does everywhere else.
            .environment(\.colorScheme, .dark)
            // The shell's viewer cannot present over this cover, so the pane's scans open their
            // own, without a zoom, since nothing behind the cover is where they came from.
            .modifier(ScanScreens(zooms: false))
            .environment(\.colorScheme, ground ?? colorScheme)
            .task(id: key) {
                guard fixed == nil, let store else {
                    query = nil
                    return
                }
                let item = player.item
                let listTuneID = listTuneID
                // The last tune's reading holds until the next one's has been read, so a skip
                // slides from one to the other rather than through practice alone.
                query = LiveQuery(store, initial: query?.value) {
                    try ReadingPaneContent.read($0, item: item, listTuneID: listTuneID)
                }
            }
    }

    /// Practice's height when the panes stack: its share of the window, or more where its
    /// controls would clip, which win over the reading pane down to its least share.
    private var stackedPracticeHeight: CGFloat {
        let share = size.height * PadPracticeLayout.stackedPracticeShare(size)
        let most = size.height * (1 - PadStyle.readingPaneMinShare)
        return max(share, min(most, practiceMinimum ?? 0))
    }

    @ViewBuilder private var panes: some View {
        let reading = reading
        let arrangement = PadPracticeLayout.arrange(
            size: size, hasReading: reading != nil, readingHidden: readingHidden,
            isAccessibilitySize: dynamicTypeSize.isAccessibilitySize)
        // One layout whose axis changes, rather than a stack per arrangement, so practice keeps
        // its identity, and with it its state, as the window turns or the pane hides.
        let layout = arrangement == .stacked ? AnyLayout(VStackLayout(spacing: 0)) : AnyLayout(HStackLayout(spacing: 0))
        layout {
            practice
                .environment(\.readingPaneHasContent, reading != nil)
                .environment(
                    \.padPracticeMaxWidth, arrangement == .practiceOnly ? PadStyle.padPracticeControlsMaxWidth : nil
                )
                .frame(
                    width: arrangement == .sideBySide ? size.width * PadStyle.padPracticeShare : nil,
                    height: arrangement == .stacked ? stackedPracticeHeight : nil
                )
                .onGeometryChange(for: CGFloat.self) {
                    $0.size.height
                } action: {
                    practiceHeight = $0
                }
                .onPreferenceChange(PracticeSpareHeight.self) { spareHeight in
                    guard let spareHeight, let practiceHeight else { return }
                    let minimum = (practiceHeight - spareHeight).rounded(.up)
                    // A point either way is layout rounding, not a change worth a new layout.
                    if abs(minimum - (practiceMinimum ?? 0)) > 1 { practiceMinimum = minimum }
                }
            if arrangement != .practiceOnly, let reading {
                // A skip slides the next tune's pane in over the last; the stack keeps both in
                // one place while they pass.
                ZStack {
                    ReadingPane(reading: reading, visit: visit)
                        .id(reading.tuneID)
                        .phoneTransition(.push(from: .trailing))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // Laid out while hidden, so practice can report what its controls need.
        .opacity(revealed ? 1 : 0)
        .onChange(of: tuneID, initial: true) { _, tuneID in
            if let tuneID, let event = visit.opened(tuneID: tuneID) { analytics.send(event) }
        }
        .onChange(of: isSettled(arrangement), initial: true) { _, settled in
            if settled { revealed = true }
        }
        // Practice that never measures, as before its recording loads, or a read that never
        // finishes, still shows the panes, and with them the close button, at their shares.
        .task {
            try? await Task.sleep(for: Self.settleLimit)
            revealed = true
        }
        // Hidden, the panes move at once, so the reveal never lands partway through a move.
        .phoneAnimation(.snappy, value: revealed ? arrangement : nil)
        .phoneAnimation(.snappy, value: revealed ? reading?.tuneID : nil)
    }

    private var key: ReadingKey {
        ReadingKey(
            store: store.map(ObjectIdentifier.init), kind: player.item?.kind, itemID: player.item?.id,
            listTuneID: listTuneID)
    }
}

/// How much height practice could give up before its controls clip, negative when they
/// already do, reported up to the practice screen that sizes it.
struct PracticeSpareHeight: PreferenceKey {
    static let defaultValue: CGFloat? = nil

    static func reduce(value: inout CGFloat?, nextValue: () -> CGFloat?) {
        value = nextValue() ?? value
    }
}

/// The header's button that hides or shows the reading pane, remembered on this device.
struct ReadingPaneToggle: View {
    @AppStorage(PadPracticeLayout.readingHiddenKey) private var hidden = false

    var body: some View {
        let title = hidden ? PadPracticeText.showReading : PadPracticeText.hideReading
        Button {
            hidden.toggle()
        } label: {
            Label(title, systemImage: "rectangle.split.2x1")
        }
        .help(title)
    }
}

/// Caps practice at the width the practice screen gives it while it has the screen to itself, centered.
struct PadPracticeWidth: ViewModifier {
    @Environment(\.padPracticeMaxWidth) private var maxWidth

    func body(content: Content) -> some View {
        if let maxWidth {
            content
                .frame(maxWidth: maxWidth)
                .frame(maxWidth: .infinity)
        } else {
            content
        }
    }
}

/// What the practice screen's header shows under the title.
@MainActor
enum PadPracticeHeader {
    /// The playing list and the tune's place in it while a list plays on the practice screen, otherwise
    /// the recording's own subtitle.
    static func subtitle(
        recording: Recording, tuneTitle: String?, lengthMs: Int64?, place: String? = nil, playback: ListPlayback?,
        showsReadingPane: Bool
    ) -> String? {
        if showsReadingPane, let listed = PlayerBar.playlistSubtitle(playback) { return listed }
        return RecordingScreenText.subtitle(recording, tuneTitle: tuneTitle, lengthMs: lengthMs, place: place)
    }

    /// A link's subtitle: the playing list and the tune's place in it while a list plays,
    /// otherwise the album track the link plays, if any.
    static func linkSubtitle(player: PlayerModel, playback: ListPlayback?) -> String? {
        PlayerBar.playlistSubtitle(playback) ?? PlayerBar.subtitle(player)
    }
}
