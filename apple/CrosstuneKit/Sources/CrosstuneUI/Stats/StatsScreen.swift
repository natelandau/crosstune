import CrosstuneCommands
import CrosstuneStore
import CrosstuneSync
import CrosstuneVocabulary
import SwiftUI

/// A look back over the catalog, pushed from the Settings summary row. Counts and the recorded
/// total always show; every other block shows only when the catalog holds something for it.
public struct StatsScreen: View {
    @Environment(\.store) private var store
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    /// Kept across a push and back, so the history is pulled once per visit.
    @State private var model: (key: ModelKey, model: StatsModel)?

    public init() {}

    public var body: some View {
        Group {
            if let view = model?.model.view {
                StatsContent(view: view)
            } else {
                // Loading is silence.
                Color.clear
            }
        }
        .navigationTitle(StatsCopy.title)
        .task(id: ModelKey(store: store, engine: engine)) {
            let key = ModelKey(store: store, engine: engine)
            guard model?.key != key else { return }
            model = store.map { (key, StatsModel(store: $0, engine: engine)) }
            model?.model.appeared()
        }
    }
}

/// The stats screen pushed over Settings.
struct StatsRoute: Hashable {}

/// One block of the stats screen, in the order the screen shows them.
enum StatsBlock: Identifiable {
    case counts
    case recorded
    case months
    case activity
    case onThisDay
    case keys
    /// A breakdown of one attribute. `facet` is the catalog filter its values set, or nil for
    /// an attribute the catalog does not filter on, whose values only count.
    case values(header: String, values: [Stats.Value], facet: CatalogFacet?)
    case rarities

    var id: String { header }

    var header: String {
        switch self {
        case .counts: StatsCopy.countsHeader
        case .recorded: StatsCopy.recordedHeader
        case .months: StatsCopy.monthsHeader
        case .activity: StatsCopy.activityHeader
        case .onThisDay: StatsCopy.onThisDayHeader
        case .keys: CatalogFacet.key.label
        case .values(let header, _, _): header
        case .rarities: StatsCopy.raritiesHeader
        }
    }

    /// The blocks `stats` has something for.
    static func blocks(_ stats: Stats) -> [StatsBlock] {
        let breakdowns = stats.breakdowns
        let tunings = breakdowns.tunings.compactMap { row -> StatsBlock? in
            // An instrument this build cannot name has no catalog filter to open.
            guard Vocabulary.instrumentLabels[row.instrument] != nil else { return nil }
            let facet = CatalogFacet.tuning(row.instrument)
            return .values(header: facet.label, values: row.values, facet: facet)
        }
        let values: [StatsBlock] =
            [.values(header: CatalogFacet.tuneType.label, values: breakdowns.tuneType, facet: .tuneType)]
            + tunings
            + [
                .values(header: CatalogFacet.genre.label, values: breakdowns.genre, facet: .genre),
                .values(header: TuneFieldLabels.timeSignature, values: breakdowns.timeSignature, facet: nil),
                .values(header: CatalogFacet.composer.label, values: breakdowns.composer, facet: .composer),
                .values(header: CatalogFacet.learnedFrom.label, values: breakdowns.learnedFrom, facet: .learnedFrom),
            ]
        var blocks: [StatsBlock] = [.counts, .recorded]
        if !stats.months.allTime.isEmpty { blocks.append(.months) }
        if stats.heatmap.visible { blocks.append(.activity) }
        if !stats.onThisDay.isEmpty { blocks.append(.onThisDay) }
        if !breakdowns.key.isEmpty { blocks.append(.keys) }
        blocks += values.filter {
            if case .values(_, let values, _) = $0 { !values.isEmpty } else { true }
        }
        if !stats.rarities.isEmpty { blocks.append(.rarities) }
        return blocks
    }
}

/// The catalog filters a stats value opens with, or nil for a value no filter can hold, which
/// only reads.
enum StatsLink {
    static func value(_ value: String, facet: CatalogFacet) -> [CatalogFacet: String]? { filters([facet: value]) }

