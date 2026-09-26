import SwiftUI

/// A place in the iPhone tab bar. The record slot never stays selected: it holds the dome's place.
enum TabSlot: Hashable {
    case destination(Destination)
    case record

    /// The tab to show once `self` is chosen, and whether choosing it starts a recording. The
    /// record slot records and leaves `current` in place.
    func resolved(current: Destination) -> (destination: Destination, records: Bool) {
        switch self {
        case .destination(let destination): (destination, false)
        case .record: (current, true)
        }
    }
}

#if os(iOS)

    /// The iPhone frame: four tabs, the record dome over the middle of the bar, and the player
    /// in the bar's bottom accessory while something is loaded.
    struct PhoneShell: View {
        let player: PlayerModel
        let stage: EmbedStage
        @Bindable var place: ShellPlace
        /// Changes when the Recordings tab should come forward.
        let recordingsShown: Int
        let onRecord: @MainActor () -> Void

        @State private var selection: TabSlot = .destination(.catalog)
        @State private var width: CGFloat = .infinity
        @Environment(\.domeCover) private var domeCover
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            TabView(selection: $selection) {
                destinationTab(.catalog)
                destinationTab(.lists)
                // The bar gives each slot an equal share, so an empty middle slot centers the
                // dome between the second and third tabs.
                Tab(value: TabSlot.record) {
                    Color.clear
                } label: {
                    Image(systemName: RecordControl.systemImage)
                }
                .accessibilityLabel(RecordControl.label)
                destinationTab(.recordings)
                destinationTab(.settings)
            }
            // The record slot can still be chosen, by VoiceOver or at the dome's edge. The choice
            // lands in state and is put back to the current tab here, so the bar never shows
            // the empty slot's page.
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
            .tabBarMinimizeBehavior(.never)
            .overlay(alignment: .bottom) {
                let isCovered = domeCover?.isCovered == true
                ZStack {
                    if !isCovered {
                        RecordDome(diameter: domeDiameter, action: onRecord)
                            // The slot under the dome carries its name and action, and VoiceOver cannot
                            // skip a tab, so the dome stays out of its way rather than doubling it.
                            .accessibilityHidden(true)
                            // A smaller dome keeps its center where the full one has it.
                            .padding(.bottom, Self.domeLift + (RecordDome.diameter - domeDiameter) / 2)
                            .ignoresSafeArea(.keyboard)
                            .transition(.opacity)
                    }
                }
                .animation(reduceMotion ? nil : .default, value: isCovered)
            }
            .onGeometryChange(for: CGFloat.self) {
                $0.size.width
            } action: {
                width = $0
            }
            .modifier(PlayerAccessory(player: player, stage: stage))
        }

        /// Where the dome's bottom edge sits against the bottom safe area. Its top rises a few
        /// points above the bar and stays clear of the bottom accessory above it.
        private static let domeLift: CGFloat = -7

        private var domeDiameter: CGFloat { RecordDome.diameter(forWidth: width) }

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

        var body: some View {
            if destination == .lists {
                NavigationStack(path: listPath) { root }
            } else {
                NavigationStack { root }
            }
        }

        private var root: some View {
            DestinationScreen(destination: destination)
                .toolbarTitleDisplayMode(.inlineLarge)
                .syncBadgeToolbar()
                .environment(
                    \.stackTune,
                    Binding {
                        place.tabTunes[destination]
                    } set: {
                        place.tabTunes[destination] = $0
                    })
        }

        private var listPath: Binding<[ListRoute]> {
            Binding {
                place.tabList.map { [ListRoute(id: $0)] } ?? []
            } set: {
                place.tabList = $0.last?.id
            }
        }
    }

    /// The player in the tab bar's bottom accessory, only while something is loaded, and the
    /// player in full in a sheet over it. Pulling the sheet down leaves the bar playing.
    private struct PlayerAccessory: ViewModifier {
        let player: PlayerModel
        let stage: EmbedStage

        func body(content: Content) -> some View {
            content
                .tabViewBottomAccessory(isEnabled: player.isLoaded) {
                    PlayerBar(player: player)
                }
                .modifier(EmbedParking(player: player, stage: stage))
                .sheet(
                    isPresented: Binding {
                        player.isExpanded && player.isLoaded
                    } set: {
                        player.isExpanded = $0
                    }
                ) {
                    PlayerSheet(player: player, stage: stage)
                }
        }
    }
#endif
