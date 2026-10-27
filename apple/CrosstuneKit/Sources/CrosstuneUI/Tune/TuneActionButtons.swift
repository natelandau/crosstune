import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneCommands
import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// Words the tune page's action button row adds to the ones the player and recordings already name.
public enum TuneActionText {
    public static let practice = "Practice"
    public static let stop = "Stop"
}

/// The tune page's main actions under its title: play what the tune plays, practice it, or read
/// its lyrics. A button shows only when it can act on this device now, and a tune with no such button
/// has no row.
struct TuneActionButtons: View {
    let detail: TuneDetail
    let playFirst: String
    /// Opens the lyrics reader; nil leaves Lyrics out.
    let onReadLyrics: (() -> Void)?

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(\.plan) private var plan
    @Environment(\.playerWindow) private var window
    @Environment(\.analytics) private var analytics
    @Environment(\.openURL) private var openURL
    @Environment(\.drawsGlass) private var drawsGlass
    @Environment(RecorderHost.self) private var recorders: RecorderHost?

    /// The main button: what a press does, named for it.
    struct Primary: Hashable {
        let label: String
        let symbol: String
        let action: ListRowPlay.Action
    }

    enum Action: Hashable {
        case play(Primary)
        case practice(PlayerItem)
        case lyrics
    }

    enum Layout: Equatable {
        /// The plan is unread, which would flash a button a free plan then drops, on a tune with
        /// something a button could act on.
        case holding
        case buttons([Action])
    }

    /// What a press of the main button does.
    enum Press: Equatable {
        /// Ends what the player holds, the button's own item.
        case stop
        case play(PlayerItem)
        /// Goes out to `url`, reporting `link` opened when the tune holds it.
        case open(URL, link: RecordingLink?)
        case nothing
    }

    /// The buttons the tune offers now. `holds` says whether the player holds an item.
    static func buttons(
        detail: TuneDetail, playFirst: String, recordingsPlay: Bool, planRead: Bool, showsLyrics: Bool = true,
        capturing: Bool = false, online: Bool = true, holds: (PlayerItem.Kind, String) -> Bool
    ) -> Layout {
        guard planRead else {
            // A tune with nothing a button could act on lays out no row, so it never holds one.
            let mayOffer =
                !detail.recordings.isEmpty || !detail.links.isEmpty || (showsLyrics && detail.hasLyrics)
            return mayOffer ? .holding : .buttons([])
        }
        var buttons: [Action] = []
        if let primary = primary(
            detail: detail, playFirst: playFirst, recordingsPlay: recordingsPlay, online: online, holds: holds),
            // Playing waits on a recording being recorded; a link out does not touch the audio session.
            !ListRowPlay.isBlocked(primary.action, capturing: capturing)
        {
            buttons.append(.play(primary))
        }
        if recordingsPlay, !capturing, let item = practiceItem(detail: detail, playFirst: playFirst) {
            buttons.append(.practice(item))
        }
        if showsLyrics, detail.hasLyrics { buttons.append(.lyrics) }
        return .buttons(buttons)
    }

    /// Play for what the tune plays, or nil when nothing it has can play or open now. It passes over
    /// what cannot play as a list row does, but with nothing playable it has no button. A recording
    /// only the server holds, or one downloading, plays too: the player fetches it, and a Download
    /// at the top of the page would read as downloading the tune.
    private static func primary(
        detail: TuneDetail, playFirst: String, recordingsPlay: Bool, online: Bool,
        holds: (PlayerItem.Kind, String) -> Bool
    ) -> Primary? {
        let files = Dictionary(detail.recordings.compactMap { row in row.file.map { (row.id, $0) } }) { first, _ in
            first
        }
        let (recordings, links) = ListRowPlay.playable(
            recordings: detail.recordings.map(\.recording), files: files, links: detail.links, online: online,
            loaded: { holds(.recording, $0) })
        let action: ListRowPlay.Action?
        switch rowSource(
            userTune: detail.userTune, recordings: recordings, links: links, playFirst: playFirst,
            recordingsPlay: recordingsPlay)
        {
        case .recording(let recording)?: action = .play(.recording(recording, tuneTitle: detail.tune.title))
        case .link(let link)?: action = ListRowPlay.linkAction(link)
        case nil: action = nil
        }
        switch action {
        case .play(let item)?:
            if holds(item.kind, item.id) {
                return Primary(label: TuneActionText.stop, symbol: "stop.fill", action: .play(item))
            }
            return Primary(label: MediaText.play, symbol: "play.fill", action: .play(item))
        case .open(let url, let title)?:
            return Primary(label: MediaText.open, symbol: "arrow.up.right", action: .open(url, linkTitle: title))
        case .downloading?, .inert?, nil:
            return nil
        }
    }

