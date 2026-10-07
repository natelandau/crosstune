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

    public var body: some View {
        NavigationStack {
            Group {
                if let model {
                    FindRecordingsForm(model: model, stage: stage)
                } else {
                    Color.clear
                }
            }
            .navigationTitle(Self.title(shown: model?.shown ?? service))
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        .macSheetFrame(MacSheetSize(idealWidth: 520, minHeight: 420))
        // Full height from the start on iOS: the results and the keyboard both need the room.
        .shellSheet()
        .task {
            guard model == nil, let store else { return }
            let player = player
            model = FindRecordingsModel(
                store: store, tuneID: tuneID, service: service, search: search,
                stopPlayer: {
                    if player?.item != nil { player?.close() }
                }, analytics: analytics)
        }
    }
}

private struct FindRecordingsForm: View {
    let model: FindRecordingsModel
    let stage: EmbedStage

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.store) private var store
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(RecorderHost.self) private var recorders: RecorderHost?
    @State private var settings: SettingsModel?
    @State private var showsMusicServices = false

    var body: some View {
        Form {
            if model.hasNoServices {
                noServices
            } else if model.isLoaded {
                Section {
                    TextField(
                        FindRecordingsSheet.searchFor, text: queryBinding, prompt: Text(FindRecordingsSheet.searchFor)
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
        .formStyle(.grouped)
        .toolbar {
            if model.shown != nil && !model.isDirect {
                ToolbarItem(placement: .cancellationAction) {
                    Button(FindRecordingsSheet.back, systemImage: "chevron.backward") { model.back() }
                        .labelStyle(.titleAndIcon)
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(InstrumentsSheet.done) { dismiss() }
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
                Button(SettingsModel.musicServices) {
                    if settings == nil, let store { settings = SettingsModel(store: store, engine: engine) }
                    showsMusicServices = true
                }
            }
        }
    }

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
                        .font(.headline)
                    if let subtitle = result.subtitle {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
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
                    .foregroundStyle(.secondary)
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
                FindRecordingsSheet.searchOn(FindRecordingsSheet.label(group.provider)), systemImage: "arrow.up.right")
        }
    }

    private var queryBinding: Binding<String> {
        Binding {
            model.query
        } set: {
            model.setQuery($0)
        }
    }
}
