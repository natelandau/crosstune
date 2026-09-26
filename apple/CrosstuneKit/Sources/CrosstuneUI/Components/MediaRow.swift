import SwiftUI

/// The row shape recordings and links share: a fixed glyph slot for the item's state, the title,
/// a second line, a red third line for a transfer error, and Retry at the trailing edge.
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

    private let glyph: MediaGlyph
    private let title: String
    private let secondLine: SecondLine?
    private let verb: String?
    private let action: (() -> Void)?
    private let error: String?
    private let notice: String?
    private let retry: Retry?
    private let isDimmed: Bool

    @ScaledMetric(relativeTo: .headline) private var slot: CGFloat = 44

    /// `verb` names what the row does or would do, "Play" or "Downloading"; with no `action` the
    /// row is inert. `dimmed` marks a row whose control cannot act right now, such as a download
    /// offline.
    public init(
        glyph: MediaGlyph, title: String, secondLine: SecondLine?, verb: String? = nil,
        action: (() -> Void)? = nil, error: String? = nil, notice: String? = nil, retry: Retry? = nil,
        dimmed: Bool = false
    ) {
        self.glyph = glyph
        self.title = title
        self.secondLine = secondLine
        self.verb = verb
        self.action = action
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
        HStack(spacing: 4) {
            glyphView
                // Past this the slot takes the width the title needs to wrap into.
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                .frame(width: min(slot, 64), height: min(slot, 64))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                    .rowLineLimit()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                switch secondLine {
                case .text(let meta):
                    Text(meta)
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .rowLineLimit()
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                case .link(let text, let url, let name):
                    linkOut(text, url: url, name: name)
                case nil:
                    EmptyView()
                }
                if let notice {
                    Text(notice)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, 4)
            Spacer(minLength: 0)
            if let retry {
                retryButton(retry)
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

    /// A line of text with a 44 point hit area that does not grow the row: the target reaches
    /// past the text into the space around it.
    private func linkOut(_ text: String, url: URL, name: String) -> some View {
        Link(destination: url) {
            HStack(spacing: 4) {
                Text(text)
                Image(systemName: "arrow.up.right")
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
            .font(.subheadline)
            .padding(.vertical, 12)
            .contentShape(.rect)
            .padding(.vertical, -12)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.tint)
        .accessibilityLabel(name)
    }

    private func retryButton(_ retry: Retry) -> some View {
        Button(action: retry.action) {
            Text(MediaText.retry)
                .font(.subheadline.weight(.semibold))
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.tint)
        .accessibilityLabel(retry.name)
    }

    private var rowName: String {
        var details: [String] = []
        if case .text(let meta) = secondLine { details.append(meta) }
        if let notice { details.append(notice) }
        if let error { details.append(error) }
        return Self.accessibilityName(verb: verb, title: title, details: details)
    }

    @ViewBuilder private var glyphView: some View {
        switch glyph {
        case .play:
            Image(systemName: "play.fill").font(.title3)
        case .stop:
            Image(systemName: "stop.fill").font(.title3)
        case .download:
            Image(systemName: "icloud.and.arrow.down").font(.title3)
        case .downloading:
            ProgressView().controlSize(.small)
        case .attention:
            Image(systemName: "exclamationmark.circle").font(.title3).foregroundStyle(.secondary)
        case .waiting:
            Image(systemName: "clock").font(.title3).foregroundStyle(.secondary)
        case .none:
            Color.clear
        }
    }
}

extension MediaRow {
    /// A recording's row. `perform` runs what a tap on the row does; `onRetry` runs Retry.
    public init(
        recording row: RecordingRowContent, perform: @escaping (RecordingRowContent.Tap) -> Void,
        onRetry: @escaping (RecordingText.Retry) -> Void
    ) {
        self.init(
            glyph: row.glyph, title: row.title, secondLine: .text(row.meta), verb: row.verb,
            action: row.tap.map { tap in { perform(tap) } }, error: row.error, notice: row.notice,
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
