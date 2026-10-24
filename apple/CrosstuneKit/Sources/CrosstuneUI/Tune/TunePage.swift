import CrosstuneAnalytics
import CrosstuneStore
import SwiftUI

/// One tune as a document: the band with its key, title, and verbs across the top, then the
/// content beside the facts rail, or under the facts card where the column is narrow.
struct TunePage: View {
    let model: TuneModel
    let detail: TuneDetail
    /// More's items the screen carries out, where More sits on the title's row.
    let more: TuneMoreHandlers?
    /// Opens the whole tune form on its lyrics field.
    let onAddLyrics: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var risen = false
    @State private var titleShows = true
    /// Nil until the detail column's width is read, so a wide column never shows the card first.
    @State private var factsLayout: FactsLayout?
    /// The bar's height over the scroll view's top edge, where the rail pins.
    @State private var barInset: CGFloat = 0
    // periphery:ignore - read through its binding
    @State private var editing: RecordingView?
    // periphery:ignore - read through its binding
    @State private var deleting: RecordingView?
    // periphery:ignore - read through its binding
    @State private var addingScans: ScanAddChoice?
    // periphery:ignore - read through its binding
    @State private var deletingScan: Scan?

    /// Whether the page replaces the new-tune draft its tune was made on.
    private let replacesDraft: Bool

    /// - Parameter draftLayout: The layout the new-tune draft this page replaces read for the
    ///   column, so the page shows on its first frame.
    init(
        model: TuneModel, detail: TuneDetail, draftLayout: FactsLayout? = nil, more: TuneMoreHandlers? = nil,
        onAddLyrics: @escaping () -> Void
    ) {
        self.model = model
        self.detail = detail
        self.more = more
        self.onAddLyrics = onAddLyrics
        replacesDraft = draftLayout != nil
        _factsLayout = State(initialValue: draftLayout)
    }

    var body: some View {
        ScrollView {
            TunePageColumn(
                model: model, detail: detail, layout: factsLayout ?? .card, pinnedTop: barInset + Self.railPinGap,
                editing: $editing, deleting: $deleting, addingScans: $addingScans, deletingScan: $deletingScan,
                more: more, onAddLyrics: onAddLyrics,
                // The title a draft became is already in its place.
                titleRise: risen || reduceMotion || replacesDraft ? 0 : PageStyle.titleRise,
                onTitleShows: { titleShows = $0 }
            )
            .opacity(factsLayout == nil ? 0 : 1)
        }
        .onScrollGeometryChange(for: CGFloat.self, of: { $0.contentInsets.top }) { _, top in barInset = top }
        .readsFactsLayout(
            into: Binding {
                factsLayout ?? .card
            } set: {
                factsLayout = $0
            }
        )
        .paperGround()
        .onAppear {
            // TuneScreen cross-fades the pages; the new title lifts into place as it does.
            withAnimation(reduceMotion ? nil : .spring(duration: 0.25)) { risen = true }
        }
        .barTitle(detail.tune.title, shown: !titleShows)
        .modifier(
            TunePresentations(
                model: model, editing: $editing, deleting: $deleting, addingScans: $addingScans,
                deletingScan: $deletingScan))
    }

    /// Air between the bar and the pinned rail's first row.
    private static let railPinGap: CGFloat = 8
}

/// The page's band and column, laid out at full height so a snapshot can draw it without the
/// scroll view.
struct TunePageColumn: View {
    let model: TuneModel
    let detail: TuneDetail
    var layout: FactsLayout = .card
    /// How far below the scroll view's top edge the facts rail pins.
    var pinnedTop: CGFloat = 0
    @Binding var editing: RecordingView?
    @Binding var deleting: RecordingView?
    @Binding var addingScans: ScanAddChoice?
    @Binding var deletingScan: Scan?
    /// More's items the screen carries out; nil leaves More off the title's row.
    var more: TuneMoreHandlers?
    /// Opens the whole tune form on its lyrics field, where lyrics are written and edited.
    var onAddLyrics: () -> Void = {}
    /// How far below its place the band sits, for the page's arrival.
    var titleRise: CGFloat = 0
    /// Hears whether the title is on screen as the page scrolls.
    var onTitleShows: (Bool) -> Void = { _ in }

    @Environment(\.tuneScreenActions) private var actions
    @Environment(\.lyricsZoom) private var lyricsZoom
    @Environment(\.premium) private var premium
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var editingScans = false
    @State private var lyricsOpen = false

