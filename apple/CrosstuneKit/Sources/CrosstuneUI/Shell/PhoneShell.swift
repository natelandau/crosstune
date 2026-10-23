import SwiftUI

/// A place in the iPhone tab bar. The record slot never stays selected: choosing it records.
enum TabSlot: Hashable {
    case destination(Destination)
    case record

    /// The iPhone tab bar's destinations, in order, ahead of the record slot. Settings opens
    /// from the account button instead.
    static let phoneTabs: [Destination] = [.catalog, .lists, .tuner, .recordings]

    /// The tab to show once `self` is chosen, and whether choosing it starts a recording. The
    /// record slot records and leaves `current` in place.
    func resolved(current: Destination) -> (destination: Destination, records: Bool) {
        switch self {
        case .destination(let destination): (destination, false)
        case .record: (current, true)
        }
    }

    /// Whether the record slot takes a press: not while a sheet, dialog, or selection covers
    /// the shell. Outside a shell nothing covers it.
    @MainActor static func recordIsEnabled(cover: ShellCover?) -> Bool {
        cover?.isCovered != true
    }
}

#if os(iOS)

    /// The iPhone frame: four tabs, Record in its own circle at the bar's trailing end, and the
    /// player in the bar's bottom accessory while something is loaded. Settings is a sheet from
    /// the account button at the trailing end of each tab's title row.
    struct PhoneShell: View {
        let player: PlayerModel
        let stage: EmbedStage
        @Bindable var place: ShellPlace
        /// Changes when the Recordings tab should come forward.
        let recordingsShown: Int
        let onRecord: @MainActor () -> Void

        @State private var selection: TabSlot = .destination(.catalog)
        @Environment(\.recordCover) private var recordCover

        var body: some View {
            TabView(selection: $selection) {
                ForEach(TabSlot.phoneTabs) { destinationTab($0) }
                Tab(value: TabSlot.record, role: RecordControl.tabRole) {
                    Color.clear
                } label: {
                    Image(uiImage: RecordControl.tabDot(enabled: recordIsEnabled))
                }
                .accessibilityLabel(RecordControl.label)
                .disabled(!recordIsEnabled)
            }
            // Choosing the record slot lands in state and is put back to the current tab here,
            // so the bar never shows the slot's empty page.
            .onChange(of: selection) {
                let (destination, records) = selection.resolved(current: place.tab)
                place.tab = destination
                if records {
                    selection = .destination(destination)
                    onRecord()
                }
            }
            .onChange(of: place.tab, initial: true) {
                selection = .destination(place.tab)
            }
            .onChange(of: recordingsShown) {
                place.tab = .recordings
            }
            .sheet(isPresented: settingsSheetShown) {
                SettingsSheet(place: place)
            }
            .tabBarMinimizeBehavior(.never)
            .modifier(PlayerAccessory(player: player, stage: stage))
        }

        private var recordIsEnabled: Bool { TabSlot.recordIsEnabled(cover: recordCover) }

        private var settingsSheetShown: Binding<Bool> {
            Binding {
                place.settingsSheetShown
            } set: {
                place.settingsSheetChanged(shown: $0)
            }
        }

        private func destinationTab(_ destination: Destination) -> some TabContent<TabSlot> {
            Tab(destination.title, systemImage: destination.systemImage, value: TabSlot.destination(destination)) {
                TabStack(destination: destination, place: place)
            }
        }
    }

    /// A tab's navigation stack. The Lists tab's pushed list and each tab's pushed tune live in
    /// the shell's place, so they outlast a switch to the split view and back.
    private struct TabStack: View {
        let destination: Destination
        @Bindable var place: ShellPlace
        /// Made once, so the screens' environment stays the same from one shell pass to the next.
        @State private var stackTune: ShellValue<String?>

        init(destination: Destination, place: ShellPlace) {
            self.destination = destination
            self.place = place
            _stackTune = State(
                initialValue: ShellValue {
                    place.tabTunes[destination]
                } set: {
                    place.tabTunes[destination] = $0
                })
        }

        var body: some View {
            if destination == .lists {
                NavigationStack(path: $place.listPath) { root }
            } else {
                NavigationStack { root }
            }
        }

        private var root: some View {
            DestinationScreen(destination: destination)
                .toolbarTitleDisplayMode(.inlineLarge)
                .syncBadgeToolbar(leading: destination == .catalog)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        AccountButton { place.showSettings() }
                    }
                    .sharedBackgroundVisibility(.hidden)
                }
                .environment(\.stackTune, stackTune)
        }
    }

    /// The player in the tab bar's bottom accessory, only while something is loaded, with the
    /// player in full zooming out of it.
    private struct PlayerAccessory: ViewModifier {
        let player: PlayerModel
        let stage: EmbedStage

        @Environment(ListPlayback.self) private var playback: ListPlayback?
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Namespace private var zoom

        func body(content: Content) -> some View {
            content
                .tabViewBottomAccessory(isEnabled: PlayerBar.isShown(player, playback)) {
                    PlayerBar(player: player)
                        .matchedTransitionSource(id: PlayerPresentations.zoomID, in: zoom)
                }
                .modifier(PlayerPresentations(player: player, stage: stage, zoom: reduceMotion ? nil : zoom))
        }
    }
#endif