    static func key(_ key: String) -> [CatalogFacet: String]? { filters([.key: key]) }

    static func keyMode(key: String, mode: String) -> [CatalogFacet: String]? { filters([.key: key, .mode: mode]) }

    private static func filters(_ facets: [CatalogFacet: String]) -> [CatalogFacet: String]? {
        facets.allSatisfy { CatalogSearch.isFilterValue($0.value, for: $0.key) } ? facets : nil
    }
}

/// Opens the Catalog at its root showing exactly the tunes a stats value counted: that filter
/// alone, every other filter and the search cleared. The Settings stack keeps the stats screen
/// for the way back.
@MainActor
struct CatalogTapThrough {
    let catalog: CatalogModel
    let showRoot: MenuAction

    func callAsFunction(_ facets: [CatalogFacet: String]) {
        catalog.replaceFilters(with: CatalogFilters(facets: facets))
        catalog.query = ""
        showRoot()
    }
}

private struct StatsContent: View {
    let view: StatsView

    var body: some View {
        ScrollView {
            StatsDocument(view: view)
                .frame(maxWidth: PageStyle.pageMaxWidth, alignment: .leading)
                .padding(PageStyle.pageMargin)
                .frame(maxWidth: .infinity)
        }
    }
}

/// The stats as a document: one plain section per block, laid out at its full height so a
/// snapshot can draw it without the scroll view.
struct StatsDocument: View {
    let view: StatsView

    @Environment(CatalogModel.self) private var catalog: CatalogModel?
    @Environment(\.openCatalogRoot) private var openCatalogRoot
    @Environment(\.detailTune) private var detailTune
    @Environment(\.commands) private var commands
    @State private var allTime = false
    /// The breakdown blocks, by id, opened past their first rows.
    @State private var expanded: Set<String> = []

