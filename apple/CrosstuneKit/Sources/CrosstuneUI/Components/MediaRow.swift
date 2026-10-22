import CrosstuneAnalytics
import SwiftUI

/// The row shape recordings and links share: a fixed glyph slot for the item's state, the title,
/// a second line, the site an imported recording came from, the tune line for a filed recording,
/// a red line for a transfer error, and Retry at the trailing edge.
///
/// The row is the control. Its spoken name is its verb plus the lines it shows.
public struct MediaRow: View {
    /// The line under the title.
    public enum SecondLine {
        /// Metadata, already joined.
        case text(String)
        /// A link out: its visible text, where it goes, and its spoken name.
        case link(String, URL, name: String)
    }

    /// The retry a stuck row offers: its spoken name and what it does.
    public struct Retry {
        public let name: String
        public let action: () -> Void

        public init(name: String, action: @escaping () -> Void) {
            self.name = name
            self.action = action
        }
    }

    /// The line naming the site an imported recording came from, which opens its page there.
    public struct SourceLine: Equatable {
        public let title: String
        public let url: URL

        public init(title: String, url: URL) {
            self.title = title
            self.url = url
        }

        /// The line's spoken name, the one the Open on action carries.
        public var name: String { RecordingRowActions.openOn(title) }
    }

    /// The line naming a filed recording's tune, which opens the tune.
    public struct TuneLine {
        public let title: String
        public let action: () -> Void

        public init(title: String, action: @escaping () -> Void) {
            self.title = title
            self.action = action
        }

        /// The line's spoken name, which says it leads to the tune.
        public var name: String { RecordingsListText.openTune(title) }
    }

    private let glyph: MediaGlyph
    private let title: String
    private let secondLine: SecondLine?
    private let verb: String?
    private let action: (() -> Void)?
    private let sourceLine: SourceLine?
    private let tuneLine: TuneLine?
    private let error: String?
    private let notice: String?
    private let spokenNotice: String?
    private let retry: Retry?
    /// How far a row that cannot act fades. Scans the plan does not open fade the same.
    static let dimmedOpacity = 0.6
    private let isDimmed: Bool

    @ScaledMetric(relativeTo: .headline) private var scaledSlot: CGFloat = 44
    @Environment(\.spacing) private var spacing
    @Environment(\.openURL) private var openURL
    @Environment(\.hangsMediaGlyph) private var hangsGlyph
    @Environment(\.mediaNoticeInHeading) private var noticeInHeading
    #if os(macOS)
        @State private var isHovered = false
    #endif

    /// `verb` names what the row does or would do, "Play" or "Downloading"; with no `action` the
    /// row is inert. `dimmed` marks a row whose control cannot act right now, such as a download
    /// offline. `spokenNotice` is spoken after the row's lines and never shown.
    public init(
        glyph: MediaGlyph, title: String, secondLine: SecondLine?, verb: String? = nil,
        action: (() -> Void)? = nil, sourceLine: SourceLine? = nil, tuneLine: TuneLine? = nil,
        error: String? = nil, notice: String? = nil, spokenNotice: String? = nil, retry: Retry? = nil,
        dimmed: Bool = false
    ) {
        self.glyph = glyph
        self.title = title
        self.secondLine = secondLine
        self.verb = verb
        self.action = action
        self.sourceLine = sourceLine
        self.tuneLine = tuneLine
        self.error = error
        self.notice = notice
        self.spokenNotice = spokenNotice
        self.retry = retry
        isDimmed = dimmed
    }

    /// The row control's spoken name: the verb and the lines it shows, a comma between lines.
    nonisolated public static func accessibilityName(verb: String?, title: String, details: [String]) -> String {
        let first = verb.map { "\($0) \(title)" } ?? title
        return ([first] + details).joined(separator: ", ")
    }

