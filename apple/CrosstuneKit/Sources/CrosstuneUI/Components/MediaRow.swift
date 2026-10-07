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
    private let retry: Retry?
    private let isDimmed: Bool

    @ScaledMetric(relativeTo: .headline) private var scaledSlot: CGFloat = 44
    @Environment(\.spacing) private var spacing
    @Environment(\.openURL) private var openURL

    /// `verb` names what the row does or would do, "Play" or "Downloading"; with no `action` the
    /// row is inert. `dimmed` marks a row whose control cannot act right now, such as a download
    /// offline.
    public init(
        glyph: MediaGlyph, title: String, secondLine: SecondLine?, verb: String? = nil,
        action: (() -> Void)? = nil, sourceLine: SourceLine? = nil, tuneLine: TuneLine? = nil,
        error: String? = nil, notice: String? = nil, retry: Retry? = nil, dimmed: Bool = false
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
        self.retry = retry
        isDimmed = dimmed
    }

    /// The row control's spoken name: the verb and the lines it shows, a comma between lines.
    nonisolated public static func accessibilityName(verb: String?, title: String, details: [String]) -> String {
        let first = verb.map { "\($0) \(title)" } ?? title
        return ([first] + details).joined(separator: ", ")
    }

    public var body: some View {
        HStack(spacing: spacing(4)) {
            glyphView
                // Past this the slot takes the width the title needs to wrap into.
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                .frame(width: slot, height: slot)
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
                        .foregroundStyle(.secondary)
                        .rowLineLimit()
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                ForEach(Array(lineControls.enumerated()), id: \.offset) { _, control in
                    innerControl(control)
                }
                if let notice {
                    Text(notice)
                        .font(Self.smallFont)
                        .foregroundStyle(.secondary)
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
            }
        }
        .opacity(isDimmed ? 0.6 : 1)
        // The whole row answers a tap, under the link out and Retry, which keep their own.
        .background { rowControl }
        .accessibilityElement(children: .contain)
    }

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
            .lineTarget(stacked: stacksLineControls, reach: 12)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.tint)
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
            .foregroundStyle(.secondary)
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
            .foregroundStyle(.secondary)
            .lineTarget(stacked: stacksLineControls, reach: 14)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(line.name)
    }

    private func retryButton(_ retry: Retry) -> some View {
        Button(action: retry.action) {
            Text(MediaText.retry)
                .font(Self.lineFont.weight(.semibold))
                .frame(minWidth: slot, minHeight: slot)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.tint)
        .accessibilityLabel(retry.name)
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
        private static let lineFont = MacStyle.secondary
        private static let smallFont = MacStyle.secondary
        private static let glyphFont = Font.system(size: 13)
    #else
        private static let titleFont = Font.headline
        private static let lineFont = Font.subheadline
        private static let smallFont = Font.footnote
        private static let glyphFont = Font.title3
    #endif

    /// A glyph for what a tap would start: quiet on the Mac, where it sits beside 13 point text,
    /// so the one loaded item's stop stands out.
    private static var idleGlyphStyle: HierarchicalShapeStyle {
        #if os(macOS)
            .secondary
        #else
            .primary
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
            Image(systemName: "play.fill").font(Self.glyphFont).foregroundStyle(Self.idleGlyphStyle)
        case .stop:
            Image(systemName: "stop.fill").font(Self.glyphFont).foregroundStyle(Self.loadedGlyphStyle)
        case .download:
            Image(systemName: "icloud.and.arrow.down").font(Self.glyphFont).foregroundStyle(Self.idleGlyphStyle)
        case .downloading:
            ProgressView().controlSize(.small)
        case .attention:
            Image(systemName: "exclamationmark.circle").font(Self.glyphFont).foregroundStyle(.secondary)
        case .waiting:
            Image(systemName: "clock").font(Self.glyphFont).foregroundStyle(.secondary)
        case .none:
            Color.clear
        }
    }
}

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
            error: row.error, notice: row.notice,
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
