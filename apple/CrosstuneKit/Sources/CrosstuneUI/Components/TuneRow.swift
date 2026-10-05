import CrosstuneStore
import SwiftUI

/// The one tune row, wherever tunes are listed: the title, then a line of its key, status,
/// tunings, and whether it is archived. An archived row is dimmed as a whole. In a list the row
/// leads with its position. The Mac shows the same row on one line, as ``MacTuneRow``.
public struct TuneRow: View {
    private let text: TuneRowText
    private let position: Int?
    private let stacked: Bool

    @ScaledMetric(relativeTo: .subheadline) private var positionWidth: CGFloat = 24
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.spacing) private var spacing

    /// `instruments` are the ones the musician plays, whose tunings the row names.
    public init(tune: Tune, userTune: UserTune, instruments: Set<String>, position: Int? = nil) {
        self.init(tune: tune, userTune: userTune, instruments: instruments, position: position, stacked: false)
    }

    /// `stacked` draws the iPhone and iPad row on every platform, for a snapshot of those screens
    /// rendered on a Mac.
    init(tune: Tune, userTune: UserTune, instruments: Set<String>, position: Int? = nil, stacked: Bool) {
        text = TuneRowText(tune: tune, userTune: userTune, instruments: instruments)
        self.position = position
        self.stacked = stacked
    }

    public var body: some View {
        #if os(macOS)
            if stacked {
                stackedRow
            } else {
                MacTuneRow(text: text, position: position)
            }
        #else
            stackedRow
        #endif
    }

    private var stackedRow: some View {
        HStack(spacing: spacing(12)) {
            if let position {
                Text(position, format: .number)
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .frame(minWidth: positionWidth, alignment: .trailing)
            }
            VStack(alignment: .leading, spacing: spacing.rowLineGap) {
                Text(text.title)
                    .font(.headline)
                    .rowLineLimit()
                details
            }
        }
        .opacity(text.isArchived ? 0.6 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text.accessibilityLabel(position: position))
    }

    private var details: some View {
        // The accessibility text sizes wrap the line, so the status and tunings still show.
        let layout =
            dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(FlowLayout(spacing: spacing(12), lineSpacing: spacing.rowLineGap))
            : AnyLayout(HStackLayout(spacing: spacing(12)))
        return layout {
            if let key = text.key {
                KeyPill(key.key, suffix: key.suffix, size: .compact)
            }
            StatusDot(text.status)
            if let tunings = text.tunings {
                Text(tunings)
                    .monospacedDigit()
                    .rowLineLimit()
                    .truncationMode(.tail)
            }
            if text.isArchived {
                Text(TuneRowText.archived)
                    .fixedSize()
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
}

extension View {
    /// A tune row's place in a list. The Mac row sets its own height and draws no separator.
    func tuneRowInsets() -> some View {
        #if os(macOS)
            listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
        #else
            scaledRowInsets()
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
