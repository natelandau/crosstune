import CrosstuneStore
import CrosstuneSync
import SwiftUI
import Testing

@testable import CrosstuneUI

/// Renders the shell's chrome to PNG for review. An image renderer draws no tab bar, split
/// view, list, or glass, so each frame is laid out from stand-ins around the real dome, player
/// bar, toolbar button, sync badge, and placeholder screens.
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

    @Test func mac() {
        let player = PlayerModel()
        player.play(PlayerItem(kind: .link, id: "link", title: "Soldier's Joy - Tommy Jarrell"))
        snapshot("shell-mac", width: 1100) {
            VStack(spacing: 0) {
                HStack(alignment: .top, spacing: 0) {
                    sidebar.frame(width: 220)
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
                    TuneDetailPlaceholder().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                PlayerBar(player: player)
                    .frame(maxWidth: 560)
                    .modifier(GlassCapsule())
                    .padding(.bottom, 12)
            }
            .frame(height: 620)
        }
    }

    @Test func syncBadges() {
        snapshot("sync-badges", width: 320) {
            HStack(spacing: 8) {
                ForEach([SyncStatus.offline, .unauthorized, .error], id: \.self) { SyncBadge(status: $0) }
            }
        }
    }

    /// Five equal slots with the dome over the middle one, as the tab bar lays them out.
    private var tabBar: some View {
        HStack(spacing: 0) {
            tab(.catalog, chosen: true)
            tab(.lists)
            Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
            tab(.recordings)
            tab(.settings)
        }
        .frame(height: 62)
        .modifier(GlassCapsule())
        .overlay { RecordDome {} }
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
