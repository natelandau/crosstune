#if os(macOS)
    import CrosstuneStore
    import SwiftUI

    /// One tune on the Mac as a document: a centered readable column with the title large in
    /// the content, a quiet facet line, then plain sections for how it sounds, its scans, lyrics,
    /// lists, and notes.
    struct MacTunePage: View {
        let model: TuneModel
        let detail: TuneDetail

        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @State private var risen = false
        @State private var editing: RecordingView?
        @State private var deleting: RecordingView?
        @State private var addingScans: ScanAddChoice?
        @State private var deletingScan: Scan?

        init(model: TuneModel, detail: TuneDetail) {
            self.model = model
            self.detail = detail
        }

        /// What the tune is after its key: modes, type, genre, time, crooked, and parts, each left
        /// out when unset, in the words its facets use.
        nonisolated static func facetLine(_ detail: TuneDetail) -> String {
            let tune = detail.tune
            let parts: [String?] =
                tune.modes + [
                    tune.tuneType, tune.genre, tune.timeSignature, tune.isCrooked ? TuneDetail.crooked : nil,
                    tune.partStructure,
                ]
            return parts.compactMap { $0.flatMap { $0.isEmpty ? nil : $0 } }.joined(separator: " · ")
        }

        var body: some View {
            ScrollView {
                MacTunePageColumn(
                    model: model, detail: detail, editing: $editing, deleting: $deleting,
                    addingScans: $addingScans, deletingScan: $deletingScan,
                    titleRise: risen || reduceMotion ? 0 : 6
                )
                .frame(maxWidth: MacStyle.pageMaxWidth, alignment: .leading)
                .padding(MacStyle.pageMargin)
                .frame(maxWidth: .infinity)
            }
            .onAppear {
                // TuneScreen cross-fades the pages; the new title lifts into place as it does.
                withAnimation(reduceMotion ? nil : .spring(duration: 0.25)) { risen = true }
            }
            .modifier(
                TunePresentations(
                    model: model, editing: $editing, deleting: $deleting, addingScans: $addingScans,
                    deletingScan: $deletingScan))
        }
    }

    /// The page's column, laid out at its full height so a snapshot can draw it without the
    /// scroll view.
    struct MacTunePageColumn: View {
        let model: TuneModel
        let detail: TuneDetail
        @Binding var editing: RecordingView?
        @Binding var deleting: RecordingView?
        @Binding var addingScans: ScanAddChoice?
        @Binding var deletingScan: Scan?
        /// How far below its place the header sits, for the page's arrival.
        var titleRise: CGFloat = 0

        @Environment(\.tuneScreenActions) private var actions
        @State private var editingScans = false

        var body: some View {
            VStack(alignment: .leading, spacing: MacStyle.sectionGap) {
                MacTuneHeader(model: model, detail: detail)
                    .offset(y: titleRise)
                media
                scans
                if detail.hasLyrics {
                    lyrics(LyricLines.lines(detail.tune.lyrics).first?.first.flatMap { $0.isEmpty ? nil : $0 })
                }
                lists
                if detail.notes != nil || detail.learned() != nil {
                    notes
                }
            }
            .font(MacStyle.body)
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        private var media: some View {
            PageSection(TuneScreen.recordingsHeader) {
                TuneMediaAddMenu(model: model, detail: detail)
            } content: {
                VStack(alignment: .leading, spacing: 10) {
                    if detail.recordings.isEmpty && detail.links.isEmpty {
                        PageEmptyNote(title: TuneScreen.noMediaTitle, hint: TuneScreen.noMediaHint)
                    }
                    TuneMediaRows(model: model, detail: detail, editing: $editing, deleting: $deleting)
                    if let failure = model.failure(at: .media) {
                        FailureText(failure)
                    }
                }
            }
        }

        private var scans: some View {
            let scans = model.scans
            let layout = scans.layout
            return PageSection(ScanCopy.scans) {
                ScanHeaderControls(model: scans, editing: $editingScans, adding: $addingScans)
                    // The Mac adds scans one way, so this is a plain button, not a menu whose
                    // items the style would reach.
                    .labelStyle(.iconOnly)
            } content: {
                VStack(alignment: .leading, spacing: 6) {
                    if layout.showsEmptyState {
                        PageEmptyNote(title: ScanCopy.emptyTitle, hint: ScanCopy.emptyHint)
                    } else if editingScans {
                        ScanEditRows(model: scans, deleting: $deletingScan)
                    } else {
                        ScanStrip(model: scans, tuneID: detail.tune.id, wraps: true)
                    }
                    if let failure = scans.failure {
                        FailureText(failure)
                    } else if let note = layout.limitNote {
                        Text(note)
                            .font(MacStyle.secondary)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }

        /// A row that opens the reader, led by the lyrics' first line so the page says which
        /// words it holds, or by the plain label when there is no line to quote.
        private func lyrics(_ firstLine: String?) -> some View {
            PageSection(TuneFieldLabels.lyrics) {
                Button {
                    actions.readLyrics?(detail.tune.id)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "text.quote")
                            .foregroundStyle(.secondary)
                        Text(firstLine ?? TuneScreen.openLyrics)
                            .lineLimit(1)
                            .foregroundStyle(.primary)
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right")
                            .font(MacStyle.secondary.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(actions.readLyrics == nil)
                .help(TuneScreen.openLyrics)
                .accessibilityLabel(TuneScreen.openLyrics)
            }
        }

        private var lists: some View {
            PageSection(TuneScreen.listsHeader) {
                Button(TuneScreen.addToList, systemImage: "plus") {
                    actions.addToList?(detail.userTune.id)
                }
                .labelStyle(.iconOnly)
                .disabled(actions.addToList == nil)
                .help(TuneScreen.addToList)
            } content: {
                VStack(alignment: .leading, spacing: 6) {
                    if detail.lists.isEmpty {
                        Text(TuneScreen.notInList)
                            .foregroundStyle(.secondary)
                    } else {
                        FlowLayout(spacing: 6, lineSpacing: 6) {
                            ForEach(detail.lists) { membership in
                                ListToken(model: model, membership: membership)
                            }
                        }
                    }
                    if let failure = model.failure(at: .lists) {
                        FailureText(failure)
                    }
                }
            }
        }

        private var notes: some View {
            PageSection(TuneScreen.notesHeader) {
                VStack(alignment: .leading, spacing: 6) {
                    if let learned = detail.learned() {
                        Text(learned)
                            .font(MacStyle.secondary)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    if let notes = detail.notes {
                        Text(notes)
                            .lineSpacing(3)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    /// The title, the tune's other names and composer, the key with the facet line, and the
    /// status with every tuning, archived last.
    private struct MacTuneHeader: View {
        let model: TuneModel
        let detail: TuneDetail

        var body: some View {
            VStack(alignment: .leading, spacing: 6) {
                Text(detail.tune.title)
                    .font(MacStyle.pageTitle)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if detail.alternateTitles != nil || detail.tune.composer != nil {
                    VStack(alignment: .leading, spacing: 2) {
                        if let alternateTitles = detail.alternateTitles {
                            Text(alternateTitles)
                        }
                        if let composer = detail.tune.composer {
                            Text("\(TuneScreen.composerLabel): \(composer)")
                        }
                    }
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                }
                facets
                    .padding(.top, 4)
                status
                if let failure = model.failure(at: .screen) {
                    FailureText(failure)
                }
            }
        }

        @ViewBuilder private var facets: some View {
            let line = MacTunePage.facetLine(detail)
            let key = detail.tune.key?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !key.isEmpty || !line.isEmpty {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if !key.isEmpty {
                        KeyPill(key, size: .compact)
                            .accessibilityLabel("\(TuneRowText.keyPrefix) \(key)")
                    }
                    if !line.isEmpty {
                        Text(Self.breakingAfterDots(line))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }

        /// A wrapped line breaks after a middle dot, never before one, so no line starts with a
        /// dot.
        private static func breakingAfterDots(_ line: String) -> String {
            line.replacingOccurrences(of: " · ", with: "\u{00A0}· ")
        }

        private var status: some View {
            let status = detail.userTune.status
            let words = [StatusStyle.label(status)] + detail.tunings
            return HStack(alignment: .firstTextBaseline, spacing: 6) {
                // The word beside the glyph names the status, so the glyph is not read twice.
                StatusGlyph(status)
                    .accessibilityHidden(true)
                Text(Self.breakingAfterDots(words.joined(separator: " · ")))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if detail.isArchived {
                    Text(TuneRowText.archived)
                        .font(MacStyle.secondary.weight(.medium))
                        .foregroundStyle(Color.orange)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Color.orange.opacity(0.18), in: .capsule)
                        .padding(.leading, 2)
                }
            }
        }
    }

    /// A list the tune is in, as a token that opens it, with Remove in its context menu.
    private struct ListToken: View {
        let model: TuneModel
        let membership: TuneMembership

        @Environment(\.colorScheme) private var colorScheme

        var body: some View {
            OpensList(listID: membership.list.id) { _ in
                Label(membership.list.name, systemImage: Destination.lists.systemImage)
                    .labelStyle(TokenLabelStyle())
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(neutralFill(colorScheme), in: .capsule)
                    .contentShape(.capsule)
            }
            .contextMenu { RemoveFromListButton(model: model, membership: membership) }
        }
    }

    private struct TokenLabelStyle: LabelStyle {
        func makeBody(configuration: Configuration) -> some View {
            HStack(spacing: 5) {
                configuration.icon
                    .font(MacStyle.secondary)
                    .foregroundStyle(.secondary)
                configuration.title
                    .foregroundStyle(.primary)
            }
        }
    }
#endif