    /// The parts of a tune's content column, in the order the page shows them.
    enum Section: Hashable {
        case recordings, lyrics, scans, notes, addLine, lists
    }

    /// What the add line offers: the sections the tune lacks.
    enum AddLineItem: Hashable {
        case lyrics, scan
    }

    /// Recordings and Notes always; Lyrics once the tune has lyrics; Scans and images once it
    /// has a scan; the add line while it offers something; and Lists where the facts show as a
    /// card, which leaves the lists out.
    nonisolated static func sections(
        _ detail: TuneDetail, scans: Int, addLine: [AddLineItem], listsAtEnd: Bool = false
    ) -> [Section] {
        var sections: [Section] = [.recordings]
        if detail.hasLyrics { sections.append(.lyrics) }
        if scans > 0 { sections.append(.scans) }
        sections.append(.notes)
        if !addLine.isEmpty { sections.append(.addLine) }
        if listsAtEnd { sections.append(.lists) }
        return sections
    }

    /// Lyrics while the tune has none; a scan once the scans have read and none is being added,
    /// so it never offers one the tune may already hold, and only where adding can act.
    nonisolated static func addLine(
        _ detail: TuneDetail, scans: Int, scansLoaded: Bool, addingScans: Bool, scanAddable: Bool
    ) -> [AddLineItem] {
        (detail.hasLyrics ? [] : [.lyrics])
            + (scansLoaded && scans == 0 && !addingScans && scanAddable ? [.scan] : [])
    }

    /// The verses the Lyrics section shows under its heading: none while closed, else the whole
    /// lyrics as the reader parses them, one verse per run of lines between blank ones.
    nonisolated static func lyricsShown(_ detail: TuneDetail, open: Bool) -> [[String]]? {
        guard open else { return nil }
        return LyricLines.lines(detail.tune.lyrics)
    }

    /// Whether Recordings opens on the start card, which is then the one way to add.
    nonisolated static func startsWithCard(_ detail: TuneDetail) -> Bool {
        detail.recordings.isEmpty && detail.links.isEmpty
    }

    var body: some View {
        ScrollViewReader { proxy in
            column { showLyrics(proxy) }
        }
    }

    /// Opens Lyrics and brings its heading to the top of the page.
    private func showLyrics(_ proxy: ScrollViewProxy) {
        withAnimation(reduceMotion ? nil : .default) {
            lyricsOpen = true
            proxy.scrollTo(Section.lyrics, anchor: .top)
        }
    }

