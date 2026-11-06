import CrosstuneDesign
import SwiftUI

/// The symbols a row's action slot draws: outlined circles, and a cloud for a recording this
/// device does not hold yet.
enum RowGlyph {
    static let play = "play.circle"
    static let stop = "stop.circle"
    static let download = "icloud.and.arrow.down"
    static let linkOut = "arrow.up.right.circle"
    static let attention = "exclamationmark.circle"
    static let waiting = "clock"

    /// The speaker while it sounds, play once paused.
    static func nowPlaying(isPlaying: Bool) -> String {
        isPlaying ? "speaker.wave.2.circle" : play
    }
}

/// The size of a row's action slot and the glyph in it. Both scale with text size and stop at the
/// same point, so the glyph keeps its share of the slot and a large text size never leaves the
/// title a narrow column.
struct RowSlotMetrics: DynamicProperty {
    /// How far past its base size the slot grows: 44pt stops at 64pt.
    static let maxGrowth: CGFloat = 64 / 44

    static var baseWidth: CGFloat {
        #if os(macOS)
            MacStyle.smallControlHeight
        #else
            44
        #endif
    }

    /// The slot's width once text size has scaled `base` to `scaled`, held to ``maxGrowth``.
    nonisolated static func cappedWidth(scaled: CGFloat, base: CGFloat) -> CGFloat {
        min(scaled, base * maxGrowth)
    }

    /// The glyph's size: its base size scaled by the same factor as the capped slot.
    nonisolated static func glyphSize(scaledWidth: CGFloat, baseWidth: CGFloat, baseGlyph: CGFloat) -> CGFloat {
        baseGlyph * cappedWidth(scaled: scaledWidth, base: baseWidth) / baseWidth
    }

    @ScaledMetric(relativeTo: .title3) private var scaledWidth = Self.baseWidth
    @Environment(\.rowGlyphBase) private var baseGlyph

    var width: CGFloat { Self.cappedWidth(scaled: scaledWidth, base: Self.baseWidth) }

    var glyph: CGFloat {
        Self.glyphSize(scaledWidth: scaledWidth, baseWidth: Self.baseWidth, baseGlyph: baseGlyph)
    }
}

extension EnvironmentValues {
    /// The action glyph's size at the default text size, for the glyphs a row's slot draws.
    @Entry var rowGlyphBase: CGFloat = PageStyle.rowGlyphSize
}

/// The trailing slot of a list row: a fixed width so every row's text ends on one edge, and the
/// height its content takes, so a control in it never makes the row taller. The width scales with
/// text size up to a cap, so it holds the scaled glyph.
struct RowActionSlot<Content: View>: View {
    private let content: Content?
    private let emptyHoldsGlyphHeight: Bool
    private let metrics = RowSlotMetrics()

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
        emptyHoldsGlyphHeight = false
    }

    fileprivate init(emptyHoldingGlyphHeight: Bool) {
        content = nil
        emptyHoldsGlyphHeight = emptyHoldingGlyphHeight
    }

    var body: some View {
        Group {
            if let content {
                content
            } else {
                Color.clear
                    .frame(height: emptyHoldsGlyphHeight ? metrics.glyph : 0)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: metrics.width)
    }
}

extension RowActionSlot where Content == EmptyView {
    /// A slot with nothing in it, which keeps the row's text on its neighbors' edge. With
    /// `holdingGlyphHeight`, it is as tall as a glyph, so the row matches its neighbors' height;
    /// without it, it takes no height, so it never stretches the row.
    static func empty(holdingGlyphHeight: Bool) -> Self {
        Self(emptyHoldingGlyphHeight: holdingGlyphHeight)
    }
}

/// A row slot's symbol, at the glyph size the environment sets for the row.
struct RowGlyphImage: View {
    let systemName: String

    private let metrics = RowSlotMetrics()

    var body: some View {
        Image(systemName: systemName).font(.system(size: metrics.glyph))
    }
}

/// A control that fills a row's action slot. The frame and tap target sit on the label, since
/// neither widens a Button's hit area from outside it.
struct RowSlotButton<Label: View>: View {
    private let action: () -> Void
    private let label: Label

    init(action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
        self.action = action
        self.label = label()
    }

    var body: some View {
        Button(action: action) {
            label
                .frame(maxWidth: .infinity)
                .tapTarget()
        }
        .buttonStyle(.plain)
    }
}

/// The glyph of a playing list or tune: the speaker, animated only while it sounds and never
/// under Reduce Motion, or play once paused. Always `accent`.
struct RowNowPlayingGlyph: View {
    let isPlaying: Bool
    /// True while a recording holds the control back, which dims it as a glyph that cannot act.
    var isBlocked = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        RowGlyphImage(systemName: RowGlyph.nowPlaying(isPlaying: isPlaying))
            // The explicit style overrides a disabled button's dimming, so it dims itself.
            .foregroundStyle(isBlocked ? Palette.textTertiary : Palette.accent)
            .symbolEffect(.variableColor.iterative, options: .repeating, isActive: isPlaying && !reduceMotion)
    }
}

/// The playing list's control in a row's slot: pauses or resumes the player, and waits until
/// the list's tune has loaded. Disabled while recording, as the list's Play is. `pauseLabel`
/// names it while it sounds, `playLabel` once paused.
struct RowNowPlayingButton: View {
    let pauseLabel: String
    let playLabel: String

    @Environment(PlayerModel.self) private var player: PlayerModel?
    @Environment(ListPlayback.self) private var listPlayback: ListPlayback?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?

    var body: some View {
        // Until the tune loads, the transport still plays the tune being left.
        let settled = listPlayback?.isSettled ?? false
        let isPlaying = settled && player?.transport?.isPlaying == true
        let label = isPlaying ? pauseLabel : playLabel
        let recording = recorders?.isCapturing == true
        RowSlotButton {
            guard settled, let transport = player?.transport else { return }
            if transport.isPlaying { transport.pause() } else { transport.play() }
        } label: {
            RowNowPlayingGlyph(isPlaying: isPlaying, isBlocked: recording)
        }
        .disabled(!settled || recording)
        .accessibilityLabel(label)
        #if os(macOS)
            .help(label)
        #endif
    }
}

/// A download in progress: an indeterminate ring around a small stop square. The ring holds
/// still under Reduce Motion.
struct RowProgressRing: View {
    /// Seconds for one turn.
    nonisolated static let turnDuration = 1.0

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let metrics = RowSlotMetrics()

    /// The arc's rotation at `date`, in degrees: a pure function of the clock, so a ring that
    /// returns to the screen resumes turning, and zero under Reduce Motion.
    nonisolated static func angle(at date: Date, reduceMotion: Bool) -> Double {
        guard !reduceMotion else { return 0 }
        let turns = date.timeIntervalSinceReferenceDate / turnDuration
        return (turns - turns.rounded(.down)) * 360
    }

    var body: some View {
        let size = metrics.glyph
        ZStack {
            Circle().stroke(.textSecondary, lineWidth: 1.5)
            // Only the arc redraws each frame.
            TimelineView(.animation(paused: reduceMotion)) { context in
                Circle()
                    .trim(from: 0, to: 0.25)
                    .stroke(.textPrimary, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                    .rotationEffect(.degrees(Self.angle(at: context.date, reduceMotion: reduceMotion)))
            }
            RoundedRectangle(cornerRadius: 1.5)
                .fill(.textPrimary)
                .frame(width: size * 0.3, height: size * 0.3)
        }
        .frame(width: size, height: size)
    }
}
