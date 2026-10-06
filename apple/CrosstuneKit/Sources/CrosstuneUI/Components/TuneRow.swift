import CrosstuneStore
import SwiftUI

/// The one tune row, wherever tunes are listed. On iPhone and iPad it is one line: status glyph,
/// title, and the key at the trailing edge, with a second line only for tunings, capos, or
/// archived. At the accessibility text sizes the key moves under the title so nothing clips. An
/// archived row is dimmed as a whole. In a list the row leads with its position. The Mac shows
/// the same row on one line, as ``MacTuneRow``.
public struct TuneRow: View {
    private let text: TuneRowText
    private let position: Int?
    private let stacked: Bool

    @ScaledMetric(relativeTo: .subheadline) private var positionWidth: CGFloat = 28
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.spacing) private var spacing

    /// `instruments` are the ones the musician plays, whose tunings the row names.
    public init(tune: Tune, userTune: UserTune, instruments: Set<String>, position: Int? = nil) {
        self.init(tune: tune, userTune: userTune, instruments: instruments, position: position, stacked: false)
    }

    /// `stacked` draws the iPhone and iPad row on every platform, for a snapshot of those screens
    /// rendered on a Mac.
    init(
        tune: Tune, userTune: UserTune, instruments: Set<String>, position: Int? = nil, stacked: Bool
    ) {
        text = TuneRowText(tune: tune, userTune: userTune, instruments: instruments)
        self.position = position
        self.stacked = stacked
    }

    public var body: some View {
        #if os(macOS)
            if stacked {
                phoneRow
            } else {
                MacTuneRow(text: text, position: position)
            }
        #else
            phoneRow
        #endif
    }

    private var phoneRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: spacing(12)) {
            if let position {
                Text(position, format: .number)
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .frame(minWidth: positionWidth, alignment: .trailing)
            }
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: spacing.rowLineGap) {
                    titleLine
                    secondLine
                    keyPill
                }
            } else {
                titleLine
                    .frame(maxWidth: .infinity, alignment: .leading)
                keyPill
            }
        }
        .opacity(text.isArchived ? 0.6 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text.accessibilityLabel(position: position))
    }

    private var titleLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: spacing(8)) {
            StatusGlyph(text.status)
            VStack(alignment: .leading, spacing: spacing.rowLineGap) {
                Text(text.title)
                    .font(.body)
                    .rowLineLimit()
                if !dynamicTypeSize.isAccessibilitySize { secondLine }
            }
        }
    }

    @ViewBuilder private var secondLine: some View {
        if let line = text.secondLine {
            Text(line)
                .font(.subheadline)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .rowLineLimit()
        }
    }

    @ViewBuilder private var keyPill: some View {
        if let key = text.key {
            KeyPill(key.key, suffix: key.suffix, size: .compact)
                .fixedSize()
        }
    }
}

extension View {
    /// A tune row's place in a list, with no separator. The Mac row sets its own height.
    func tuneRowInsets() -> some View {
        #if os(macOS)
            listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
        #else
            scaledRowInsets()
                .listRowSeparator(.hidden)
        #endif
    }
}

#if DEBUG
    #Preview("Tune rows") {
        List {
            ForEach(SampleCatalog.entries, id: \.tune.id) { entry in
                TuneRow(tune: entry.tune, userTune: entry.userTune, instruments: SampleCatalog.instruments)
            }
        }
    }

    #Preview("List rows") {
        List {
            ForEach(Array(SampleCatalog.entries.prefix(4).enumerated()), id: \.element.tune.id) { index, entry in
                TuneRow(
                    tune: entry.tune, userTune: entry.userTune, instruments: ["violin"], position: index + 1)
            }
        }
    }
#endif
