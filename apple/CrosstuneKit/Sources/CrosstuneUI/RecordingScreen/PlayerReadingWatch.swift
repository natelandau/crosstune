import SwiftUI

/// Watches the player's position for an editor screen. It reads the position in a body of its
/// own, so the playback tick re-runs this and not the screen around it.
struct PlayerReadingWatch: View {
    let player: PlayerModel
    let onChange: (PlayerReading) -> Void

    var body: some View {
        Color.clear
            .onChange(of: PlayerReading(playing: player.audio.isPlaying, elapsed: player.audio.elapsed)) {
                _, reading in
                onChange(reading)
            }
    }
}
