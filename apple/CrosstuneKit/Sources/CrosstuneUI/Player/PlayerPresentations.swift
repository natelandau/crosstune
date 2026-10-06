#if os(iOS)
    import SwiftUI

    /// The player in full over an iOS shell: a recording's screen as a full-screen cover on the
    /// practice ground, or a link's player in a sheet, and the link parked off screen while only
    /// the bar shows. Pulling either down leaves the bar playing.
    struct PlayerPresentations: ViewModifier {
        let player: PlayerModel
        let stage: EmbedStage
        /// Where the bar marks itself with ``zoomID`` for the cover to zoom out of, or nil for
        /// the standard presentation.
        let zoom: Namespace.ID?
        /// Sets practice beside the playing tune's scans and lyrics, and stands a link the app
        /// plays itself on the same cover, as the iPad does.
        var standsWithReading = false

        static let zoomID = "player"

        @Environment(\.playerWindow) private var window
        @Environment(\.colorScheme) private var colorScheme

        func body(content: Content) -> some View {
            content
                .fullScreenCover(isPresented: expanded(onCover: true)) {
                    Group {
                        // Elsewhere the cover only ever holds a recording, and keeps it while it
                        // goes after a skip to a link.
                        if standsWithReading && player.item?.kind == .link {
                            LinkStand(player: player)
                        } else {
                            RecordingScreen(player: player)
                        }
                    }
                    .environment(\.standsWithReading, standsWithReading)
                    // Read out here, since the screen's own appearance is always dark.
                    .practiceGround(colorScheme)
                    .zooms(from: Self.zoomID, in: zoom)
                }
                .modifier(EmbedParking(player: player, stage: stage))
                .sheet(isPresented: expanded(onCover: false)) {
                    LinkPlayerSheet(player: player, stage: stage)
                }
        }

        /// Whether the loaded item shows on the cover rather than in the link sheet: a recording
        /// always, and a link MusicKit plays where practice stands beside reading. A link in its
        /// provider's embed keeps the sheet, which holds the embed.
        private var isOnCover: Bool {
            switch player.item?.kind {
            case .recording: true
            case .link: standsWithReading && player.music != nil
            case nil: false
            }
        }

        private func expanded(onCover: Bool) -> Binding<Bool> {
            Binding {
                player.showsExpanded(in: window) && player.item != nil && isOnCover == onCover
            } set: {
                player.isExpanded = $0
            }
        }
    }

    /// Sets the header's subtitle only when there is one, so a link with nothing to say under
    /// its title keeps a one-line header. The subtitle comes from a view behind the content, so
    /// one arriving or going never rebuilds the content, and with it the music card.
    private struct LinkStandSubtitle: ViewModifier {
        let subtitle: String?

        func body(content: Content) -> some View {
            content.background {
                if let subtitle { Color.clear.navigationSubtitle(subtitle) }
            }
        }
    }

    /// A link MusicKit plays, standing on the practice ground beside its tune's scans and
    /// lyrics: its music card and the list's controls in place of the waveform.
    private struct LinkStand: View {
        let player: PlayerModel

        var body: some View {
            Stand(player: player) {
                NavigationStack {
                    LinkStandPractice(player: player)
                }
                .closesPracticeBySwipe(areaBottom: nil, isEnabled: true) { player.isExpanded = false }
            }
            .shellSheet()
        }
    }

    private struct LinkStandPractice: View {
        let player: PlayerModel

        @Environment(\.practiceGround) private var ground
        @Environment(\.standHasReading) private var standHasReading
        @Environment(ListPlayback.self) private var playback: ListPlayback?

        var body: some View {
            VStack(spacing: 20) {
                if let music = player.music {
                    MusicPlayerCard(player: player, music: music, showsPlay: true)
                }
                PlaylistControlsRow()
                Spacer(minLength: 0)
            }
            .padding(16)
            .modifier(StandPracticeWidth())
            .containerBackground(PhoneStyle.practiceGround(ground ?? .dark), for: .navigation)
            .navigationTitle(player.title ?? "")
            .modifier(LinkStandSubtitle(subtitle: StandHeader.linkSubtitle(player: player, playback: playback)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        player.isExpanded = false
                    } label: {
                        Label(RecordingScreenText.close, systemImage: "chevron.down")
                    }
                    .help(RecordingScreenText.close)
                    .keyboardShortcut(.cancelAction)
                }
                if standHasReading {
                    ToolbarItem(placement: .primaryAction) { StandReadingToggle() }
                }
            }
        }
    }
#endif
