import CrosstuneAudio
import MusicKit
import SwiftUI

extension PlayerModel {
    /// The app's player: this device's audio, and Apple Music through the account signed in here.
    public static func device() -> PlayerModel {
        PlayerModel(appleMusic: AppleMusic(access: DeviceAppleMusicAccess(), player: AppleMusicPlayer()))
    }
}

/// Words the Apple Music player shows.
public enum MusicPlayerText {
    public static let previousTrack = "Previous track"
    public static let nextTrack = "Next track"
}

/// What MusicKit plays for the loaded link: its position, skips back and forward, and, for an
/// album, the previous and next track.
struct MusicPlayerBody: View {
    let music: any MusicPlayback

    var body: some View {
        VStack(spacing: 4) {
            // MusicKit does not announce its position, so it is read on a tick while shown.
            TimelineView(.periodic(from: .now, by: 0.5)) { context in
                PlaybackScrubber(audio: music, tick: context.date)
            }
            HStack(spacing: 8) {
                if music.hasAlbum {
                    control(MusicPlayerText.previousTrack, "backward.end.fill") { music.skipTrack(forward: false) }
                }
                Spacer(minLength: 0)
                control(RecordingPlayerText.skipBack(AudioPlayer.skipInterval), "gobackward.15") {
                    music.skip(by: -AudioPlayer.skipInterval)
                }
                control(RecordingPlayerText.skipForward(AudioPlayer.skipInterval), "goforward.15") {
                    music.skip(by: AudioPlayer.skipInterval)
                }
                Spacer(minLength: 0)
                if music.hasAlbum {
                    control(MusicPlayerText.nextTrack, "forward.end.fill") { music.skipTrack(forward: true) }
                }
            }
        }
    }

    private func control(_ label: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(label, systemImage: symbol)
                .labelStyle(.iconOnly)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.tint)
        .help(label)
    }
}

/// The playing track's artwork in the iPhone's full player, where the embed's own would be.
struct MusicArtwork: View {
    let music: any MusicPlayback

    var body: some View {
        if let artwork = music.artwork {
            ArtworkImage(artwork, width: 240)
                .clipShape(.rect(cornerRadius: 12))
                .accessibilityHidden(true)
        }
    }
}
