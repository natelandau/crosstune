#if os(macOS)
    import Foundation
    import SwiftUI

    /// The Mac Settings window: a toolbar of tabs, each holding a short form of the settings
    /// rows, in place of the one long form iPhone and iPad show.
    public struct MacSettingsTabs: View {
        nonisolated public static let general = "General"
        nonisolated public static let account = AccountSections.title
        nonisolated public static let tunes = SettingsModel.tunes
        nonisolated public static let recordings = SettingsModel.recordings
        nonisolated public static let importExport = ImportExportSections.title

        /// One tab of the window.
        enum Pane: String, CaseIterable, Hashable {
            case general
            case account
            case tunes
            case recordings
            case importExport = "import-export"

            var title: String {
                switch self {
                case .general: MacSettingsTabs.general
                case .account: MacSettingsTabs.account
                case .tunes: MacSettingsTabs.tunes
                case .recordings: MacSettingsTabs.recordings
                case .importExport: MacSettingsTabs.importExport
                }
            }

            var systemImage: String {
                switch self {
                case .general: "gearshape"
                case .account: "person.crop.circle"
                case .tunes: "music.note.list"
                case .recordings: "waveform"
                case .importExport: "arrow.up.arrow.down"
                }
            }

            var sections: SettingsScreen.Sections {
                switch self {
                case .general: [.appearance, .tuner, .sync, .storage, .about]
                case .account: [.plan, .account, .stats]
                case .tunes: [.instrumentToggles, .newTunes, .serviceToggles, .appleMusic]
                case .recordings: [.recording, .savedLocations, .downloads]
                case .importExport: [.importExport]
                }
            }

            /// The tab a stored name opens. Tunes holds what the instruments, new-tunes, and
            /// music-services names opened, and Recordings the saved locations; a name no tab
            /// has opens General.
            static func migrated(_ raw: String) -> Pane {
                switch raw {
                case "instruments", "new-tunes", "music-services": .tunes
                case "saved-locations": .recordings
                default: Pane(rawValue: raw) ?? .general
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
        /// Kept as the stored name, so a tab saved under an older name still opens its settings.
        @AppStorage(Self.tabStorageKey) private var storedTab = Pane.general.rawValue

        /// - Parameter version: The app's marketing version, which the About row names.
        public init(version: String? = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) {
            self.version = version
        }

        public var body: some View {
            TabView(
                selection: Binding {
                    Pane.migrated(storedTab)
                } set: {
                    storedTab = $0.rawValue
                }
            ) {
                ForEach(Pane.allCases, id: \.self) { pane in
                    Tab(pane.title, systemImage: pane.systemImage, value: pane) {
                        Self.content(pane, version: version)
                    }
                }
            }
            .tabViewStyle(.automatic)
            // On the tab view too, which otherwise reports one fixed size to the window.
            .frame(
                minWidth: Self.size.width, maxWidth: Self.maxWidth, minHeight: Self.size.height, maxHeight: .infinity
            )
            .background { ResizableWindow() }
            // A window of its own, so the shell's Plan sheet and purchase model never reach it.
            .modifier(PlanPurchases())
            // The window rather than each tab, so opening Settings reports once.
            .screenView(.settings)
        }

        /// A tab's form.
        static func content(_ pane: Pane, version: String?) -> some View {
            SettingsScreen(version: version, sections: pane.sections, title: pane.title, opensStatsInSheet: true)
                .macSettingsOpensUnfocused()
                .frame(
                    minWidth: size.width, maxWidth: maxWidth, minHeight: size.height, maxHeight: .infinity)
        }

        /// The size the window opens at and the least it takes. Every tab fills whatever size the
        /// musician drags the window to, so a tab change never resizes it: resizing as tabs change
        /// saves the frame to user defaults mid-layout, which wakes every `@AppStorage` in the
        /// window and makes AppKit throw. A long tab scrolls.
        nonisolated static let size = CGSize(width: 520, height: 480)
        /// The widest the window grows, past which a card's rows would run too long to read.
        nonisolated static let maxWidth: CGFloat = 760
    }

    /// Makes the window it sits in resizable. SwiftUI makes a Settings window without the
    /// resizable style whatever the scene's resizability, so its edges never drag.
    private struct ResizableWindow: NSViewRepresentable {
        func makeNSView(context: Context) -> NSView { ResizableWindowView() }
        func updateNSView(_: NSView, context: Context) {}
    }

    private final class ResizableWindowView: NSView {
        private var styleWatch: NSKeyValueObservation?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            styleWatch = nil
            guard let window else { return }
            window.styleMask.insert(.resizable)
            // SwiftUI sets the Settings window's style again as it lays the window out, which
            // takes the resizable style back off.
            styleWatch = window.observe(\.styleMask) { window, _ in
                MainActor.assumeIsolated {
                    if !window.styleMask.contains(.resizable) { window.styleMask.insert(.resizable) }
                }
            }
        }
    }
#endif
