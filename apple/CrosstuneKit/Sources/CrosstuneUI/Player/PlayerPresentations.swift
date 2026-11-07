#if os(iOS)
    import SwiftUI

    /// A link's player over an iOS shell: in a sheet while it shows in full, and kept offscreen
    /// while only the bar shows. Pulling the sheet down leaves the bar playing. A recording has
    /// no presentation of its own: its page opens in the shell's navigation.
    struct PlayerPresentations: ViewModifier {
        let player: PlayerModel
        let stage: EmbedStage

        @Environment(\.playerWindow) private var window

        func body(content: Content) -> some View {
            content
                .modifier(OffscreenEmbed(player: player, stage: stage))
                .sheet(isPresented: expanded) {
                    LinkPlayerSheet(player: player, stage: stage)
                }
        }

        private var expanded: Binding<Bool> {
            Binding {
                player.showsExpanded(in: window) && player.item?.kind == .link
            } set: {
                player.isExpanded = $0
            }
        }
    }
#endif
