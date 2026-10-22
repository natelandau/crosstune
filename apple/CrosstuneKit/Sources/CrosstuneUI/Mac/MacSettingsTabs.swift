#if os(macOS)
    import Foundation
    import SwiftUI

    /// The Mac Settings window: a toolbar of tabs, each holding a short form of the settings
    /// rows, in place of the one long form iPhone and iPad show.
    public struct MacSettingsTabs: View {
        nonisolated public static let general = "General"
        nonisolated public static let account = AccountSections.title
        nonisolated public static let instruments = SettingsModel.instruments
        nonisolated public static let newTunes = SettingsModel.newTunes
        nonisolated public static let musicServices = SettingsModel.musicServices
        nonisolated public static let savedLocations = SavedLocationsText.title
        nonisolated public static let importExport = ImportExportSections.title

        /// One tab of the window.
        enum Pane: String, CaseIterable, Hashable {
            case general
            case account
            case instruments
            case newTunes = "new-tunes"
            case musicServices = "music-services"
            case savedLocations = "saved-locations"
            case importExport = "import-export"

            var title: String {
                switch self {
                case .general: MacSettingsTabs.general
                case .account: MacSettingsTabs.account
                case .instruments: MacSettingsTabs.instruments
                case .newTunes: MacSettingsTabs.newTunes
                case .musicServices: MacSettingsTabs.musicServices
                case .savedLocations: MacSettingsTabs.savedLocations
                case .importExport: MacSettingsTabs.importExport
                }
            }

            var systemImage: String {
                switch self {
                case .general: "gearshape"
                case .account: "person.crop.circle"
                case .instruments: "guitars"
                case .newTunes: "text.badge.plus"
                case .musicServices: "music.note.list"
                case .savedLocations: SettingsCategory.savedLocations.systemImage
                case .importExport: "arrow.up.arrow.down"
                }
            }

            var sections: SettingsScreen.Sections {
                switch self {
                case .general: [.appearance, .recording, .downloads, .sync, .storage, .about]
                case .account: [.plan, .account, .stats]
                case .instruments: [.instruments]
                case .newTunes: [.newTunes]
                case .musicServices: [.musicServices, .appleMusic]
                case .savedLocations: []
                case .importExport: [.importExport]
                }
            }
        }

        /// The tab last shown, so the window opens where the musician left it, as Mac Settings
        /// windows do.
        static let tabStorageKey = "macSettingsTab"

        /// Picks the tab the window shows, now if it is open or else when it next opens.
        static func select(_ pane: Pane, in defaults: UserDefaults = .standard) {
            defaults.set(pane.rawValue, forKey: tabStorageKey)
        }

        private let version: String?
        @AppStorage(Self.tabStorageKey) private var selection: Pane = .general

        /// - Parameter version: The app's marketing version, which the About row names.
        public init(version: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) {
            self.version = version
        }

        public var body: some View {
            TabView(selection: $selection) {
                ForEach(Pane.allCases, id: \.self) { pane in
                    Tab(pane.title, systemImage: pane.systemImage, value: pane) {
                        Self.content(pane, version: version)
                    }
                }
            }
            .tabViewStyle(.automatic)
            // A window of its own, so the shell's Plan sheet and purchase model never reach it.
            .modifier(PlanPurchases())
            // The window rather than each tab, so opening Settings reports once.
            .screenView(.settings)
        }

        /// A tab's form.
        @ViewBuilder static func content(_ pane: Pane, version: String?) -> some View {
            switch pane {
            case .savedLocations:
                NavigationStack { SavedLocationsPage() }
                    .frame(width: size.width, height: size.height)
            default:
                SettingsScreen(version: version, sections: pane.sections, title: pane.title, opensStatsInSheet: true)
                    .frame(width: size.width, height: size.height)
            }
        }

        /// One size for every tab. Resizing the window as tabs change saves its frame to user
        /// defaults mid-layout, which wakes every `@AppStorage` in the window and makes AppKit
        /// throw, so the window keeps the size it opens at and a long tab scrolls.
        static let size = CGSize(width: 520, height: 480)
    }
#endif
