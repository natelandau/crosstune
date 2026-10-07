import SwiftUI

/// A place in the iPhone tab bar. The record slot never stays selected: choosing it records.
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

    /// Whether the record slot takes a press: not while a sheet, dialog, or selection covers
    /// the shell. Outside a shell nothing covers it.
    @MainActor static func recordIsEnabled(cover: ShellCover?) -> Bool {
        cover?.isCovered != true
    }
}

#if os(iOS)

    /// The iPhone frame: four tabs, Record in its own circle at the bar's trailing end, and the
    /// player in the bar's bottom accessory while something is loaded.
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
                destinationTab(.catalog)
                destinationTab(.lists)
                destinationTab(.recordings)
                destinationTab(.settings)
                Tab(value: TabSlot.record, role: Self.recordRole) {
                    Color.clear
                } label: {
                    Image(uiImage: recordIsEnabled ? Self.recordDot : Self.coveredRecordDot)
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
            .tabBarMinimizeBehavior(.never)
            .modifier(PlayerAccessory(player: player, stage: stage))
        }

        /// The role that sets a tab apart in its own circle at the bar's trailing end.
        private static var recordRole: TabRole {
            if #available(iOS 27, *) { .prominent } else { .search }
        }

        private var recordIsEnabled: Bool { TabSlot.recordIsEnabled(cover: recordCover) }

        /// The bar redraws a template glyph in its own colors, so the dot is drawn red up front.
        private static let recordDot = dot(UIColor(Color.recordingRed))
        /// The bar draws an original image the same whether or not its tab is disabled, so a
        /// covered slot shows its standing down with a dimmed dot of its own.
        private static let coveredRecordDot = dot(UIColor(Color.recordingRed).withAlphaComponent(0.35))

        private static func dot(_ color: UIColor) -> UIImage {
            if let glyph = UIImage(systemName: "circle.fill") {
                return glyph.withTintColor(color, renderingMode: .alwaysOriginal)
            }
            return UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).image { context in
                color.setFill()
                context.cgContext.fillEllipse(in: CGRect(x: 2, y: 2, width: 20, height: 20))
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
