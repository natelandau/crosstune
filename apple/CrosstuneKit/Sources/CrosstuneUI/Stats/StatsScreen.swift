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
                .values(header: TuneFieldLabels.learnedFrom, values: breakdowns.learnedFrom, facet: nil),
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

    @Environment(CatalogModel.self) private var catalog: CatalogModel?
    @Environment(\.openCatalogRoot) private var openCatalogRoot
    @Environment(\.detailTune) private var detailTune
    @Environment(\.commands) private var commands
    @State private var allTime = false

    /// Nil outside the shell, as in the Mac Settings window, where values only count.
    private var tapThrough: CatalogTapThrough? {
        guard let catalog, let openCatalogRoot else { return nil }
        return CatalogTapThrough(catalog: catalog, showRoot: openCatalogRoot)
    }

    var body: some View {
        Form {
            ForEach(StatsBlock.blocks(view.stats)) { block in
                section(block)
            }
        }
        .formStyle(.grouped)
    }

    @ViewBuilder private func section(_ block: StatsBlock) -> some View {
        let stats = view.stats
        switch block {
        case .counts:
            Section {
                countRow(StatsCopy.tunesLabel, stats.counts.tunes)
                countRow(StatsCopy.knownLabel, stats.counts.known)
                countRow(StatsCopy.learningLabel, stats.counts.learning)
                countRow(StatsCopy.unknownLabel, stats.counts.wantToLearn)
                countRow(StatsCopy.listsLabel, stats.counts.lists)
                countRow(StatsCopy.recordingsLabel, stats.counts.recordings)
                countRow(StatsCopy.linksLabel, stats.counts.links)
                if stats.counts.scans > 0 {
                    Text(StatsCopy.scansLine(scans: stats.counts.scans, tunes: stats.counts.scanTunes))
                        .monospacedDigit()
                }
            } header: {
                Text(block.header)
            } footer: {
                if stats.counts.archived > 0 { Text(StatsCopy.archivedLine(stats.counts.archived)) }
            }
        case .recorded:
            Section {
                Text(StatsCopy.recordedLine(recordings: stats.recorded.count, ms: stats.recorded.totalMs))
                    .monospacedDigit()
            } header: {
                Text(block.header)
            } footer: {
                if let equivalence = stats.equivalence {
                    Text(equivalenceText(equivalence, tuneTitle: equivalence.tuneID.flatMap { view.tuneTitles[$0] }))
                }
            }
        case .months:
            Section {
                MonthBarsView(months: stats.months, allTime: allTime)
                    .padding(.vertical, 8)
            } header: {
                HStack {
                    Text(block.header)
                    Spacer()
                    if stats.months.hasAllTime {
                        ChoiceCapsule(chosen: allTime) {
                            allTime.toggle()
                        } label: {
                            Text(StatsCopy.allTime)
                        }
                    }
                }
                .textCase(nil)
            }
        case .activity:
            Section(block.header) {
                HeatmapView(heatmap: stats.heatmap, today: view.today)
                    .padding(.vertical, 8)
            }
        case .onThisDay:
            Section(block.header) {
                ForEach(Array(stats.onThisDay.enumerated()), id: \.offset) { _, line in
                    Text(StatsCopy.onThisDayLine(line, title: view.title(for: line)))
                }
            }
        case .keys:
            Section(block.header) {
                KeyGridView(rows: stats.breakdowns.key, open: tapThrough)
            }
        case .values(let header, let values, let facet):
            Section(header) {
                ForEach(values, id: \.value) { value in
                    valueRow(value, facet: facet)
                }
            }
        case .rarities:
            Section(block.header) {
                ForEach(Array(stats.rarities.enumerated()), id: \.offset) { _, rarity in
                    rarityRow(rarity)
                }
            }
        }
    }

    private func countRow(_ label: String, _ n: Int) -> some View {
        LabeledContent(label) {
            Text(groupedThousands(n)).monospacedDigit()
        }
    }

    @ViewBuilder private func valueRow(_ value: Stats.Value, facet: CatalogFacet?) -> some View {
        if let facet, let tapThrough, let link = StatsLink.value(value.value, facet: facet) {
            SettingsFieldRow(title: value.value, value: groupedThousands(value.count)) {
                tapThrough(link)
            }
        } else {
            countRow(value.value, value.count)
        }
    }

    @ViewBuilder private func rarityRow(_ rarity: Stats.Rarity) -> some View {
        let label = VStack(alignment: .leading) {
            Text(StatsCopy.rarityLine(rarity))
            if let title = view.tuneTitles[rarity.tuneID] {
                Text(title).font(.footnote).foregroundStyle(.secondary)
            }
        }
        if let detailTune {
            // The split view shows the tune in its detail column rather than pushing it.
            Button {
                detailTune.wrappedValue = rarity.tuneID
            } label: {
                HStack {
                    label.foregroundStyle(.primary)
                    Spacer()
                    Image(systemName: "chevron.forward")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        } else if commands != nil {
            NavigationLink {
                TuneScreen(tuneID: rarity.tuneID)
                    .environment(\.stackTune, nil)
            } label: {
                label
            }
        } else {
            // The Mac Settings window has no shell to show a tune in.
            label.accessibilityElement(children: .combine)
        }
    }
}

/// Keys down, modes across. A key's own control filters by the key alone, with its total; a
/// cell filters by the key and the mode together. Without `open` the grid only reads.
struct KeyGridView: View {
    let rows: [Stats.KeyRow]
    let open: CatalogTapThrough?
    /// False only for a snapshot, which cannot render a scroll view.
    var scrolls = true

    /// The modes some tune in a key holds, in vocabulary order, then any this build does not know.
    private var modes: [String] {
        let used = Set(rows.flatMap { $0.modes.map(\.value) })
        return Vocabulary.modes.filter(used.contains) + used.subtracting(Vocabulary.modes).sorted()
    }

    var body: some View {
        Group {
            if scrolls {
                // Five or six modes outgrow a phone's row, so the grid scrolls sideways rather than clip.
                ScrollView(.horizontal) { grid }
                    .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            } else {
                grid
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(StatsCopy.keyGridCaption)
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
                    cell(StatsCopy.keyCellLabel(row.key, row.count), facets: StatsLink.key(row.key)) {
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
        _ label: String, facets: [CatalogFacet: String]?, @ViewBuilder content: () -> some View
    ) -> some View {
        let content = content().frame(minWidth: 44, minHeight: 44)
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