    private func column(onShowLyrics: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            TuneBand(
                model: model, detail: detail, more: more, onShowLyrics: onShowLyrics, onTitleShows: onTitleShows
            )
            .offset(y: titleRise)
            .tuneBandPlacement(layout)
            switch layout {
            case .rail:
                HStack(alignment: .top, spacing: 0) {
                    content
                        .padding([.horizontal, .bottom], PageStyle.pageMargin)
                        .frame(maxWidth: Self.columnMaxWidth, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    facts
                }
                // The rail fills the row's height, so its hairline and its pin reach the content's end.
                .fixedSize(horizontal: false, vertical: true)
            case .card:
                VStack(alignment: .leading, spacing: PageStyle.sectionGap) {
                    facts
                    content
                }
                .padding([.horizontal, .bottom], PageStyle.pageMargin)
                .frame(maxWidth: Self.columnMaxWidth, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .font(PageStyle.body)
    }

    /// The column's width with its margins.
    fileprivate static var columnMaxWidth: CGFloat { PageStyle.pageMaxWidth + 2 * PageStyle.pageMargin }

    private var facts: some View {
        TuneFacts(model: model, detail: detail, layout: layout, pinnedTop: pinnedTop, onAddToList: addToList)
    }

    private var addToList: (() -> Void)? {
        actions.addToList.map { add in { add(detail.userTune.id) } }
    }

    /// What the add line offers now.
    private var addLineItems: [AddLineItem] {
        let scans = model.scans
        let layout = scans.layout
        return Self.addLine(
            detail, scans: layout.scanCount, scansLoaded: scans.isLoaded, addingScans: scans.isAdding,
            // A free plan's add offers Premium, which needs the presenter to open.
            scanAddable: !layout.gatesAdd || premium != nil)
    }

    private var content: some View {
        let scans = model.scans
        let addLine = addLineItems
        let sections = Self.sections(
            detail, scans: scans.layout.scanCount, addLine: addLine, listsAtEnd: layout == .card)
        return VStack(alignment: .leading, spacing: PageStyle.sectionGap) {
            ForEach(sections, id: \.self) { section in
                switch section {
                case .recordings: media
                case .lyrics: lyrics.id(Section.lyrics)
                case .scans: scansSection
                case .notes: notes
                case .addLine: addLineView(addLine)
                case .lists: lists
                }
            }
            // A first add that failed leaves no Scans and images section to say so.
            if !sections.contains(.scans), let failure = scans.failure {
                FailureText(failure)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var media: some View {
        let startsWithCard = Self.startsWithCard(detail)
        return PageSection(TuneScreen.recordingsHeader, maxWidth: PageStyle.sectionMaxWidth) {
            if !startsWithCard {
                TuneMediaAddMenu(model: model, detail: detail)
            }
        } content: {
            VStack(alignment: .leading, spacing: Self.mediaRowGap) {
                if startsWithCard {
                    FirstRecordingCard(model: model, detail: detail)
                } else {
                    TuneMediaRows(model: model, detail: detail, editing: $editing, deleting: $deleting)
                        #if os(macOS)
                            .environment(\.hangsMediaGlyph, true)
                            .environment(\.mediaNoticeInHeading, true)
                        #endif
                }
                if let failure = model.failure(at: .media) {
                    FailureText(failure)
                }
            }
        }
    }

    #if os(macOS)
        static let mediaRowGap: CGFloat = 8
    #else
        static let mediaRowGap: CGFloat = 10
    #endif

    /// The lyrics under a heading that opens them in place, with Edit and the reader trailing.
    private var lyrics: some View {
        PageSection(TuneFieldLabels.lyrics, maxWidth: PageStyle.sectionMaxWidth, expanded: $lyricsOpen) {
            lyricsControls
        } content: {
            if let verses = Self.lyricsShown(detail, open: lyricsOpen) {
                PageVerses(verses: verses)
            }
        }
    }

    private var lyricsControls: some View {
        HStack(spacing: 4) {
            #if os(macOS)
                // A glyph like the other headings' pencils, so a page has one edit idiom.
                Button(LyricsReader.editLyrics, systemImage: "pencil", action: onAddLyrics)
                    .labelStyle(.iconOnly)
                    .help(LyricsReader.editLyrics)
            #else
                Button(ScanCopy.edit, action: onAddLyrics)
                    .font(.platform(.body))
                    .accessibilityLabel(LyricsReader.editLyrics)
            #endif
            if let readLyrics = actions.readLyrics {
                Button(TuneScreen.openLyrics, systemImage: "arrow.up.left.and.arrow.down.right") {
                    readLyrics(detail.tune.id)
                }
                .labelStyle(.iconOnly)
                .zoomSource(id: detail.tune.id, in: lyricsZoom)
                #if os(macOS)
                    .help(TuneScreen.openLyrics)
                #endif
            }
        }
    }

    private var scansSection: some View {
        let scans = model.scans
        let layout = scans.layout
        return PageSection(TuneScreen.scansHeader, maxWidth: PageStyle.sectionMaxWidth) {
            if !layout.showsEmptyState {
                ScanHeaderControls(model: scans, editing: $editingScans, adding: $addingScans)
            }
        } content: {
            VStack(alignment: .leading, spacing: 6) {
                if !layout.showsEmptyState {
                    if editingScans {
                        ScanEditRows(model: scans, deleting: $deletingScan)
                    } else {
                        ScanStrip(model: scans, tuneID: detail.tune.id)
                    }
                }
                if let failure = scans.failure {
                    FailureText(failure)
                } else if let note = layout.limitNote {
                    Text(note)
                        .font(PageStyle.secondary)
                        .foregroundStyle(.inkSecondary)
                }
            }
        }
    }

    private var notes: some View {
        PageSection(TuneScreen.notesHeader, maxWidth: PageStyle.sectionMaxWidth) {
            NotesField(model: model, stored: detail.userTune.notes)
        }
    }

    /// The lists the tune is in and the day it was added, ending the page where the facts show
    /// as a card.
    private var lists: some View {
        VStack(alignment: .leading, spacing: PageStyle.sectionGap) {
            if !detail.lists.isEmpty || addToList != nil {
                PageSection(FactCopy.listsGroup, maxWidth: PageStyle.sectionMaxWidth) {
                    TuneListTokens(model: model, detail: detail, onAddToList: addToList)
                }
            }
            AddedOn(detail: detail, endsPage: true)
                .frame(maxWidth: PageStyle.sectionMaxWidth, alignment: .leading)
        }
    }

    /// Small actions for the sections the tune lacks, at the column's end.
    private func addLineView(_ items: [AddLineItem]) -> some View {
        let layout = model.scans.layout
        return FlowLayout(spacing: 4, lineSpacing: PageStyle.tokenLineGap(4)) {
            ForEach(items, id: \.self) { item in
                switch item {
                case .scan:
                    ScanAddMenu(
                        isEnabled: true, choice: $addingScans,
                        onGate: layout.gatesAdd ? offerPremiumForScans : nil
                    ) {
                        Label(TuneScreen.addScanText, systemImage: "plus")
                    }
                    .accessibilityLabel(TuneScreen.addScan)
                case .lyrics:
                    Button(action: onAddLyrics) {
                        Label(TuneScreen.addLyricsText, systemImage: "plus")
                    }
                    .accessibilityLabel(TuneScreen.addLyrics)
                }
            }
        }
        .menuIndicator(.hidden)
        .menuStyle(.button)
        .modifier(AddLineStyle())
        // The first action's plus starts at the column's text edge, past its button's inset.
        .padding(.leading, -AddLineStyle.inset)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(TuneScreen.addToTune)
    }

    private func offerPremiumForScans() {
        ScansSection.offerPremiumForAdd(premium)
    }
}

extension View {
    /// Places the band at the top of the page: within the page's margins, across the detail
    /// column beside a rail, and in the content column's width over a card. The new-tune draft
    /// places its band the same way.
    func tuneBandPlacement(_ layout: FactsLayout) -> some View {
        padding(.horizontal, PageStyle.pageMargin)
            #if !os(macOS)
                .padding(.top, PageStyle.pageMargin)
            #endif
            .padding(.bottom, PageStyle.sectionGap)
            .frame(maxWidth: layout == .rail ? .infinity : TunePageColumn.columnMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: layout == .rail ? .leading : .center)
    }
}

/// Lyrics in body text on the page: each line its own paragraph, a wrap hung under it so it
/// reads apart from a new line, and verses a line's height apart. Each line's words select, so
/// they can be copied.
private struct PageVerses: View {
    let verses: [[String]]

    #if os(macOS)
        private let pointSize = MacStyle.bodySize
    #else
        @ScaledMetric(relativeTo: .body) private var pointSize: CGFloat = 17
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: pointSize * 0.9) {
            ForEach(Array(verses.enumerated()), id: \.offset) { _, verse in
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(verse.enumerated()), id: \.offset) { _, line in
                        LyricLineText(text: line, pointSize: pointSize, lineSpacing: 0, selectable: true)
                    }
                }
            }
        }
        .contentMask()
    }
}

/// The add line's actions, in the platform's existing quiet styles.
private struct AddLineStyle: ViewModifier {
    /// How far each style draws its label in from the button's edge.
    #if os(macOS)
        static let inset: CGFloat = 0
    #else
        static let inset: CGFloat = 6
    #endif

    func body(content: Content) -> some View {
        #if os(macOS)
            content.buttonStyle(MacButtonStyle(.quiet, size: .small))
        #else
            content.buttonStyle(PageControlStyle())
        #endif
    }
}

/// A list the tune is in, as a token that opens it, with Remove in its context menu.
struct ListToken: View {
    let model: TuneModel
    let membership: TuneMembership

    var body: some View {
        OpensList(listID: membership.list.id) { _ in
            #if os(macOS)
                Label(membership.list.name, systemImage: Destination.lists.systemImage)
                    .contentMask()
                    .labelStyle(TokenLabelStyle())
                    .macChip(state: .rest, size: .standalone)
            #else
                Label(membership.list.name, systemImage: Destination.lists.systemImage)
                    .contentMask()
                    .labelStyle(TokenLabelStyle())
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .frame(minHeight: PageStyle.smallControlHeight)
                    .background(.neutralFill, in: .capsule)
                    .contentShape(.capsule)
                    .tapTarget(visibleHeight: PageStyle.smallControlHeight, minimum: PageStyle.minTarget)
            #endif
        }
        .contextMenu { RemoveFromListButton(model: model, membership: membership) }
    }
}

private struct TokenLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 5) {
            configuration.icon
                .font(PageStyle.secondary)
                .foregroundStyle(.inkSecondary)
            configuration.title
                .foregroundStyle(.primary)
        }
    }
}
