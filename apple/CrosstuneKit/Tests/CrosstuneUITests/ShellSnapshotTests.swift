import CrosstuneAudio
import CrosstuneStore
import CrosstuneSync
import CrosstuneTestSupport
import Foundation
import SwiftUI
import Testing

@testable import CrosstuneUI

/// Renders the shell's chrome to PNG for review. An image renderer draws no tab bar, split
/// view, list, or glass, so each frame is laid out from stand-ins around the real player bar,
/// toolbar button, sync badge, and placeholder screens.
@MainActor
@Suite struct ShellSnapshotTests {
    @Test func phone() {
        let player = PlayerModel()
        player.play(PlayerItem(kind: .link, id: "link", title: "Soldier's Joy - Tommy Jarrell"))
        snapshot("shell-phone", width: 390) {
            VStack(spacing: 0) {
                HStack {
                    Text(Destination.catalog.title).font(.largeTitle.bold())
                    Spacer()
                    SyncBadge(status: .offline)
                }
                CatalogStandIn().frame(maxHeight: .infinity, alignment: .top)
                PlayerBar(player: player)
                    .modifier(GlassCapsule())
                    .padding(.bottom, 8)
                tabBar
            }
            .frame(height: 780)
        }
    }

    @Test func padFoot() {
        let playing = PlayerModel()
        playing.play(PlayerItem(kind: .link, id: "link", title: "Soldier's Joy - Tommy Jarrell"))
        snapshot("pad-foot", width: 560) {
            VStack(spacing: 16) {
                PadFoot(player: PlayerModel(), onRecord: {})
                PadFoot(player: playing, onRecord: {})
            }
        }
    }

    @Test func mac() {
        let player = PlayerModel()
        player.play(PlayerItem(kind: .link, id: "link", title: "Soldier's Joy - Tommy Jarrell"))
        snapshot("shell-mac", width: 1100) {
            VStack(spacing: 0) {
                HStack(alignment: .top, spacing: 0) {
                    #if os(macOS)
                        MacSidebarStandIn(selection: .catalog).frame(width: 220)
                    #else
                        sidebar.frame(width: 220)
                    #endif
                    Divider()
                    VStack(alignment: .leading) {
                        HStack {
                            RecordToolbarButton {}
                                .labelStyle(.iconOnly)
                                .font(.title3)
                            Spacer()
                            SyncBadge(status: .error)
                        }
                        CatalogStandIn().frame(maxHeight: .infinity, alignment: .top)
                    }
                    .padding(.horizontal, 12)
                    .frame(width: 360)
                    Divider()
                    #if os(macOS)
                        VStack(spacing: 0) {
                            TuneDetailPlaceholder().frame(maxWidth: .infinity, maxHeight: .infinity)
                            PlayerDock(player: player, stage: EmbedStage(), columnHeight: 620)
                        }
                    #else
                        TuneDetailPlaceholder().frame(maxWidth: .infinity, maxHeight: .infinity)
                    #endif
                }
                #if !os(macOS)
                    PlayerBar(player: player)
                        .frame(maxWidth: 560)
                        .modifier(GlassCapsule())
                        .padding(.bottom, 12)
                #endif
            }
            .frame(height: 620)
        }
    }

    #if os(macOS)
        /// The sidebar with each kind of row chosen: a destination's glyph turns coral, a status
        /// keeps its own color.
        @Test func macSidebar() {
            snapshot("mac-sidebar", width: 800) {
                HStack(alignment: .top, spacing: 16) {
                    MacSidebarStandIn(selection: .catalog)
                    MacSidebarStandIn(selection: .status("learning"))
                    MacSidebarStandIn(selection: .list(id: SampleCatalog.lists[0].id))
                }
                .frame(height: 400)
            }
        }
    #endif

