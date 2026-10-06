import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import SwiftUI
import Testing

@testable import CrosstuneUI

/// Renders every shared component to PNG for review. See ``snapshot(_:width:_:)``.
@MainActor
@Suite struct SnapshotTests {
    private let keys = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"]

    @Test func keyPills() {
        snapshot("key-pills") {
            VStack(alignment: .leading, spacing: 12) {
                FlowLayout { ForEach(keys, id: \.self) { KeyPill($0) } }
                FlowLayout { ForEach(keys, id: \.self) { KeyPill($0, chosen: true) } }
                FlowLayout {
                    KeyPill("D", size: .compact)
                    KeyPill("E", suffix: " dor", size: .compact)
                    KeyPill("A", suffix: " mix", size: .compact)
                    KeyPill("G", suffix: " modal", size: .compact)
                    KeyPill("C/G", size: .compact)
                    KeyPill("C/G")
                    KeyPill("C/G", chosen: true)
                }
            }
        }
    }

    @Test func status() {
        snapshot("status") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 16) {
                    ForEach(["known", "learning", "want_to_learn"], id: \.self) { status in
                        HStack(spacing: 6) {
                            StatusGlyph(status)
                            Text(StatusStyle.label(status))
                        }
                    }
                }
                .font(.subheadline)
            }
        }
    }

    @Test func tuneRows() {
        snapshot("tune-rows") { tuneRows(instruments: SampleCatalog.instruments) }
    }

    @Test(arguments: [DynamicTypeSize.small, .large, .xxLarge, .accessibility2, .accessibility3])
    func tuneRowsAtEachSize(size: DynamicTypeSize) {
        snapshot("tune-rows-sized", size: size) { tuneRows(instruments: SampleCatalog.instruments) }
    }

    @Test(arguments: [DynamicTypeSize.small, .large, .xxLarge, .accessibility2])
    func railsAtEachSize(size: DynamicTypeSize) {
        snapshot("rails", size: size) {
            VStack(alignment: .leading, spacing: 0) {
                Rail(chosen: "D") {
                    ForEach(keys, id: \.self) { KeyPill($0, chosen: $0 == "D").id($0) }
                }
                Divider()
                tuneRows(instruments: SampleCatalog.instruments)
            }
        }
    }

    @Test func listRows() {
        snapshot("list-rows") {
            rows(Array(SampleCatalog.entries.prefix(5).enumerated()), id: \.element.tune.id) { index, entry in
                TuneRow(
                    tune: entry.tune, userTune: entry.userTune, instruments: ["violin"], position: index + 1,
                    stacked: true)
            }
        }
    }

    /// The iPhone list page: the list's name, Play and Shuffle over the line that says what
    /// plays, then the numbered rows.
    @Test func listPage() {
        let entries = Array(SampleCatalog.entries.prefix(5).enumerated())
        let report = PlaylistReport(
            playable: entries.prefix(4).map(\.element.tune.id), skipped: [.nothing: [entries[4].element.tune.id]],
            total: entries.count)
        snapshot("list-page-phone") {
            VStack(alignment: .leading, spacing: 12) {
                Text(SampleCatalog.lists[0].name)
                    .font(.largeTitle.bold())
                ListPlayControls(
                    offer: ListPlayOffer(report: report, canStart: true, onPlay: {}, onShuffle: {}, onWhatPlays: {}))
                rows(entries, id: \.element.tune.id) { index, entry in
                    TuneRow(
                        tune: entry.tune, userTune: entry.userTune, instruments: ["violin"], position: index + 1,
                        stacked: true)
                }
            }
            .tint(BrandStyle.accent)
        }
    }

    @Test func mediaRows() {
        snapshot("media-rows") {
            rows(SampleCatalog.recordingRows.map(Row.recording) + SampleCatalog.linkRows.map(Row.link), id: \.self) {
                switch $0 {
                case .recording(let row): MediaRow(recording: row, perform: { _ in }, onRetry: { _ in })
                case .link(let row): MediaRow(link: row) { _ in }
                }
            }
        }
    }

    /// The tune page in a narrow column, holding everything a tune can, archived. The test host
    /// draws with the Mac's sizes, so the iPhone page shows only on a simulator.
    @Test func tunePageNarrow() async throws {
        let pages = try await TunePageSamples.load()
        snapshot("tune-page-narrow", width: 390) {
            TunePageSamples.column(model: pages.full.model, detail: pages.full.detail)
                .tint(BrandStyle.accent)
                // Outside a navigation stack a list token's link draws disabled.
                .environment(\.sidebarSelection, .constant(.catalog))
        }
    }

    #if os(macOS)
        /// A wide list column at rest with the pointer over its third row, then playing its second
        /// row, then selecting two rows with the bulk actions in the pane bar.
        @Test func macListColumn() {
            let ids = SampleCatalog.entries.map(\.tune.id)
            snapshot("mac-list-column", width: 1320) {
                HStack(alignment: .top, spacing: 24) {
                    MacListColumnStandIn(width: 500, hovered: 2)
                    MacListColumnStandIn(playing: 1)
                    MacListColumnStandIn(selected: [ids[1], ids[2]])
                }
            }
        }

        /// The narrowest list column, whose Play and Shuffle drop under a title they would crowd.
        @Test func macListColumnNarrow() {
            snapshot("mac-list-column-narrow", width: 300) {
                MacListColumnStandIn(width: 268, playing: 0)
            }
        }

        /// The recordings column: storage, then plain headings over the unfiled and filed groups.
        @Test func macRecordingsColumn() {
            snapshot("mac-recordings-column", width: 400) {
                MacRecordingsColumnStandIn()
            }
        }

        /// A file dragged over the recordings column.
        @Test func macRecordingsDropping() {
            snapshot("mac-recordings-dropping", width: 400) {
                MacRecordingsColumnStandIn(dropping: true)
            }
        }

        /// The tune page holding everything a tune can, archived, then a tune holding only its
        /// title and type.
        @Test func macTunePage() async throws {
            let pages = try await TunePageSamples.load()
            page("mac-tune-page", model: pages.full.model, detail: pages.full.detail)
            page("mac-tune-page-sparse", model: pages.sparse.model, detail: pages.sparse.detail)
        }

        @Test func macTunePlaceholder() {
            snapshot("mac-tune-placeholder", width: 560) {
                TuneDetailPlaceholder().frame(height: 360)
            }
        }

        /// The record sheet's panel waiting on the microphone, then twelve seconds into a take.
        @Test func macRecordSheet() async throws {
            let root = TemporaryRoot()
            let input = ToneInput()
            let recorder = Recorder(store: try root.open(), input: input, channels: { .mono })
            await recordPanel("mac-record-sheet-idle", RecordSheetModel(recorder: recorder, tuneID: nil))

            let live = RecordSheetModel(recorder: recorder, tuneID: nil)
            await live.begin()
            try input.play(seconds: 12)
            await recordPanel("mac-record-sheet-recording", live)
            await live.discard()
        }

        /// The whole sheet, toolbar included, as the Mac presents it. Its own task never runs the
        /// recorder here, since the claim refuses it.
        private func recordPanel(_ name: String, _ model: RecordSheetModel) async {
            await sheetSnapshot(name) {
                RecordSheet(model: model, claim: { false }).tint(MacStyle.accent)
            }
        }

        /// The recording screen at its ideal sheet size with each mode chosen: Loops with a loop
        /// selected, then Speed and Pitch set off their defaults.
        @Test(arguments: PracticeMode.allCases)
        func macRecordingScreen(mode: PracticeMode) async throws {
            let width: CGFloat = 560
            let screen = try await practiceScreen(mode: mode, width: width - 2 * MacStyle.sheetMargin)
            await sheetSnapshot("mac-recording-screen-\(mode.rawValue)") {
                // The stack and Close as `RecordingScreen` wraps the content.
                NavigationStack {
                    screen
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button(RecordingScreenText.close) {}
                            }
                        }
                }
                .frame(width: width, height: 720)
                .tint(MacStyle.accent)
            }
        }

        /// The iPhone's practice screen on its ground, from the light and the dark appearance, with
        /// a loop selected. The test host draws with the Mac's sizes and toolbar, so only the
        /// ground, waveform, playhead, handles, and transport show as the phone has them.
        @Test func practicePhone() async throws {
            let width: CGFloat = 390
            let screen = try await practiceScreen(mode: .loops, width: width - 2 * MacStyle.sheetMargin)
            await windowSnapshot("practice-phone", size: CGSize(width: width, height: 844)) {
                PracticeGroundStandIn {
                    NavigationStack { screen }
                }
                .tint(BrandStyle.accent)
            }
        }

        /// The sample's playable recording loaded with two loops, at `width`, peaks drawn as a
        /// tune's swell and fall so the bars read as music rather than noise.
        private func practiceScreen(mode: PracticeMode, width: CGFloat) async throws -> RecordingScreenContent {
            let entry = SampleCatalog.playable
            let file = try #require(entry.file)
            let seconds = Double(entry.recording.durationMs ?? 184_000) / 1000
            let audio = FakeAudio()
            audio.duration = seconds
            audio.elapsed = 21
            let player = PlayerModel(audio: audio)
            player.audioSource = { _ in RecordingAudioFile(url: URL(filePath: "/tmp/r1.m4a"), file: file) }
            player.play(.recording(entry.recording, tuneTitle: entry.tuneTitle))
            #expect(try await poll { player.recordingAudio == .loaded })
            audio.isPlaying = false
            let id = entry.recording.id
            player.loopsChanged(
                id: id,
                to: [
                    RecordingLoop(
                        id: "loop_a", createdAt: SampleCatalog.now, updatedAt: SampleCatalog.now, recordingID: id,
                        label: "A part", startMs: 14_000, endMs: 29_500, color: 0),
                    RecordingLoop(
                        id: "loop_b", createdAt: SampleCatalog.now, updatedAt: SampleCatalog.now, recordingID: id,
                        label: nil, startMs: 31_000, endMs: 47_000, color: 1),
                ])
            if mode != .loops {
                player.setSpeed(75)
                player.setPitch(-200)
            }

            let noWrites = LoopWriter(
                add: { _, _ in throw CancellationError() }, update: { _, _, _ in }, remove: { _ in })
            let practice = PracticeModel(
                player: player, recording: entry.recording, file: file, writer: noWrites, mode: mode)
            practice.partStructure = "AABB"
            if mode == .loops { practice.select("loop_a") }
            practice.setWidth(Double(width))
            let values = (0..<Int(seconds) * 50).map { index -> UInt8 in
                let t = Double(index) / 50
                let swell = 0.55 + 0.35 * sin(t / 9) * sin(t / 2.3)
                let beat = 0.6 + 0.4 * abs(sin(t * .pi * 2.1))
                return UInt8(max(8, min(255, 255 * swell * beat)))
            }
            let rows = ScreenRows(
                recording: entry.recording, file: file, tuneID: entry.recording.tuneID, tuneTitle: entry.tuneTitle,
                partStructure: "AABB")
            return RecordingScreenContent(
                player: player, rows: rows, path: .constant([]), practice: practice, peaks: Peaks(values: values))
        }

        /// Each Settings tab over the sample catalog, at the Settings window's width. Its own
        /// window draws the toolbar of tabs, so only a tab's form shows here.
        @Test(arguments: MacSettingsTabs.Pane.allCases)
        func macSettingsTabs(pane: MacSettingsTabs.Pane) async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            await windowSnapshot("mac-settings-\(pane.rawValue)", size: MacSettingsTabs.size) {
                MacSettingsTabs.content(pane, version: "0.7.0")
                    .environment(\.store, store)
                    .tint(MacStyle.accent)
            }
        }

        /// The iPhone Settings root over the sample catalog. The test host draws with the Mac's
        /// sizes, so the iPhone page shows only on a simulator.
        @Test func settingsRootPhone() async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            await windowSnapshot("settings-root-phone", size: CGSize(width: 390, height: 600)) {
                NavigationStack { SettingsRoot(version: "0.7.0") }
                    .environment(\.store, store)
                    .tint(BrandStyle.accent)
            }
        }

        /// The stats screen over the sample catalog, as the Account tab's sheet holds it, then half a
        /// year of activity stepping through every quartile, which the sample has no history for.
        @Test func macStats() async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            await windowSnapshot("mac-stats", size: CGSize(width: MacSettingsTabs.size.width, height: 1400)) {
                NavigationStack { StatsScreen() }
                    .environment(\.store, store)
                    .tint(MacStyle.accent)
            }
            await sheetSnapshot("mac-stats-sheet") {
                StatsSheet()
                    .environment(\.store, store)
                    .tint(MacStyle.accent)
            }

            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "UTC")!
            let start = calendar.date(from: DateComponents(year: 2026, month: 4, day: 5))!
            let days = (0..<182).map { offset in
                let date = calendar.date(byAdding: .day, value: offset, to: start)!
                let parts = calendar.dateComponents([.year, .month, .day], from: date)
                let level = (offset * 7 + offset / 5) % 9 < 4 ? 0 : (offset * 3 + offset / 7) % 4 + 1
                return Stats.Day(
                    date: String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!),
                    musicMs: level * 600_000, plays: level, practiceSessions: 0, scanViews: 0, tunesAdded: 0,
                    recordings: 0, statusChanges: 0, level: level)
            }
            let heatmap = Stats.Heatmap(visible: true, start: days[0].date, days: days)
            await windowSnapshot("mac-stats-heatmap", size: CGSize(width: MacSettingsTabs.size.width, height: 260)) {
                Form {
                    Section(StatsCopy.activityHeader) {
                        HeatmapView(heatmap: heatmap, today: days[days.count - 1].date)
                            .padding(.vertical, 8)
                    }
                }
                .formStyle(.grouped)
                .tint(MacStyle.accent)
            }
        }

        /// The tune form editing a sample tune, as the Mac presents it.
        @Test func macTuneForm() async throws {
            let root = TemporaryRoot()
            let store = try await SampleCatalog.makeStore(root: root.url)
            let entry = SampleCatalog.entries[0]
            await sheetSnapshot("mac-tune-form") {
                TuneFormSheet(target: .edit(tuneID: entry.tune.id, userTuneID: entry.userTune.id)) { _ in }
                    .environment(\.store, store)
                    .tint(MacStyle.accent)
            }
            // The details below the sheet's fold: an open choice, then a closed one that is a menu.
            await windowSnapshot("mac-tune-form-pickers", size: CGSize(width: 480, height: 200)) {
                Form {
                    SuggestionPicker(
                        TuneFieldLabels.genre, value: .constant("Old-time"), options: Vocabulary.genres,
                        allowsOther: true)
                    SuggestionPicker(
                        TuneFieldLabels.timeSignature, value: .constant("4/4"), options: Vocabulary.timeSignatures,
                        allowsOther: false, reportsRepicks: true)
                }
                .formStyle(.grouped)
                .tint(MacStyle.accent)
            }
        }

        @Test func macWelcome() async {
            await windowSnapshot("mac-welcome", size: CGSize(width: 900, height: 600)) {
                WelcomeView(notice: nil).tint(MacStyle.accent)
            }
        }

        /// The page's column at the detail pane's usual width, margins included.
        private func page(_ name: String, model: TuneModel, detail: TuneDetail) {
            snapshot(name, width: 780) {
                TunePageSamples.column(model: model, detail: detail)
                    .frame(maxWidth: PageStyle.pageMaxWidth, alignment: .leading)
                    .padding(PageStyle.pageMargin)
                    .frame(maxWidth: .infinity)
                    .tint(MacStyle.accent)
                    .environment(\.sidebarSelection, .constant(.catalog))
            }
        }
    #endif

    private enum Row: Hashable {
        case recording(RecordingRowContent)
        case link(LinkRowContent)
    }

    @Test func undoBanner() {
        snapshot("undo-banner") {
            VStack(spacing: 12) {
                UndoBanner(message: "Archived 3 tunes") {}
                UndoBanner(message: "Removed \"Soldier's Joy\" from Tuesday session") {}
            }
        }
    }

    @Test func facets() {
        snapshot("facets", width: 320) {
            FlowLayout {
                KeyPill("A", suffix: " mix")
                StatusGlyph("learning").font(.subheadline)
                Text("Reel")
                Text("Old-time")
                Text("4/4")
                Text("Violin: Cross A (AEAE)")
                Text("5-string banjo: Open A (aEAC#E)")
            }
            .font(.subheadline)
        }
    }

    private func tuneRows(instruments: Set<String>) -> some View {
        rows(SampleCatalog.entries, id: \.tune.id) { entry in
            TuneRow(tune: entry.tune, userTune: entry.userTune, instruments: instruments, stacked: true)
        }
    }

    /// Rows with separators, standing in for a `List`, which an image renderer cannot draw.
    private func rows<Item, ID: Hashable>(
        _ items: [Item], id: KeyPath<Item, ID>, @ViewBuilder row: @escaping (Item) -> some View
    ) -> some View {
        RowStack(items: items, id: id, row: row)
    }
}

