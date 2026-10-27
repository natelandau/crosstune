import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneSync
import CrosstuneVocabulary
import SwiftUI

/// Lists the musician's chosen music services for a tune and searches the one they pick: in place
/// for a service the app searches itself, where a result plays inline and links with a tap, or on
/// the service's own search page for any other. Shown over whatever screen asked. Reads the store,
/// the sync engine, and the player from the environment.
public struct FindRecordingsSheet: View {
    nonisolated public static let title = "Find recordings"
    public static let searchFor = "Search for"
    public static let play = "Play"
    public static let link = "Link"
    public static let linked = "Linked"
    public static let searching = "Searching…"
    public static let noResults = "No results"
    public static let noServices = SettingsModel.noServices
    public static let back = "Back"
    public static let done = "Done"

    /// A row for one service, and the tune menu's item when only one service is chosen.
    nonisolated public static func searchService(_ service: String) -> String { "Search \(service)" }
    public static func searchOn(_ service: String) -> String { "Search on \(service)" }
    /// A service that is rate limiting the app or cannot be reached; both read the same to a musician.
    public static func unavailableNow(_ service: String) -> String {
        "\(service) isn't available right now. Try again in a few minutes."
    }

    /// The sheet's title: the shown service's name, or the sheet's own on the list of services.
    static func title(shown: String?) -> String {
        shown.map(label) ?? title
    }

    /// The words under a service's group: why it found nothing, or nil when it has rows or is
    /// search-only.
    static func footer(_ group: SearchGroup) -> String? {
        switch group.status {
        case .unavailable: unavailableNow(label(group.provider))
        case .results: group.results.isEmpty ? noResults : nil
        case .searchOnly: nil
        }
    }

    nonisolated static func label(_ provider: String) -> String {
        Vocabulary.providerLabels[provider] ?? provider
    }

    private let tuneID: String
    private let service: String?

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(PlayerModel.self) private var player: PlayerModel?
    @State private var model: FindRecordingsModel?
    /// The sheet's own player, so a result playing here never takes the dock's link from it.
    @State private var stage = EmbedStage()

    /// - Parameter service: Opens straight on this service's results and searches it, with no
    ///   list to go back to, for a musician who chose only this service.
    public init(tuneID: String, service: String? = nil) {
        self.tuneID = tuneID
        self.service = service
    }

    private var search: FindRecordingsModel.Search? {
        guard let engine else { return nil }
        return { q, providers, country in await engine.searchRecordings(q: q, providers: providers, country: country) }
    }

    #if os(macOS)
        /// One height for the services and a service's results, so going between them or results
        /// arriving never resizes the sheet; short enough that the services leave little empty.
        static let macSize = MacSheetSize(idealWidth: 520, minHeight: 440, idealHeight: 440)
    #endif

    public var body: some View {
        // Full height from the start on iOS: the results and the keyboard both need the room.
        platformBody
            .shellSheet()
            .screenView(.findRecordings)
            .task { makeModel() }
    }

    @ViewBuilder private var platformBody: some View {
        #if os(macOS)
            if let model {
                FindRecordingsForm(model: model, stage: stage)
            } else {
                Color.clear.macSheetFrame(Self.macSize)
            }
        #else
            NavigationStack {
                Group {
                    if let model {
                        FindRecordingsForm(model: model, stage: stage)
                    } else {
                        Color.clear
                    }
                }
                .navigationTitle(Self.title(shown: model?.shown ?? service))
                .navigationBarTitleDisplayMode(.inline)
            }
        #endif
    }

    private func makeModel() {
        guard model == nil, let store else { return }
        let player = player
        model = FindRecordingsModel(
            store: store, tuneID: tuneID, service: service, search: search,
            stopPlayer: {
                if player?.item != nil { player?.close() }
            }, analytics: analytics)
    }
}

private struct FindRecordingsForm: View {
    let model: FindRecordingsModel
    let stage: EmbedStage

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @State private var settings: SettingsModel?
    @State private var showsMusicServices = false
    @FocusState private var searchFocused: Bool

