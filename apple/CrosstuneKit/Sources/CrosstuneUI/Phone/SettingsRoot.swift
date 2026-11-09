import CrosstuneAuth
import CrosstuneDesign
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
    @State private var summary: LiveQuery<StatsSummary?>?
    @State private var summaries: LiveQuery<SettingsSummaries?>?
    @Environment(\.settingsPageShown) private var pageShown
    @Environment(\.settingsPageOpener) private var opener
    @AppStorage(Appearance.storageKey) private var appearance: Appearance = .system

    /// - Parameter version: The app's marketing version, which the About page names.
    init(version: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) {
        self.version = version
    }

    var body: some View {
        form
            // On the root, not the pages it opens, so opening a page never counts as another visit.
            .screenView(.settings)
            .navigationDestination(for: SettingsPage.self) { page in
                SettingsPageScreen(page: page, version: version)
                    .onAppear { pageShown?(page) }
            }
            .navigationTitle(Destination.settings.title)
            .task(id: store.map(ObjectIdentifier.init)) {
                summary = store.map(StatsSummary.live)
                summaries = store.map(SettingsSummaries.live)
            }
    }

    /// Rows that push their pages, or, beside a detail column, rows chosen as the column's
    /// selection, the open page's row selected.
    @ViewBuilder private var form: some View {
        if let opener {
            GroupedSelectionForm(
                selection: Binding {
                    opener.current
                } set: {
                    if let page = $0 { opener(page) }
                }
            ) {
                rows
            }
        } else {
            GroupedForm { rows }
        }
    }

    @ViewBuilder private var rows: some View {
        if let session { accountCard(session) }
        if store != nil { statsCard }
        Section {
            ForEach(SettingsCategory.allCases, id: \.self) { category in
                SettingsPageLink(SettingsPage.category(category)) {
                    LabeledContent {
                        Text(category.summary(summaries?.value ?? nil, appearance: appearance))
                            .foregroundStyle(.textSecondary)
                    } label: {
                        Label {
                            Text(category.title)
                        } icon: {
                            Image(systemName: category.systemImage).foregroundStyle(.textSecondary)
                        }
                    }
                }
            }
        }
    }

    private func accountCard(_ session: AccountSession) -> some View {
        Section {
            SettingsPageLink(SettingsPage.account) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(AccountSections.identity(session))
                    TimelineView(.everyMinute) { context in
                        let attention = SyncBadge.attention(
                            status: engine?.status, isOffline: session.isOffline, needsSignIn: session.needsSignIn,
                            updateRequired: session.updateRequired)
                        let line = Self.syncLine(
                            attention: attention, lastSynced: engine?.lastSyncedAt, now: context.date)
                        if let attention {
                            Text(line)
                                .foregroundStyle(.selectionAware(Palette.color(SyncBadge.tone(attention))))
                        } else {
                            Text(line).foregroundStyle(.textSecondary)
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
                // Holds the card's place so the rows below never shift as the usage loads.
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
/// Compared by the page and the place's identity, so a body pass that hands down the same ones
/// leaves every reader alone.
struct SettingsPageOpener: Equatable {
    /// The page open now, which its row marks as selected.
    let current: SettingsPage?
    private let place: ShellPlace

    @MainActor init(place: ShellPlace) {
        current = place.settingsPage
        self.place = place
    }

    @MainActor func callAsFunction(_ page: SettingsPage) {
        place.settingsPage = page
    }

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.current == rhs.current && lhs.place === rhs.place
    }
}

/// Where a pushed Settings stack records the page it shows, which the stack itself cannot say.
/// Compared by the place's identity, for the same reason as ``SettingsPageOpener``.
struct SettingsPageRecorder: Equatable {
    private let place: ShellPlace

    @MainActor init(place: ShellPlace) {
        self.place = place
    }

    @MainActor func callAsFunction(_ page: SettingsPage) {
        place.settingsPage = page
    }

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.place === rhs.place
    }
}

extension EnvironmentValues {
    /// Where the Settings root's rows open their pages. Nil pushes them onto the root's stack.
    @Entry var settingsPageOpener: SettingsPageOpener?
    /// Told each time a page pushed from the Settings root shows.
    @Entry var settingsPageShown: SettingsPageRecorder?
}

/// A Settings root row that opens `page`: a push, or, where an opener takes the press, the
/// row's place in the root's selection.
private struct SettingsPageLink<RowLabel: View>: View {
    let page: SettingsPage
    @ViewBuilder let label: RowLabel

    @Environment(\.settingsPageOpener) private var opener

    init(_ page: SettingsPage, @ViewBuilder label: () -> RowLabel) {
        self.page = page
        self.label = label()
    }

    var body: some View {
        if let opener {
            label.groupedSelectionRow(page, selection: opener.current)
        } else {
            NavigationLink(value: page) { label.groupedRowText() }
        }
    }
}

/// The page for a `SettingsPage`.
struct SettingsPageScreen: View {
    let page: SettingsPage
    /// The app's marketing version, which the About page names.
    var version: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String

    var body: some View {
        switch page {
        case .account:
            SettingsScreen(
                version: nil, sections: [.plan, .account], title: AccountSections.title, opensStatsInSheet: false,
                registersStats: false
            )
            .toolbarTitleDisplayMode(.inline)
        case .stats:
            StatsScreen()
                // A tune opened from the stats screen is not the tab's own pushed tune.
                .environment(\.stackPath, nil)
        case .category(let category):
            SettingsScreen(
                version: version, sections: category.sections, title: category.title, opensStatsInSheet: false,
                registersStats: false
            )
            .toolbarTitleDisplayMode(.inline)
        }
    }
}
