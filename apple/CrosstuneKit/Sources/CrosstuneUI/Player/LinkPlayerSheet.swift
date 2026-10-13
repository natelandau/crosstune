import CrosstuneAnalytics
import SwiftUI

/// The iPhone's full player for a loaded link: its provider's player, the link out to the
/// provider, and Close player. Pulling it down leaves the bar, still playing.
struct LinkPlayerSheet: View {
    let player: PlayerModel
    let stage: EmbedStage
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let link = player.item?.link {
                    if let embed = player.embed {
                        Group {
                            if embed.height == .video {
                                EmbedView(stage: stage, embed: embed)
                                    .aspectRatio(16 / 9, contentMode: .fit)
                            } else {
                                EmbedView(stage: stage, embed: embed)
                                    .frame(height: CGFloat(embed.points))
                            }
                        }
                        .clipShape(.rect(cornerRadius: 12))
                    } else if let music = player.music {
                        MusicPlayerCard(player: player, music: music, showsPlay: true)
                    }
                    if link.providerURL != nil {
                        Button {
                            player.openLinkInProvider { openURL($0) }
                        } label: {
                            Label(PlayerBar.openIn(link.providerName), systemImage: "arrow.up.right")
                        }
                        .buttonStyle(.bordered)
                    }
                }
                PlaylistControlsRow()
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .navigationTitle(player.title ?? "")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    PlayerCloseButton(player: player)
                }
            }
        }
        .partHeightSheet()
        .presentationDragIndicator(.visible)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }
}