    #if os(macOS)
        /// Escape empties the search first; then Back takes it where there is a list of services
        /// to go back to, and with none it closes the sheet. Return belongs to the search.
        var body: some View {
            MacSheet(
                title: FindRecordingsSheet.title(shown: model.shown), size: FindRecordingsSheet.macSize,
                cancel: canGoBack ? .cancel(FindRecordingsSheet.back) { model.back() } : nil,
                primary: .init(FindRecordingsSheet.done, isDefault: false) { dismiss() },
                escape: {
                    FilterSearchField.escape(clearing: queryBinding) {
                        if canGoBack { model.back() } else { dismiss() }
                    }
                }
            ) {
                VStack(alignment: .leading, spacing: 0) {
                    if model.hasNoServices {
                        macNoServices
                    } else if model.isLoaded {
                        FilterSearchField(
                            prompt: FindRecordingsSheet.searchFor, query: queryBinding, isFocused: $searchFocused,
                            filterCount: nil, onSubmit: { Task { await model.submit() } }
                        )
                        .padding(.horizontal, MacStyle.sheetMargin)
                        .padding(.top, 4)
                        .padding(.bottom, 8)
                        if hasStatus {
                            status
                                .font(MacStyle.secondary)
                                .foregroundStyle(Palette.textSecondary)
                                .padding(.horizontal, MacStyle.sheetMargin)
                                .padding(.bottom, 8)
                        }
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 2) {
                                if model.shown == nil {
                                    ForEach(model.providers, id: \.self, content: macServiceRow)
                                } else if let group = model.group {
                                    if group.status == .results {
                                        ForEach(group.results, id: \.url, content: macResultRow)
                                    }
                                    macSearchOnRow(group)
                                    if let footer = FindRecordingsSheet.footer(group) {
                                        Text(footer)
                                            .font(MacStyle.secondary)
                                            .foregroundStyle(Palette.textSecondary)
                                            .padding(.horizontal, 8)
                                            .padding(.top, 4)
                                    }
                                }
                            }
                            .padding(.horizontal, MacStyle.sheetMargin - 8)
                            .padding(.bottom, 12)
                        }
                        .scrollBounceBehavior(.basedOnSize)
                    }
                }
            }
            .onDisappear { model.cancel() }
            .sheet(isPresented: $showsMusicServices) {
                if let settings { MusicServicesSheet(model: settings) }
            }
        }

        private var hasStatus: Bool {
            model.isSearching || model.failure != nil || model.linkFailure != nil
        }

        private var macNoServices: some View {
            VStack(alignment: .leading, spacing: 12) {
                Text(FindRecordingsSheet.noServices)
                    .font(MacStyle.body)
                    .foregroundStyle(Palette.textSecondary)
                Button(SettingsModel.musicServices, action: openMusicServices)
                    .buttonStyle(.macSecondary)
            }
            .padding(.horizontal, MacStyle.sheetMargin)
            .padding(.top, 4)
        }

        /// A leading glyph for what a row opens: a search here, or a page in the browser.
        private func macRowGlyph(_ name: String) -> some View {
            Image(systemName: name)
                .font(.system(size: 12))
                .foregroundStyle(Palette.textSecondary)
                .frame(width: MacPickGlyph.width)
                .accessibilityHidden(true)
        }

        /// The trailing mark every row shares: where the row goes, at one size and color.
        private func macTrailingMark(_ name: String) -> some View {
            Image(systemName: name)
                .font(MacStyle.rowChevron)
                .foregroundStyle(Palette.textSecondary)
                .accessibilityHidden(true)
        }

        private func macServiceRow(_ provider: String) -> some View {
            let inApp = FindRecordingsModel.searchesInApp(provider)
            return Button {
                Task {
                    if let url = await model.pick(provider) { openURL(url) }
                }
            } label: {
                HStack(spacing: 8) {
                    macRowGlyph(inApp ? "magnifyingglass" : "globe")
                    Text(FindRecordingsSheet.searchService(FindRecordingsSheet.label(provider)))
                    Spacer(minLength: 0)
                    macTrailingMark(inApp ? "chevron.forward" : "arrow.up.right")
                }
            }
            .buttonStyle(.macPickRow)
        }

        private func macSearchOnRow(_ group: SearchGroup) -> some View {
            Button {
                if let url = URL(string: group.searchURL) { openURL(url) }
            } label: {
                HStack(spacing: 8) {
                    macRowGlyph("globe")
                    Text(FindRecordingsSheet.searchOn(FindRecordingsSheet.label(group.provider)))
                    Spacer(minLength: 0)
                    macTrailingMark("arrow.up.right")
                }
            }
            .buttonStyle(.macPickRow)
        }

        private func macResultRow(_ result: SearchResult) -> some View {
            let embed = FindRecordingsModel.embed(for: result)
            let expanded = embed != nil && model.playing == result.url
            let linked = model.linkedURLs.contains(result.url)
            let linkTitle = linked ? FindRecordingsSheet.linked : FindRecordingsSheet.link
            return VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(result.title)
                            .contentMask()
                            .font(MacStyle.body)
                            .foregroundStyle(Palette.textPrimary)
                        if let subtitle = result.subtitle {
                            Text(subtitle)
                                .font(MacStyle.secondary)
                                .foregroundStyle(Palette.textSecondary)
                        }
                    }
                    Spacer(minLength: 0)
                    if embed != nil {
                        Button(FindRecordingsSheet.play, systemImage: "play.fill") { model.play(result) }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.mac(.icon, size: .small))
                            .help(FindRecordingsSheet.play)
                            .accessibilityLabel("\(FindRecordingsSheet.play) \(result.title)")
                            .accessibilityAddTraits(expanded ? .isSelected : [])
                            // A player sounding now would be recorded along with the instrument.
                            .disabled(recorders?.isCapturing ?? false)
                    }
                    Button {
                        Task { await model.link(result) }
                    } label: {
                        if linked {
                            Label(linkTitle, systemImage: "checkmark")
                        } else {
                            Text(linkTitle)
                        }
                    }
                    .buttonStyle(MacChipStyle(state: linked ? .rest : .set, size: .row))
                    .accessibilityLabel("\(linkTitle) \(result.title)")
                    .disabled(linked)
                }
                .padding(.horizontal, 8)
                .frame(minHeight: MacPickRowStyle.minHeight)
                if expanded, let embed {
                    embedView(embed)
                        .padding(.horizontal, 8)
                }
            }
            .padding(.vertical, 2)
        }
    #else
        var body: some View {
            phoneBody
        }
    #endif

    private func openMusicServices() {
        if settings == nil, let store { settings = SettingsModel(store: store, engine: engine, analytics: analytics) }
        showsMusicServices = true
    }

    @ViewBuilder private func embedView(_ embed: Embed) -> some View {
        Group {
            if embed.height == .video {
                EmbedView(stage: stage, embed: embed)
                    .aspectRatio(16 / 9, contentMode: .fit)
            } else {
                EmbedView(stage: stage, embed: embed)
                    .frame(height: CGFloat(embed.points))
            }
        }
        .clipShape(.rect(cornerRadius: 12))
    }

    #if os(iOS)
        private var phoneBody: some View {
            GroupedForm {
                if model.hasNoServices {
                    noServices
                } else if model.isLoaded {
                    Section {
                        TextField(
                            FindRecordingsSheet.searchFor, text: queryBinding,
                            prompt: Text(FindRecordingsSheet.searchFor)
                        )
                        .contentMask()
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .onSubmit { Task { await model.submit() } }
                    } footer: {
                        status
                    }
                    if model.shown == nil {
                        Section { ForEach(model.providers, id: \.self, content: serviceRow) }
                    } else if let group = model.group {
                        groupSection(group)
                    }
                }
            }
            .toolbar {
                if model.shown != nil && !model.isDirect {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(FindRecordingsSheet.back, systemImage: "chevron.backward") { model.back() }
                            .labelStyle(.titleAndIcon)
                    }
                }
                ConfirmToolbarItem {
                    Button(FindRecordingsSheet.done) { dismiss() }
                }
            }
            .onDisappear { model.cancel() }
            .sheet(isPresented: $showsMusicServices) {
                if let settings { MusicServicesSheet(model: settings) }
            }
        }

        private var noServices: some View {
            Section {
                ContentUnavailableView {
                    Label(FindRecordingsSheet.noServices, systemImage: "slider.horizontal.3")
                } actions: {
                    Button(SettingsModel.musicServices, action: openMusicServices)
                }
            }
        }

    #endif

    private var status: some View {
        VStack(alignment: .leading, spacing: 4) {
            if model.isSearching {
                Text(FindRecordingsSheet.searching)
            } else if let failure = model.failure {
                Text(failure)
                    .foregroundStyle(.red)
            }
            // On a line of its own, so a search starting or failing never hides it.
            if let linkFailure = model.linkFailure {
                Text(linkFailure)
                    .foregroundStyle(.red)
            }
        }
    }

    #if os(iOS)
        /// One service's answer. Its own search page always closes the section, found or not.
        private func groupSection(_ group: SearchGroup) -> some View {
            Section {
                if group.status == .results {
                    ForEach(group.results, id: \.url, content: resultRow)
                }
                searchOnRow(group)
            } footer: {
                if let footer = FindRecordingsSheet.footer(group) {
                    Text(footer)
                }
            }
        }

        private func resultRow(_ result: SearchResult) -> some View {
            let embed = FindRecordingsModel.embed(for: result)
            let expanded = embed != nil && model.playing == result.url
            let linked = model.linkedURLs.contains(result.url)
            return VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(result.title)
                            .contentMask()
                            .font(.platform(.headline))
                        if let subtitle = result.subtitle {
                            Text(subtitle)
                                .font(.platform(.subheadline))
                                .foregroundStyle(.textSecondary)
                        }
                    }
                    Spacer(minLength: 0)
                    if embed != nil {
                        Button(FindRecordingsSheet.play) { model.play(result) }
                            .accessibilityLabel("\(FindRecordingsSheet.play) \(result.title)")
                            .accessibilityAddTraits(expanded ? .isSelected : [])
                            // A player sounding now would be recorded along with the instrument.
                            .disabled(recorders?.isCapturing ?? false)
                    }
                    Button(linked ? FindRecordingsSheet.linked : FindRecordingsSheet.link) {
                        Task { await model.link(result) }
                    }
                    .accessibilityLabel(
                        "\(linked ? FindRecordingsSheet.linked : FindRecordingsSheet.link) \(result.title)"
                    )
                    .disabled(linked)
                }
                .buttonStyle(.borderless)
                if expanded, let embed {
                    embedView(embed)
                }
            }
        }

        /// A service on the list: one the app searches opens its results, and any other opens its
        /// own search page while the list stays.
        private func serviceRow(_ provider: String) -> some View {
            let inApp = FindRecordingsModel.searchesInApp(provider)
            return Button {
                Task {
                    if let url = await model.pick(provider) { openURL(url) }
                }
            } label: {
                HStack {
                    Text(FindRecordingsSheet.searchService(FindRecordingsSheet.label(provider)))
                        .foregroundStyle(.primary)
                    Spacer(minLength: 0)
                    Image(systemName: inApp ? "chevron.forward" : "arrow.up.right")
                        .foregroundStyle(.textSecondary)
                        .accessibilityHidden(true)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }

        private func searchOnRow(_ group: SearchGroup) -> some View {
            Button {
                if let url = URL(string: group.searchURL) { openURL(url) }
            } label: {
                Label(
                    FindRecordingsSheet.searchOn(FindRecordingsSheet.label(group.provider)),
                    systemImage: "arrow.up.right")
            }
        }

    #endif

    private var canGoBack: Bool { model.shown != nil && !model.isDirect }

    private var queryBinding: Binding<String> {
        Binding {
            model.query
        } set: {
            model.setQuery($0)
        }
    }
}
