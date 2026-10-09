import CrosstuneAuth
import CrosstuneStore
import CrosstuneSync
import Foundation
import SwiftUI

/// The iPhone Settings tab: an account card, the catalog in one card, and a row for each page of
/// settings. Each page keeps the rows, behavior, and help of the long form it was split from.
struct SettingsRoot: View {
    nonisolated static let notSyncedYet = "Not synced yet"
    nonisolated static let syncedPrefix = "Synced"

    /// What the account card says about sync: what needs attention first, else when it last
    /// finished.
    nonisolated static func syncLine(
        attention: SyncStatus?, lastSynced: Date?, now: Date, locale: Locale = .current
    ) -> String {
        if let attention { return attention.label }
        guard let lastSynced else { return notSyncedYet }
        let when = SettingsModel.lastSyncedText(lastSynced, now: now, locale: locale, inSentence: true)
        return String(localized: "\(syncedPrefix) \(when)", locale: locale)
    }

    private let version: String?
    @Environment(AccountSession.self) private var session: AccountSession?
    @Environment(SyncEngine.self) private var engine: SyncEngine?
    @Environment(\.store) private var store
    @Environment(\.colorScheme) private var colorScheme
    @State private var model: SettingsModel?
    @State private var summary: LiveQuery<StatsSummary?>?

    /// - Parameter version: The app's marketing version, which the About page names.
    init(version: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) {
        self.version = version
    }

    var body: some View {
        Form {
            if let session { accountCard(session) }
            if store != nil { statsCard }
            Section {
                ForEach(SettingsCategory.allCases, id: \.self) { category in
                    SettingsPageLink(SettingsPage.category(category)) {
                        LabeledContent {
                            Text(value(category)).foregroundStyle(.secondary)
                        } label: {
                            Label {
                                Text(category.title)
                            } icon: {
                                Image(systemName: category.systemImage).foregroundStyle(BrandStyle.accent)
                            }
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        // On the root, not the pages it opens, so opening a page never counts as another visit.
        .screenView(.settings)
        .navigationDestination(for: SettingsPage.self) { page in
            SettingsPageScreen(page: page, model: model, version: version)
        }
        .navigationTitle(Destination.settings.title)
        .task(id: ModelKey(store: store, engine: engine)) {
            model = store.map { SettingsModel(store: $0, engine: engine) }
            summary = store.map(StatsSummary.live)
        }
    }

    private func value(_ category: SettingsCategory) -> String {
        guard let model, model.isLoaded else { return "" }
        return switch category {
        case .instruments: model.instrumentSummary
        case .newTunes: model.newTunesSummary
        case .musicServices: model.searchProvidersSummary
        default: ""
        }
    }

    private func accountCard(_ session: AccountSession) -> some View {
        Section {
            SettingsPageLink(SettingsPage.account) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(AccountSections.identity(session))
                    TimelineView(.everyMinute) { context in
                        let attention = SyncBadge.attention(
                            status: engine?.status, isOffline: session.isOffline, needsSignIn: session.needsSignIn)
                        let line = Self.syncLine(
                            attention: attention, lastSynced: engine?.lastSyncedAt, now: context.date)
                        if let attention {
                            Text(line)
                                .foregroundStyle(SyncBadge.swatch(attention, scheme: colorScheme).ink.color)
                        } else {
                            Text(line).foregroundStyle(.secondary)
                        }
                    }
                    .font(.footnote)
                }
            }
        }
    }

    private var statsCard: some View {
        Section {
            if let summary = summary?.value ?? nil {
                SettingsPageLink(SettingsPage.stats) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(summary.line).monospacedDigit()
                        let byStatus = summary.byStatus
                        if byStatus.values.contains(where: { $0 > 0 }) {
                            StatusBar(counts: byStatus)
                        }
                    }
                }
            } else {
                // Holds the card's place so the rows below never shift as the figures load.
                Text(verbatim: " ").accessibilityHidden(true)
            }
        }
    }
}

/// A page the Settings root opens: pushed on the iPhone, in the detail column on the iPad.
enum SettingsPage: Hashable {
    case account
    case stats
    case category(SettingsCategory)
}

/// Opens a Settings page somewhere other than the root's own stack, as the iPad's detail column.
struct SettingsPageOpener {
    /// The page open now, which its row marks as selected.
    let current: SettingsPage?
    private let open: @MainActor (SettingsPage) -> Void