/// Each row inset as ``View/scaledRowInsets()`` insets it in a list, then a separator.
private struct RowStack<Item, ID: Hashable, Row: View>: View {
    let items: [Item]
    let id: KeyPath<Item, ID>
    let row: (Item) -> Row

    @Environment(\.spacing) private var spacing

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(items, id: id) { item in
                row(item)
                    .padding(.vertical, spacing.rowInset)
                Divider()
            }
        }
    }
}

#if os(macOS)
    /// The Mac list column from stand-ins, since an image renderer draws no list: the pane bar,
    /// the list's title with Play and Shuffle, and its rows with their hover actions. `hovered`
    /// is the row under the pointer, `playing` the one the list is on, and `selected` non-nil
    /// is a selection.
    struct MacListColumnStandIn: View {
        var width: CGFloat = 360
        var hovered: Int?
        var playing: Int?
        var selected: Set<String>?

        private var entries: [SampleCatalog.Entry] { [0, 1, 2, 5, 6].map { SampleCatalog.entries[$0] } }

        var body: some View {
            let ids = entries.map(\.tune.id)
            VStack(alignment: .leading, spacing: 0) {
                // The pane bar holds only a selection's actions; at rest the list's own ride on
                // its title's line.
                if let selected {
                    HStack(spacing: 8) {
                        Spacer(minLength: 0)
                        Group {
                            Button(BulkActionText.status, systemImage: "tag") {}.labelStyle(.iconOnly)
                            Button(BulkActionText.addToList, systemImage: "text.badge.plus") {}
                                .labelStyle(.iconOnly)
                            Button(BulkActionText.more, systemImage: "ellipsis") {}.labelStyle(.iconOnly)
                            Button(TuneSelection.done) {}.fontWeight(.semibold)
                        }
                        .disabled(selected.isEmpty)
                        .paneControls()
                        .fixedSize()
                    }
                    .padding(.bottom, 8)
                }
                MacListTitle(
                    name: SampleCatalog.lists[0].name,
                    play: selected == nil
                        ? ListPlayOffer(
                            report: PlaylistReport(playable: Array(ids.prefix(4)), skipped: [:], total: ids.count),
                            canStart: true, onPlay: {}, onShuffle: {}, onWhatPlays: {})
                        : nil
                ) {
                    if selected == nil {
                        Button(ListScreen.addTunes, systemImage: "plus") {}.labelStyle(.iconOnly)
                        Button(TuneScreen.moreActions, systemImage: "ellipsis") {}.labelStyle(.iconOnly)
                    }
                }
                .padding(.top, 4)
                .padding(.bottom, 8)
                ForEach(Array(entries.enumerated()), id: \.element.tune.id) { index, entry in
                    row(entry, index: index)
                }
                // A long list's three digit positions keep the titles in the same column.
                row(entries[3], index: 111)
            }
            .frame(width: width, alignment: .topLeading)
        }

        private func row(_ entry: SampleCatalog.Entry, index: Int) -> some View {
            let isCurrent = index == playing
            let isSelected = selected?.contains(entry.tune.id) == true && index < 100
            return HStack(spacing: 4) {
                MacTuneRow(
                    text: TuneRowText(tune: entry.tune, userTune: entry.userTune, instruments: ["violin"]),
                    position: index + 1)
                if selected == nil {
                    Group {
                        if isCurrent {
                            Image(systemName: "speaker.wave.2.fill").foregroundStyle(MacStyle.accent)
                        } else {
                            Image(systemName: "play.fill")
                        }
                    }
                    .font(MacStyle.body)
                    .frame(width: 24, height: 24)
                    .revealedOnHover(pinned: isCurrent)
                }
            }
            .environment(\.rowHovered, index == hovered)
            .padding(.horizontal, 8)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: 6).fill(MacStyle.accent.opacity(0.18))
                } else if isCurrent || index == hovered {
                    RoundedRectangle(cornerRadius: 6).fill(MacStyle.accent.opacity(isCurrent ? 0.12 : 0.05))
                }
            }
        }
    }

    /// The Mac recordings column from stand-ins: the pane bar, the column title, storage, the
    /// count and sort, and the sample recordings under their plain group headings.
    struct MacRecordingsColumnStandIn: View {
        var dropping = false

        @FocusState private var searchFocused: Bool

        var body: some View {
            let rows = SampleCatalog.recordingRows
            let pairs = zip(SampleCatalog.recordings, rows)
            let unfiled = pairs.filter { $0.0.tuneTitle == nil }.map(\.1)
            let filed = pairs.filter { $0.0.tuneTitle != nil }
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    FilterSearchField(
                        prompt: RecordingsListText.search, query: .constant(""), isFocused: $searchFocused,
                        filterCount: 0, onSubmit: {}, onFilters: {})
                    Button(RecordingImport.upload, systemImage: "square.and.arrow.down") {}
                        .labelStyle(.iconOnly)
                        .paneControls()
                        .fixedSize()
                }
                .padding(.bottom, 8)
                .padding(.horizontal, Self.margin)
                content(rows: rows, unfiled: unfiled, filed: filed)
                    .padding(.horizontal, Self.margin)
                    .overlay {
                        if dropping { DropOverlay() }
                    }
            }
            .frame(width: 360 + 2 * Self.margin, alignment: .topLeading)
            .tint(MacStyle.accent)
            // The column's own edges, past the page's margin, as the outline insets from them.
            .padding(.horizontal, -Self.margin)
        }

        /// A plain list's leading margin plus a row's inset, where the column's text starts.
        private static let margin: CGFloat = 16

        private func content(
            rows: [RecordingRowContent], unfiled: [RecordingRowContent],
            filed: [(SampleCatalog.RecordingEntry, RecordingRowContent)]
        ) -> some View {
            VStack(alignment: .leading, spacing: 0) {
                ColumnTitle(Destination.recordings.title)
                    .padding(.top, 4)
                    .padding(.bottom, 4)
                StorageSummary(storage: SampleCatalog.storage)
                    .padding(.vertical, 4)
                ListHeader(
                    count: RecordingsListText.countLabel(visible: rows.count, total: rows.count),
                    choice: .constant(RecordingSortChoice.default))
                RecordingsGroupHeading(title: RecordingsListText.unfiled)
                ForEach(unfiled, id: \.self) { row in
                    MediaRow(recording: row, perform: { _ in }, onRetry: { _ in }).padding(.vertical, 4)
                }
                RecordingsGroupHeading(title: RecordingsListText.filed)
                ForEach(filed, id: \.1) { entry, row in
                    MediaRow(
                        recording: row,
                        tuneLine: entry.tuneTitle.map { MediaRow.TuneLine(title: $0) {} },
                        perform: { _ in }, onRetry: { _ in }
                    )
                    .padding(.vertical, 4)
                }
            }
        }
    }
