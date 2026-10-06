import CrosstuneAuth
import CrosstuneStore
import CrosstuneSync
import Foundation
import SwiftUI

/// The iPhone Settings tab: an account card, the catalog in one card, a row for each page of
/// settings, and the version below. Each page keeps the rows, behavior, and help of the long
/// form it was split from.
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
    @State private var summary: StatsModel?

    /// - Parameter version: The app's marketing version, which the footer names.
    init(version: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) {
        self.version = version
    }

    var body: some View {
        Form {
            if let session { accountCard(session) }
            if store != nil { statsCard }
            Section {
                ForEach(SettingsCategory.allCases, id: \.self) { category in
                    NavigationLink(value: category) {
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
            } footer: {
                if let version { Text(SettingsScreen.aboutLine(version: version)) }
            }
        }
        .formStyle(.grouped)
        .navigationDestination(for: SettingsCategory.self) { category in
            SettingsCategoryPage(category: category, model: model, version: version)
        }
        .modifier(StatsDestination(isPushed: true))
        .navigationTitle(Destination.settings.title)
        .task(id: ModelKey(store: store, engine: engine)) {
            model = store.map { SettingsModel(store: $0, engine: engine) }
            summary = store.map { StatsModel(store: $0, engine: nil, history: false) }
        }
    }

    private func value(_ category: SettingsCategory) -> String {
        guard let model, model.isLoaded else { return "" }
        return switch category {
        case .instruments: model.instrumentSummary
        case .musicServices: model.searchProvidersSummary
        default: ""
        }
    }

    private func accountCard(_ session: AccountSession) -> some View {
        Section {
            NavigationLink {
                SettingsScreen(
                    version: nil, sections: [.account], title: AccountSections.title, opensStatsInSheet: false,
                    registersStats: false
                )
                .toolbarTitleDisplayMode(.inline)
            } label: {
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
            if let line = summary?.summaryLine, let counts = summary?.stats?.counts {
                NavigationLink(value: StatsRoute()) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(line).monospacedDigit()
                        let byStatus = StatusBar.byStatus(counts)
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
                    version: nil, sections: category.sections, title: category.title, opensStatsInSheet: false,
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