    #if os(macOS)
        /// The Mac dock across a detail column: a recording on its own, a recording while a list
        /// plays, the Apple Music card, and a video's player growing up out of the bar.
        @Test func macDock() async throws {
            let entry = SampleCatalog.playable
            let file = try #require(entry.file)
            let audio = FakeAudio()
            audio.duration = 184
            audio.elapsed = 62
            let recording = PlayerModel(audio: audio)
            recording.audioSource = { _ in
                RecordingAudioFile(url: URL(filePath: "/tmp/r1.m4a"), file: file)
            }
            recording.play(.recording(entry.recording, tuneTitle: entry.tuneTitle))
            #expect(try await poll { recording.recordingAudio == .loaded })

            let listAudio = FakeAudio()
            listAudio.duration = 184
            listAudio.elapsed = 140
            let listed = PlayerModel(audio: listAudio)
            listed.audioSource = recording.audioSource
            let suite = "macDock.\(UUID().uuidString)"
            let defaults = try #require(UserDefaults(suiteName: suite))
            defer { UserDefaults.standard.removePersistentDomain(forName: suite) }
            let playback = ListPlayback(player: listed, commands: DockQuietCommands(), defaults: defaults)
            playback.resolve = { _, _ in
                ListPlayback.Turn(
                    title: entry.tuneTitle ?? "", item: .recording(entry.recording, tuneTitle: entry.tuneTitle))
            }
            playback.start(listID: "l1", name: SampleCatalog.lists[0].name, tuneIDs: ["a", "b", "c"], shuffled: true)
            #expect(try await poll { listed.recordingAudio == .loaded })

            let music = FakeMusic()
            music.trackTitle = "The Mason's Apron"
            music.artistName = "Kevin Burke"
            music.duration = 212
            music.elapsed = 48
            let musicPlayer = PlayerModel(
                audio: FakeAudio(), appleMusic: AppleMusic(access: FakeAccess(.fullTracks), player: music))
            let appleRow = RecordingLink(
                id: "l2", tuneID: "t1", url: "https://music.apple.com/us/song/reels/1440833090",
                provider: "apple_music", providerRef: "1440833090", title: "The Mason's Apron")
            musicPlayer.play(try #require(PlayerItem.link(appleRow)))
            #expect(try await poll { musicPlayer.music != nil })

            let video = PlayerModel(audio: FakeAudio())
            let videoRow = RecordingLink(
                id: "l3", tuneID: "t1", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", provider: "youtube",
                providerRef: "dQw4w9WgXcQ", title: "Soldier's Joy - Tommy Jarrell")
            video.play(try #require(PlayerItem.link(videoRow)))
            #expect(try await poll { video.embed != nil })

            let stage = EmbedStage()
            snapshot("mac-dock", width: 760) {
                VStack(spacing: 24) {
                    dockColumn(recording, stage: stage)
                    dockColumn(listed, stage: stage).environment(playback)
                    dockColumn(musicPlayer, stage: stage)
                    dockColumn(video, stage: stage)
                }
            }
            playback.end()
        }

        /// The foot of a detail column with page text running under the dock.
        private func dockColumn(_ player: PlayerModel, stage: EmbedStage) -> some View {
            VStack(alignment: .leading, spacing: 0) {
                Text("A tune page's last lines sit above the dock rather than under it.")
                    .font(MacStyle.body)
                    .foregroundStyle(.secondary)
                    .padding(MacStyle.pageMargin)
                    .frame(maxWidth: .infinity, alignment: .leading)
                PlayerDock(player: player, stage: stage, columnHeight: 700)
            }
            .tint(MacStyle.accent)
            .border(.separator)
        }
    #endif

    @Test func syncBadges() {
        snapshot("sync-badges", width: 320) {
            HStack(spacing: 8) {
                ForEach([SyncStatus.offline, .unauthorized, .error], id: \.self) { SyncBadge(status: $0) }
            }
        }
    }

    /// Four tabs in one capsule and Record in its own circle at the trailing end, as the tab bar
    /// lays them out.
    private var tabBar: some View {
        HStack(spacing: 8) {
            HStack(spacing: 0) {
                tab(.catalog, chosen: true)
                tab(.lists)
                tab(.recordings)
                tab(.settings)
            }
            .frame(height: 62)
            .modifier(GlassCapsule())
            Image(systemName: "circle.fill")
                .font(.title)
                .foregroundStyle(Color.recordingRed)
                .frame(width: 62, height: 62)
                .modifier(GlassCapsule())
        }
    }

    private func tab(_ destination: Destination, chosen: Bool = false) -> some View {
        VStack(spacing: 2) {
            Image(systemName: destination.systemImage).font(.title3)
            Text(destination.title).font(.caption2.weight(.medium))
        }
        .foregroundStyle(chosen ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
        .frame(maxWidth: .infinity)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 12) {
            sidebarRow(Destination.catalog.title, Destination.catalog.systemImage, chosen: true)
            sidebarRow(Destination.recordings.title, Destination.recordings.systemImage)
            Text(Destination.lists.title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                .padding(.top, 8)
            ForEach(SampleCatalog.lists, id: \.id) { list in
                sidebarRow(list.name, Destination.lists.systemImage)
            }
            sidebarRow(SidebarItem.newList, "plus")
        }
        .padding(12)
    }

    private func sidebarRow(_ title: String, _ systemImage: String, chosen: Bool = false) -> some View {
        Label(title, systemImage: systemImage)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(chosen ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 8))
    }
}

#if os(macOS)
    /// The Mac sidebar laid out from stand-ins, since an image renderer draws no list: the real
    /// row labels, section header, and record capsule on the sidebar's tint, the chosen row on a
    /// soft pill as an inactive window draws it.
    struct MacSidebarStandIn: View {
        let selection: SidebarItem
        private let counts = CatalogCounts(
            catalog: 10, byStatus: ["known": 3, "learning": 7, "want_to_learn": 0], recordings: 6)

        @Environment(\.colorScheme) private var scheme

        var body: some View {
            VStack(alignment: .leading, spacing: 0) {
                row(.catalog, Destination.catalog.title, .symbol(Destination.catalog.systemImage), counts.catalog)
                ForEach(["known", "learning", "want_to_learn"], id: \.self) { status in
                    row(.status(status), StatusStyle.label(status), .status(status), counts.byStatus[status] ?? 0)
                }
                row(
                    .recordings, Destination.recordings.title, .symbol(Destination.recordings.systemImage),
                    counts.recordings)
                // The header's real button draws as a placeholder in an image renderer.
                HStack {
                    Text(Destination.lists.title)
                    Spacer(minLength: 0)
                    Image(systemName: "plus.circle")
                }
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.top, 14)
                .padding(.bottom, 4)
                ForEach(SampleCatalog.lists, id: \.id) { list in
                    row(.list(id: list.id), list.name, .symbol(Destination.lists.systemImage), 5)
                }
                Spacer(minLength: 0)
                SidebarRecordButton {}
            }
            .padding(10)
            .frame(width: 240)
            .frame(maxHeight: .infinity)
            .background(MacStyle.sidebarTint(scheme), in: .rect(cornerRadius: 12))
            .tint(MacStyle.accent)
        }

        private func row(
            _ item: SidebarItem, _ title: String, _ glyph: MacSidebarLabel.Glyph, _ count: Int
        ) -> some View {
            HStack {
                MacSidebarLabel(title: title, glyph: glyph, isSelected: item == selection)
                Spacer(minLength: 0)
                // The sidebar's badge hides a zero count, as Mail does.
                if count > 0 {
                    Text(count, format: .number)
                        .font(MacStyle.secondary)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 10)
            .frame(height: MacStyle.sidebarRowHeight)
            .background(
                item == selection ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 6))
        }
    }
#endif

#if os(macOS)
    private final class DockQuietCommands: TrackCommands {
        func enable(next: @escaping @MainActor () -> Void, previous: @escaping @MainActor () -> Void) {}
        func disable() {}
    }
#endif