    /// Nil outside the shell, as in the Mac Settings window, where values only count.
    private var tapThrough: CatalogTapThrough? {
        guard let catalog, let openCatalogRoot else { return nil }
        return CatalogTapThrough(catalog: catalog, showRoot: openCatalogRoot)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: PageStyle.sectionGap) {
            if PageStyle.pageHeadsItself {
                Text(StatsCopy.title)
                    .font(PageStyle.pageTitle)
                    .accessibilityAddTraits(.isHeader)
            }
            ForEach(StatsBlock.blocks(view.stats)) { block in
                section(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func section(_ block: StatsBlock) -> some View {
        let stats = view.stats
        switch block {
        case .counts:
            PageSection(block.header) { countsBlock(stats.counts) }
        case .recorded:
            PageSection(block.header) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(StatsCopy.recordedLine(recordings: stats.recorded.count, ms: stats.recorded.totalMs))
                        .font(PageStyle.body)
                        .monospacedDigit()
                    if let equivalence = stats.equivalence {
                        Text(
                            equivalenceText(equivalence, tuneTitle: equivalence.tuneID.flatMap { view.tuneTitles[$0] })
                        )
                        .font(PageStyle.secondary)
                        .foregroundStyle(.secondary)
                    }
                }
            }
        case .months:
            PageSection(block.header) {
                if stats.months.hasAllTime {
                    ChoiceCapsule(chosen: allTime) {
                        allTime.toggle()
                    } label: {
                        Text(StatsCopy.allTime)
                    }
                }
            } content: {
                MonthBarsView(months: stats.months, allTime: allTime)
            }
        case .activity:
            PageSection(block.header) {
                HeatmapView(heatmap: stats.heatmap, today: view.today)
            }
        case .onThisDay:
            PageSection(block.header) {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(stats.onThisDay.enumerated()), id: \.offset) { _, line in
                        Text(StatsCopy.onThisDayLine(line, title: view.title(for: line)))
                            .font(PageStyle.body)
                    }
                }
            }
        case .keys:
            PageSection(block.header) {
                KeyGridView(rows: stats.breakdowns.key, open: tapThrough)
            }
        case .values(let header, let values, let facet):
            PageSection(header) { breakdown(id: block.id, values, facet: facet) }
        case .rarities:
            PageSection(block.header) {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(stats.rarities.enumerated()), id: \.offset) { _, rarity in
                        rarityRow(rarity)
                    }
                }
            }
        }
    }

    /// Lists, recordings, and links, then scans when there are any, on one line.
    static func tallyLine(_ counts: Stats.Counts) -> String {
        let parts =
            [
                (StatsCopy.listsLabel, counts.lists), (StatsCopy.recordingsLabel, counts.recordings),
                (StatsCopy.linksLabel, counts.links),
            ]
            .map { "\($0.0) \(groupedThousands($0.1))" }
            + (counts.scans > 0 ? [StatsCopy.scansLine(scans: counts.scans, tunes: counts.scanTunes)] : [])
        return parts.joined(separator: " · ")
    }

    private func countsBlock(_ counts: Stats.Counts) -> some View {
        let byStatus = StatusBar.byStatus(counts)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(groupedThousands(counts.tunes))
                    .font(.title2.weight(.semibold))
                    .monospacedDigit()
                Text(StatsCopy.tunesLabel)
                    .font(PageStyle.body)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            // The rows under it say each count, so the bar would say them twice.
            StatusBar(counts: byStatus)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Vocabulary.statuses, id: \.self) { status in
                    HStack(spacing: 8) {
                        // The word beside it names the status.
                        StatusGlyph(status)
                            .accessibilityHidden(true)
                        Text(StatusStyle.label(status))
                        Spacer(minLength: 8)
                        Text(groupedThousands(byStatus[status] ?? 0)).monospacedDigit()
                    }
                    .font(PageStyle.body)
                    .accessibilityElement(children: .combine)
                }
            }
            Text(Self.tallyLine(counts))
                .font(PageStyle.body)
                .monospacedDigit()
            if counts.archived > 0 {
                Text(StatsCopy.archivedLine(counts.archived))
                    .font(PageStyle.secondary)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private func breakdown(id: String, _ values: [Stats.Value], facet: CatalogFacet?) -> some View {
        let isOpen = expanded.contains(id)
        let parts = StatsBreakdown.visible(values, expanded: isOpen)
        let peak = values.map(\.count).max() ?? 0
        VStack(alignment: .leading, spacing: 0) {
            ForEach(parts.shown, id: \.value) { value in
                valueRow(value, max: peak, facet: facet)
            }
            if parts.hidden > 0 {
                Button(StatsCopy.showAll(values.count)) { expanded.insert(id) }
                    .font(PageStyle.secondary.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(.tint)
                    .padding(.horizontal, 8)
                    .frame(minHeight: PageStyle.minTarget, alignment: .leading)
                    .contentShape(.rect)
            }
        }
    }

    @ViewBuilder private func valueRow(_ value: Stats.Value, max: Int, facet: CatalogFacet?) -> some View {
        if let facet, let tapThrough, let link = StatsLink.value(value.value, facet: facet) {
            Button {
                tapThrough(link)
            } label: {
                ShareBarRow(value: value, max: max, link: true)
            }
            .buttonStyle(PressedOpacityStyle())
        } else {
            ShareBarRow(value: value, max: max, link: false)
        }
    }

    @ViewBuilder private func rarityRow(_ rarity: Stats.Rarity) -> some View {
        let label = VStack(alignment: .leading) {
            Text(StatsCopy.rarityLine(rarity))
                .font(PageStyle.body)
            if let title = view.tuneTitles[rarity.tuneID] {
                Text(title).font(.footnote).foregroundStyle(.secondary)
            }
        }
        if let detailTune {
            // The split view shows the tune in its detail column rather than pushing it.
            Button {
                detailTune.wrappedValue = rarity.tuneID
            } label: {
                chevronRow(label)
            }
            .buttonStyle(.plain)
        } else if commands != nil {
            NavigationLink {
                TuneScreen(tuneID: rarity.tuneID)
                    .environment(\.stackTune, nil)
            } label: {
                chevronRow(label)
            }
            .buttonStyle(.plain)
        } else {
            // The Mac Settings window has no shell to show a tune in.
            label.accessibilityElement(children: .combine)
        }
    }

    private func chevronRow(_ label: some View) -> some View {
        HStack {
            label.foregroundStyle(.primary)
            Spacer()
            RowChevron()
        }
        .frame(minHeight: PageStyle.minTarget)
        .contentShape(.rect)
    }
}

/// Keys down, modes across. A key's own control filters by the key alone, with its total; a
/// cell filters by the key and the mode together. Without `open` the grid only reads.
struct KeyGridView: View {
    let rows: [Stats.KeyRow]
    let open: CatalogTapThrough?

    @Environment(\.inPadSplit) private var inPadSplit

    /// Whether the grid spreads across the row rather than hugging its leading edge. The iPad's
    /// detail column has room for it.
    nonisolated static func spreads(inPadSplit: Bool) -> Bool {
        PageStyle.keyGridSpreads || inPadSplit
    }

    private var spreads: Bool { Self.spreads(inPadSplit: inPadSplit) }

    /// The modes some tune in a key holds, in vocabulary order, then any this build does not know.
    private var modes: [String] {
        let used = Set(rows.flatMap { $0.modes.map(\.value) })
        return Vocabulary.modes.filter(used.contains) + used.subtracting(Vocabulary.modes).sorted()
    }

    var body: some View {
        Group {
            if spreads {
                ViewThatFits(in: .horizontal) {
                    grid.frame(maxWidth: .infinity)
                    scrolling
                }
            } else {
                scrolling
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(StatsCopy.keyGridCaption)
    }

    /// Five or six modes outgrow a phone's row, so the grid scrolls sideways rather than clip.
    private var scrolling: some View {
        ScrollView(.horizontal) { grid }
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
    }

    private var grid: some View {
        let modes = modes
        return Grid(alignment: .center, horizontalSpacing: 12, verticalSpacing: 4) {
            GridRow {
                Text(CatalogFacet.key.label)
                    .gridColumnAlignment(.leading)
                ForEach(modes, id: \.self) { mode in
                    Text(StatsCopy.modeColumns[mode] ?? mode)
                        .accessibilityLabel(mode)
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            ForEach(rows, id: \.key) { row in
                GridRow {
                    cell(
                        StatsCopy.keyCellLabel(row.key, row.count), facets: StatsLink.key(row.key), alignment: .leading
                    ) {
                        HStack(spacing: 8) {
                            KeyPill(row.key, size: .compact)
                            Text(groupedThousands(row.count))
                        }
                    }
                    ForEach(modes, id: \.self) { mode in
                        if let n = row.modes.first(where: { $0.value == mode })?.count {
                            cell(
                                StatsCopy.keyModeCellLabel(row.key, mode, n),
                                facets: StatsLink.keyMode(key: row.key, mode: mode)
                            ) {
                                Text(groupedThousands(n))
                            }
                        } else {
                            Color.clear.frame(width: 1, height: 1)
                        }
                    }
                }
                .monospacedDigit()
            }
        }
    }

    @ViewBuilder private func cell(
        _ label: String, facets: [CatalogFacet: String]?, alignment: Alignment = .center,
        @ViewBuilder content: () -> some View
    ) -> some View {
        let spreads = spreads
        let content = content()
            .frame(
                minWidth: minimumTapTarget, maxWidth: spreads ? .infinity : nil, minHeight: minimumTapTarget,
                alignment: spreads ? alignment : .center)
        if let open, let facets {
            Button {
                open(facets)
            } label: {
                content.contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
        } else {
            content
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label)
        }
    }
}