#endif

/// A tune page holding everything a tune can, archived, and one holding only its title and type,
/// read from the sample catalog with its scans.
@MainActor
private struct TunePageSamples {
    let root: TemporaryRoot
    let full: (model: TuneModel, detail: TuneDetail)
    let sparse: (model: TuneModel, detail: TuneDetail)

    static func load() async throws -> TunePageSamples {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.makeStore(root: root.url)
        try await SampleScans.add(to: store)
        let entry = SampleCatalog.entries[0]
        let model = TuneModel(store: store, tuneID: entry.tune.id)
        #expect(try await poll { model.shown != nil && model.scans.scans.count == 3 })

        var archived = entry.userTune
        archived.archivedAt = SampleCatalog.now
        archived.playLinkID = SampleCatalog.links[0].id
        let full = TuneDetail(
            tune: entry.tune, userTune: archived, links: SampleCatalog.links,
            recordings: [0, 1, 2, 5].map {
                let sample = SampleCatalog.recordings[$0]
                return TuneRecording(recording: sample.recording, file: sample.file)
            },
            lists: SampleCatalog.lists.enumerated().map { TuneMembership(list: $1, itemID: "item_\($0)") },
            instruments: SampleCatalog.instruments)

        let empty = SampleCatalog.entries[10]
        let sparseModel = TuneModel(store: store, tuneID: empty.tune.id)
        #expect(try await poll { sparseModel.shown != nil })
        let sparse = TuneDetail(
            tune: Tune(id: empty.tune.id, createdAt: SampleCatalog.now, title: "Ways of the World", tuneType: "Reel"),
            userTune: empty.userTune)
        return TunePageSamples(root: root, full: (model, full), sparse: (sparseModel, sparse))
    }

    /// The page's column with every action on offer.
    static func column(model: TuneModel, detail: TuneDetail) -> some View {
        TunePageColumn(
            model: model, detail: detail, editing: .constant(nil), deleting: .constant(nil),
            addingScans: .constant(nil), deletingScan: .constant(nil)
        )
        .environment(
            \.tuneScreenActions,
            TuneScreenActions(
                addToList: { _ in }, addLink: { _ in }, findRecordings: { _, _ in }, record: { _ in },
                readLyrics: { _ in }, viewScans: { _, _, _ in }))
    }
}

#if os(macOS)
    /// Stands `content` on the practice ground for the window's own appearance, as the iPhone's
    /// cover does for the appearance outside it.
    private struct PracticeGroundStandIn<Content: View>: View {
        @ViewBuilder let content: Content

        @Environment(\.colorScheme) private var scheme

        var body: some View {
            content
                .practiceGround(scheme)
                // A Mac window draws its own background behind the stack, which the cover's
                // ground does not reach.
                .background(PhoneStyle.practiceGround(scheme))
        }
    }
#endif