    /// The tune's pinned or first recording that this device holds, else the first it holds.
    private static func practiceItem(detail: TuneDetail, playFirst: String) -> PlayerItem? {
        let held = detail.recordings.filter { RecordingText.holdsAudio($0.file) }
        var chosen = held.first
        if let source = rowSource(
            userTune: detail.userTune, recordings: detail.recordings.map(\.recording), links: detail.links,
            playFirst: playFirst, recordingsPlay: true),
            case .recording(let recording) = source,
            let match = held.first(where: { $0.id == recording.id })
        {
            chosen = match
        }
        return chosen.map { PlayerItem.recording($0.recording, tuneTitle: detail.tune.title) }
    }

    private var layout: Layout {
        Self.buttons(
            detail: detail, playFirst: playFirst, recordingsPlay: plan.recordingsPlay,
            planRead: plan?.isLoaded ?? true, showsLyrics: onReadLyrics != nil,
            capturing: recorders?.isCapturing ?? false, online: session?.hasNetwork ?? true,
            holds: { player?.holds($0, id: $1) ?? false })
    }

    var body: some View {
        switch layout {
        case .holding:
            // A hidden Play holds the row's height, so nothing shifts when the plan reads.
            ActionButtonRow { button(MediaText.play, "play.fill", prominent: true) {} }
                .hidden()
                .accessibilityHidden(true)
        case .buttons(let buttons):
            if !buttons.isEmpty {
                #if os(macOS)
                    row(buttons)
                #else
                    // A label never wraps or truncates: where equal columns are too narrow for
                    // every label beside its glyph, the glyphs go, then the labels' insets tighten.
                    ViewThatFits(in: .horizontal) {
                        row(buttons)
                        row(buttons).labelStyle(.titleOnly)
                        row(buttons).labelStyle(.titleOnly).environment(\.tightActionButtonLabels, true)
                    }
                #endif
            }
        }
    }

    private func row(_ buttons: [Action]) -> some View {
        ActionButtonRow {
            ForEach(buttons, id: \.self) { item in
                switch item {
                case .play(let primary):
                    button(primary.label, primary.symbol, prominent: true) { press(primary) }
                case .practice(let item):
                    button(TuneActionText.practice, "gauge.with.needle", prominent: false) {
                        player?.open(item, in: window, playing: false, source: .tune)
                    }
                case .lyrics:
                    if let onReadLyrics {
                        button(TuneFieldLabels.lyrics, "text.quote", prominent: false, action: onReadLyrics)
                            // ViewThatFits builds only the shown candidate, so this registers once, not per candidate.
                            .lyricsZoomSource(tuneID: detail.tune.id, origin: .actionButton)
                    }
                }
            }
        }
    }

    private func button(_ title: String, _ symbol: String, prominent: Bool, action: @escaping () -> Void)
        -> some View
    {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .actionButtonLabelWidth()
        }
        .actionButtonStyle(prominent: prominent, glass: drawsGlass)
    }

    /// What pressing the main button does: Stop for the item the player holds, else Play it, or
    /// open a link out.
    static func press(
        _ action: ListRowPlay.Action, links: [RecordingLink], holds: (PlayerItem.Kind, String) -> Bool
    ) -> Press {
        switch action {
        case .play(let item):
            return holds(item.kind, item.id) ? .stop : .play(item)
        case .open(let url, _):
            return .open(url, link: links.first { LinkText.outboundURL($0.url) == url })
        case .downloading, .inert:
            return .nothing
        }
    }

    private func press(_ primary: Primary) {
        let press = Self.press(primary.action, links: detail.links) { player?.holds($0, id: $1) ?? false }
        switch press {
        case .stop:
            player?.close()
        case .play(let item):
            player?.play(item, origin: .row, source: .tune)
        case .open(let url, let link):
            if let link { analytics.linkOpened(link) }
            openURL(url)
        case .nothing:
            break
        }
    }
}
