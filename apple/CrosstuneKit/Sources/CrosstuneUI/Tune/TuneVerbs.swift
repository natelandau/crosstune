import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import SwiftUI

/// Words the tune page's verb row adds to the ones the player and recordings already name.
public enum TuneVerbsText {
    public static let practice = "Practice"
    public static let stop = "Stop"
}

/// The tune page's main actions under its title: play what the tune plays, practice it, or read
/// its lyrics. A verb shows only when it can act on this device now, and a tune with no such verb
/// has no row.
struct TuneVerbs: View {
    let detail: TuneDetail
    let playFirst: String
    /// Opens the lyrics reader; nil leaves Lyrics out.
    let onReadLyrics: (() -> Void)?

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(RecordingTransferActions.self) private var transfers: RecordingTransferActions?
    @Environment(\.plan) private var plan
    @Environment(\.playerWindow) private var window
    @Environment(\.analytics) private var analytics
    @Environment(\.openURL) private var openURL
    @Environment(\.drawsGlass) private var drawsGlass
    @Environment(RecorderHost.self) private var recorders: RecorderHost?

    /// The main verb: what a press does, named for it.
    struct Primary: Hashable {
        let label: String
        let symbol: String
        let action: ListRowPlay.Action
    }

    enum Verb: Hashable {
        case play(Primary)
        case practice(PlayerItem)
        case lyrics
    }

    enum Layout: Equatable {
        /// The plan is unread, which would flash a verb a free plan then drops, on a tune with
        /// something a verb could act on.
        case holding
        case verbs([Verb])
    }

    /// What a press of the main verb does.
    enum Press: Equatable {
        /// Ends what the player holds, the verb's own item.
        case stop
        case play(PlayerItem)
        /// Goes out to `url`, reporting `link` opened when the tune holds it.
        case open(URL, link: RecordingLink?)
        case nothing
    }

    /// The verbs the tune offers now. `holds` says whether the player holds an item.
    static func verbs(
        detail: TuneDetail, playFirst: String, recordingsPlay: Bool, planRead: Bool, showsLyrics: Bool = true,
        capturing: Bool = false, holds: (PlayerItem.Kind, String) -> Bool,
        downloading: (String) -> Bool = { _ in false }
    ) -> Layout {
        guard planRead else {
            // A tune with nothing a verb could act on lays out no row, so it never holds one.
            let mayOffer =
                !detail.recordings.isEmpty || !detail.links.isEmpty || (showsLyrics && detail.hasLyrics)
            return mayOffer ? .holding : .verbs([])
        }
        var verbs: [Verb] = []
        if let primary = primary(
            detail: detail, playFirst: playFirst, recordingsPlay: recordingsPlay, holds: holds,
            downloading: downloading),
            // Playing waits on a take being recorded; a link out does not touch the audio session.
            !ListRowPlay.isBlocked(primary.action, capturing: capturing)
        {
            verbs.append(.play(primary))
        }
        if recordingsPlay, !capturing, let item = practiceItem(detail: detail, playFirst: playFirst) {
            verbs.append(.practice(item))
        }
        if showsLyrics, detail.hasLyrics { verbs.append(.lyrics) }
        return .verbs(verbs)
    }

    /// Play for what the row would play, or nil when that is a recording this device does not
    /// hold, which its own row downloads.
    private static func primary(
        detail: TuneDetail, playFirst: String, recordingsPlay: Bool, holds: (PlayerItem.Kind, String) -> Bool,
        downloading: (String) -> Bool
    ) -> Primary? {
        guard
            let action = detail.playAction(
                playFirst: playFirst, loaded: { holds(.recording, $0) }, downloading: downloading,
                recordingsPlay: recordingsPlay)
        else { return nil }
        switch action {
        case .play(let item):
            if holds(item.kind, item.id) {
                return Primary(label: TuneVerbsText.stop, symbol: "stop.fill", action: action)
            }
            if item.kind == .recording, !heldHere(item.id, in: detail) { return nil }
            return Primary(label: MediaText.play, symbol: "play.fill", action: action)
        case .open:
            return Primary(label: MediaText.open, symbol: "arrow.up.right", action: action)
        case .downloading, .inert:
            return nil
        }
    }

    private static func heldHere(_ recordingID: String, in detail: TuneDetail) -> Bool {
        detail.recordings.first { $0.id == recordingID }.map { RecordingText.holdsAudio($0.file) } ?? false
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
        Self.verbs(
            detail: detail, playFirst: playFirst, recordingsPlay: plan.recordingsPlay,
            planRead: plan?.isLoaded ?? true, showsLyrics: onReadLyrics != nil,
            capturing: recorders?.isCapturing ?? false,
            holds: { player?.holds($0, id: $1) ?? false }, downloading: { transfers?.isDownloading($0) ?? false })
    }

    var body: some View {
        switch layout {
        case .holding:
            // A hidden Play stands in at the row's height, so nothing shifts when the plan reads.
            VerbRow { button(MediaText.play, "play.fill", prominent: true) {} }
                .hidden()
                .accessibilityHidden(true)
        case .verbs(let verbs):
            if !verbs.isEmpty {
                #if os(macOS)
                    row(verbs)
                #else
                    // A label never wraps or truncates: where equal columns are too narrow for
                    // every label beside its glyph, the glyphs go, then the labels' insets tighten.
                    ViewThatFits(in: .horizontal) {
                        row(verbs)
                        row(verbs).labelStyle(.titleOnly)
                        row(verbs).labelStyle(.titleOnly).environment(\.tightVerbLabels, true)
                    }
                #endif
            }
        }
    }

    private func row(_ verbs: [Verb]) -> some View {
        VerbRow {
            ForEach(verbs, id: \.self) { verb in
                switch verb {
                case .play(let primary):
                    button(primary.label, primary.symbol, prominent: true) { press(primary) }
                case .practice(let item):
                    button(TuneVerbsText.practice, "gauge.with.needle", prominent: false) {
                        player?.open(item, in: window, playing: false, source: .tune)
                    }
                case .lyrics:
                    if let onReadLyrics {
                        button(TuneFieldLabels.lyrics, "text.quote", prominent: false, action: onReadLyrics)
                            .lyricsZoomSource(tuneID: detail.tune.id, origin: .verb)
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
                .verbLabelWidth()
        }
        .verbStyle(prominent: prominent, glass: drawsGlass)
    }

    /// What pressing the main verb does: Stop for the item the player holds, else Play it, or
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

extension TuneDetail {
    /// What the tune's play button does, chosen as a list row chooses it.
    func playAction(
        playFirst: String, loaded: (String) -> Bool, downloading: (String) -> Bool, recordingsPlay: Bool
    ) -> ListRowPlay.Action? {
        ListRowPlay.action(
            tuneTitle: tune.title, userTune: userTune, recordings: recordings.map(\.recording),
            files: Dictionary(recordings.compactMap { row in row.file.map { (row.id, $0) } }) { first, _ in first },
            links: links, playFirst: playFirst, loaded: loaded, downloading: downloading,
            recordingsPlay: recordingsPlay)
    }
}