    init(current: SettingsPage?, open: @escaping @MainActor (SettingsPage) -> Void) {
        self.current = current
        self.open = open
    }

    @MainActor func callAsFunction(_ page: SettingsPage) {
        open(page)
    }
}

extension EnvironmentValues {
    /// Where the Settings root's rows open their pages. Nil pushes them onto the root's stack.
    @Entry var settingsPageOpener: SettingsPageOpener?
}

/// A Settings root row that opens `page`: a push, or a press handed to the opener.
private struct SettingsPageLink<RowLabel: View>: View {
    let page: SettingsPage
    @ViewBuilder let label: RowLabel

    @Environment(\.settingsPageOpener) private var opener
    @Environment(\.colorScheme) private var colorScheme

    init(_ page: SettingsPage, @ViewBuilder label: () -> RowLabel) {
        self.page = page
        self.label = label()
    }

    var body: some View {
        if let opener {
            Button {
                opener(page)
            } label: {
                HStack {
                    label
                    Image(systemName: "chevron.forward")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(opener.current == page ? .isSelected : [])
            #if os(iOS)
                .listRowBackground(opener.current == page ? Color(uiColor: .systemGray5) : nil)
                // A row's background keeps the appearance it first drew in, so the row is rebuilt
                // when the appearance changes.
                .id(colorScheme)
            #endif
        } else {
            NavigationLink(value: page) { label }
        }
    }
}

/// The page for a `SettingsPage`.
struct SettingsPageScreen: View {
    let page: SettingsPage
    let model: SettingsModel?
    /// The app's marketing version, which the About page names.
    var version: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String

    var body: some View {
        switch page {
        case .account:
            SettingsScreen(
                version: nil, sections: [.account], title: AccountSections.title, opensStatsInSheet: false,
                registersStats: false
            )
            .toolbarTitleDisplayMode(.inline)
        case .stats:
            StatsScreen()
                // A tune opened from the stats screen is not the tab's own pushed tune.
                .environment(\.stackTune, nil)
        case .category(let category):
            SettingsCategoryPage(category: category, model: model, version: version)
        }
    }
}

/// One category's page. A page with rows of its own draws them from the category's
/// `pageRows`; every other page is the settings form showing the category's `sections`.
private struct SettingsCategoryPage: View {
    let category: SettingsCategory
    let model: SettingsModel?
    let version: String?

    @Environment(PlayerModel.self) private var player: PlayerModel?

    var body: some View {
        Group {
            if category.pageRows.isEmpty {
                SettingsScreen(
                    version: version, sections: category.sections, title: category.title, opensStatsInSheet: false,
                    registersStats: false)
            } else if let model, model.isLoaded {
                ownRows(model, rows: category.pageRows)
                    .navigationTitle(category.title)
                    .onAppear {
                        if category.pageRows.contains(.instruments) { model.clearInstrumentsFailure() }
                        if category.pageRows.contains(.musicServices) { model.clearSearchProvidersFailure() }
                    }
            }
        }
        .toolbarTitleDisplayMode(.inline)
    }

    private func ownRows(_ model: SettingsModel, rows: SettingsScreen.Sections) -> some View {
        Form {
            if rows.contains(.instruments) { InstrumentsChoices(model: model) }
            if rows.contains(.musicServices) {
                MusicServicesChoices(model: model)
                Section {
                    PlayFirstPicker(model: model)
                } footer: {
                    SettingsFooter(help: PlayFirstText.help, failure: model.playFirstFailure)
                }
            }
            if rows.contains(.appleMusic), let access = player?.appleMusic?.access {
                AppleMusicSection(access: access)
            }
        }
        .formStyle(.grouped)
    }
}