    public var body: some View {
        HStack(alignment: rowAlignment, spacing: hangs ? Self.hangingGap : spacing(4)) {
            glyphView
                // Past this the slot takes the width the title needs to wrap into.
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                .frame(width: hangs ? Self.hangingSlot : slot, height: hangs ? nil : glyphHeight)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: spacing.rowLineGap) {
                Text(title)
                    .contentMask()
                    .font(Self.titleFont)
                    .rowLineLimit()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                if case .text(let meta) = secondLine {
                    Text(meta)
                        .font(Self.lineFont)
                        .monospacedDigit()
                        .foregroundStyle(.inkSecondary)
                        .rowLineLimit()
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                ForEach(Array(lineControls.enumerated()), id: \.offset) { _, control in
                    innerControl(control)
                }
                if let notice, !noticeInHeading {
                    Text(notice)
                        .font(Self.smallFont)
                        .foregroundStyle(.inkSecondary)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                if let error {
                    Text(error)
                        .font(Self.smallFont)
                        .foregroundStyle(.red)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            Spacer(minLength: 0)
            ForEach(Array(trailingControls.enumerated()), id: \.offset) { _, control in
                innerControl(control)
                    #if os(macOS)
                        // On the title's first baseline, as the glyph keeps to the title's line.
                        .alignmentGuide(.top) { $0[.firstTextBaseline] - Self.titleAscent }
                    #endif
            }
        }
        #if os(macOS)
            .frame(minHeight: hangs ? nil : slot)
        #endif
        .padding(.vertical, hangs ? Self.hangingRowInset : 0)
        .opacity(isDimmed ? Self.dimmedOpacity : 1)
        // The whole row answers a tap, under the link out and Retry, which keep their own.
        .background { rowControl }
        .padding(.leading, hangs ? -Self.hangingIndent : 0)
        #if os(macOS)
            .onHover { isHovered = $0 && action != nil }
        #endif
        .accessibilityElement(children: .contain)
    }

    /// Whether the glyph hangs in a page's glyph column, left of the row's leading edge, so the
    /// title starts on the page's text edge.
    private var hangs: Bool { hangsGlyph }

    /// On the Mac the glyph keeps to the title's line however many lines follow it; on iOS it
    /// centers in its square.
    private var rowAlignment: VerticalAlignment {
        if hangs { return .firstTextBaseline }
        #if os(macOS)
            return .top
        #else
            return .center
        #endif
    }

    private var glyphHeight: CGFloat {
        #if os(macOS)
            MacStyle.mediaTitleLineHeight
        #else
            slot
        #endif
    }

    #if os(macOS)
        private static let hangingSlot = MacStyle.pageGlyphColumn - MacStyle.pageGlyphGap
        private static let hangingGap = MacStyle.pageGlyphGap
        private static let hangingIndent = MacStyle.pageGlyphColumn
        /// Room above and below a page's row, inside its hit area.
        private static let hangingRowInset: CGFloat = 4
    #else
        private static let hangingSlot: CGFloat = 0
        private static let hangingGap: CGFloat = 0
        private static let hangingIndent: CGFloat = 0
        private static let hangingRowInset: CGFloat = 0
    #endif

    @ViewBuilder private var rowControl: some View {
        if let action {
            Button(action: action) { Color.clear.contentShape(.rect) }
                .buttonStyle(.plain)
                .accessibilityLabel(rowName)
        } else {
            Color.clear
                .accessibilityElement()
                .accessibilityLabel(rowName)
        }
    }

    /// A control inside the row, over the row's own.
    enum InnerControl {
        case linkOut(String, URL, name: String)
        case sourceLine(SourceLine)
        case tuneLine(TuneLine)
        case retry(Retry)

        var name: String {
            switch self {
            case .linkOut(_, _, let name): name
            case .sourceLine(let line): line.name
            case .tuneLine(let line): line.name
            case .retry(let retry): retry.name
            }
        }

        /// Whether it sits at the row's trailing edge rather than among its lines.
        var isTrailing: Bool {
            if case .retry = self { return true }
            return false
        }
    }

    /// The row's inner controls in reading order. The body draws them from this list, so
    /// ``controlNames`` names what the row shows.
    var innerControls: [InnerControl] {
        var controls: [InnerControl] = []
        if case .link(let text, let url, let name) = secondLine { controls.append(.linkOut(text, url, name: name)) }
        if let sourceLine { controls.append(.sourceLine(sourceLine)) }
        if let tuneLine { controls.append(.tuneLine(tuneLine)) }
        if let retry { controls.append(.retry(retry)) }
        return controls
    }

    private var lineControls: [InnerControl] { innerControls.filter { !$0.isTrailing } }

    /// Whether the lines under the meta stack as full 44 point rows. One line's target reaches
    /// into the space around it without growing the row; two padded that way would overlap,
    /// and the later one would take the earlier one's taps.
    var stacksLineControls: Bool { lineControls.count > 1 }

    private var trailingControls: [InnerControl] { innerControls.filter(\.isTrailing) }

    @ViewBuilder private func innerControl(_ control: InnerControl) -> some View {
        switch control {
        case .linkOut(let text, let url, let name): linkOut(text, url: url, name: name)
        case .sourceLine(let line): sourceLineButton(line)
        case .tuneLine(let line): tuneLineButton(line)
        case .retry(let retry): retryButton(retry)
        }
    }

    /// A line of text that opens a page outside the app.
    private func linkOut(_ text: String, url: URL, name: String) -> some View {
        Link(destination: url) {
            HStack(spacing: 4) {
                Text(text)
                Image(systemName: "arrow.up.right")
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
            .font(Self.lineFont)
            #if os(macOS)
                .macHoverAccent()
            #endif
            .lineTarget(stacked: stacksLineControls, reach: 12)
        }
        .buttonStyle(.plain)
        #if !os(macOS)
            .foregroundStyle(.tint)
        #endif
        .accessibilityLabel(name)
    }

    /// Opens the page outside the app. Drawn as the tune line is, as wide as its text.
    private func sourceLineButton(_ line: SourceLine) -> some View {
        Button {
            openURL(line.url)
        } label: {
            HStack(spacing: 4) {
                Text(line.title)
                    .contentMask()
                    .lineLimit(1)
                Image(systemName: "arrow.up.right.square")
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
            .font(Self.smallFont)
            #if os(macOS)
                .macHoverAccent()
            #else
                .foregroundStyle(.secondary)
            #endif
            .lineTarget(stacked: stacksLineControls, reach: 14)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(line.name)
    }

    /// Its own control over the row's, so a tap on the tune's name opens the tune rather than
    /// playing. Only as wide as its text, leaving the rest of the line to the row.
    private func tuneLineButton(_ line: TuneLine) -> some View {
        Button(action: line.action) {
            HStack(spacing: 4) {
                Text(line.title)
                    .contentMask()
                    .lineLimit(1)
                Image(systemName: "chevron.right")
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
            .font(Self.smallFont)
            #if os(macOS)
                .macHoverAccent()
            #else
                .foregroundStyle(.secondary)
            #endif
            .lineTarget(stacked: stacksLineControls, reach: 14)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(line.name)
    }

    private func retryButton(_ retry: Retry) -> some View {
        #if os(macOS)
            Button(MediaText.retry, action: retry.action)
                .buttonStyle(.mac(.secondary, size: .small))
                .accessibilityLabel(retry.name)
        #else
            Button(action: retry.action) {
                Text(MediaText.retry)
                    .font(Self.lineFont.weight(.semibold))
                    .frame(minWidth: slot, minHeight: slot)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)
            .accessibilityLabel(retry.name)
        #endif
    }

    /// The spoken names of the row's control and of each control inside it, in reading order.
    var controlNames: [String] {
        [rowName] + innerControls.map(\.name)
    }

    private var rowName: String {
        var details: [String] = []
        if case .text(let meta) = secondLine { details.append(meta) }
        if let notice { details.append(notice) }
        if let error { details.append(error) }
        if let spokenNotice { details.append(spokenNotice) }
        return Self.accessibilityName(verb: verb, title: title, details: details)
    }

    /// The glyph's square, smaller on the Mac where a pointer needs no 44 point target.
    private var slot: CGFloat {
        #if os(macOS)
            MacStyle.mediaGlyphSlot
        #else
            min(scaledSlot, 64)
        #endif
    }

    #if os(macOS)
        private static let titleFont = MacStyle.body
        /// How far the title's first baseline sits below its top, where a row aligned to its top
        /// sets a trailing control's baseline.
        nonisolated private static let titleAscent = NSFont.systemFont(ofSize: MacStyle.bodySize).ascender
        private static let lineFont = MacStyle.secondary
        private static let smallFont = MacStyle.secondary
        private static let glyphFont = Font.system(size: 13)
    #else
        private static let titleFont = Font.headline
        private static let lineFont = Font.subheadline
        private static let smallFont = Font.footnote
        private static let glyphFont = Font.title3
    #endif

    /// A glyph for what a tap would start: ink, and on the Mac the accent while the pointer
    /// is over the row, so the row reads as the control.
    private var idleGlyphStyle: AnyShapeStyle {
        #if os(macOS)
            isHovered ? AnyShapeStyle(MacPalette.accent) : AnyShapeStyle(MacPalette.ink)
        #else
            AnyShapeStyle(.primary)
        #endif
    }

    private static var loadedGlyphStyle: AnyShapeStyle {
        #if os(macOS)
            AnyShapeStyle(.tint)
        #else
            AnyShapeStyle(.primary)
        #endif
    }

    @ViewBuilder private var glyphView: some View {
        switch glyph {
        case .play:
            Image(systemName: "play.fill").font(Self.glyphFont).foregroundStyle(idleGlyphStyle)
        case .stop:
            Image(systemName: "stop.fill").font(Self.glyphFont).foregroundStyle(Self.loadedGlyphStyle)
        case .download:
            Image(systemName: "icloud.and.arrow.down").font(Self.glyphFont).foregroundStyle(idleGlyphStyle)
        case .downloading:
            ProgressView().controlSize(.small)
        case .attention:
            Image(systemName: "exclamationmark.circle").font(Self.glyphFont).foregroundStyle(.inkSecondary)
        case .waiting:
            Image(systemName: "clock").font(Self.glyphFont).foregroundStyle(.inkSecondary)
        case .none:
            Color.clear
        }
    }
}

extension EnvironmentValues {
    /// True on a page whose media rows hang their glyphs in the page's glyph column.
    @Entry var hangsMediaGlyph = false
    /// True where a section says its rows' notice once, so each row only speaks it.
    @Entry var mediaNoticeInHeading = false
}

#if os(macOS)
    /// A link line's ink: secondary at rest, the accent under the pointer, so the accent stays
    /// for what the musician is about to act on. A selected row's lines follow the selection's
    /// secondary ink instead, since the accent holds 4.5:1 on neither the emphasized fill nor
    /// the dark gray one.
    struct MacHoverAccent: ViewModifier {
        @State private var isHovered = false
        @Environment(\.backgroundProminence) private var prominence
        @Environment(\.macRowSelected) private var rowSelected

        nonisolated static func token(hovered: Bool, emphasized: Bool, rowSelected: Bool) -> MacPalette.Token {
            if hovered, !emphasized, !rowSelected { return .accent }
            return MacSecondaryInk.token(emphasized: emphasized, rowSelected: rowSelected)
        }

        func body(content: Content) -> some View {
            content
                .foregroundStyle(
                    MacPalette.color(
                        Self.token(hovered: isHovered, emphasized: prominence == .increased, rowSelected: rowSelected))
                )
                .onHover { isHovered = $0 }
        }
    }

    extension View {
        fileprivate func macHoverAccent() -> some View {
            modifier(MacHoverAccent())
        }
    }
#endif

extension View {
    /// A 44 point hit area for a line inside a row. Alone, it reaches `reach` past the text into
    /// the space around it without growing the row; stacked, each line takes a full 44 points.
    fileprivate func lineTarget(stacked: Bool, reach: CGFloat) -> some View {
        Group {
            if stacked {
                #if os(macOS)
                    // A pointer needs no 44 point target, so stacked lines keep their own height.
                    self.contentShape(.rect)
                #else
                    self.frame(minHeight: minimumTapTarget).contentShape(.rect)
                #endif
            } else {
                self.padding(.vertical, reach).contentShape(.rect).padding(.vertical, -reach)
            }
        }
    }
}

extension MediaRow {
    /// A recording's row. `sourceLine` names the site an import came from; `tuneLine` names a
    /// filed recording's tune when no heading above does. `perform` runs what a tap on the row
    /// does; `onRetry` runs Retry.
    public init(
        recording row: RecordingRowContent, sourceLine: SourceLine? = nil, tuneLine: TuneLine? = nil,
        perform: @escaping (RecordingRowContent.Tap) -> Void, onRetry: @escaping (RecordingText.Retry) -> Void
    ) {
        self.init(
            glyph: row.glyph, title: row.title, secondLine: .text(row.meta), verb: row.verb,
            action: row.tap.map { tap in { perform(tap) } }, sourceLine: sourceLine, tuneLine: tuneLine,
            error: row.error, notice: row.notice, spokenNotice: row.spokenNotice,
            retry: row.retry.flatMap { retry in row.retryName.map { Retry(name: $0) { onRetry(retry) } } },
            dimmed: row.isDimmed)
    }

    /// A linked recording's row. `perform` runs what a tap on the row does.
    public init(link row: LinkRowContent, perform: @escaping (LinkRowContent.Tap) -> Void) {
        self.init(
            glyph: row.glyph, title: row.title,
            secondLine: row.outboundURL.map { .link(row.outboundLabel, $0, name: row.outboundName) },
            verb: row.verb, action: row.tap.map { tap in { perform(tap) } }, notice: row.notice, dimmed: row.isDimmed)
    }
}

#if DEBUG
    #Preview("Media rows") {
        List {
            ForEach(SampleCatalog.recordingRows, id: \.self) { row in
                MediaRow(recording: row, perform: { _ in }, onRetry: { _ in })
            }
            ForEach(SampleCatalog.linkRows, id: \.self) { row in
                MediaRow(link: row) { _ in }
            }
        }
    }
#endif
