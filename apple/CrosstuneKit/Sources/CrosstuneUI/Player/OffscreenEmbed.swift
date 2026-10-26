import CrosstuneAnalytics
import SwiftUI

/// Holds a loaded link's player off screen while only the bar shows, so it keeps playing.
struct OffscreenEmbed: ViewModifier {
    let player: PlayerModel
    let stage: EmbedStage

    func body(content: Content) -> some View {
        content.background(alignment: .bottom) {
            if let embed = player.embed {
                EmbedView(stage: stage, embed: embed, prominence: .offscreen)
                    .frame(width: 1, height: 1)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }
}
