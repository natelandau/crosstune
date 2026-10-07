import CrosstuneAnalytics
import CrosstuneAudio
import MusicKit
import SwiftUI

extension PlayerModel {
    /// The app's player: this device's audio, and Apple Music through the account signed in here.
    public static func device(analytics: AnalyticsClient) -> PlayerModel {
        PlayerModel(
            appleMusic: AppleMusic(access: DeviceAppleMusicAccess(), player: AppleMusicPlayer()), analytics: analytics)
    }
}

/// Words the Apple Music player shows.
public enum MusicPlayerText {
    public static let previousTrack = "Previous track"
    public static let nextTrack = "Next track"
}

/// What MusicKit plays for the loaded link, laid out as the Apple Music embed it plays in place
/// of: the artwork, the track and its artist, then the position and the controls.
struct MusicPlayerCard: View {
    nonisolated static let height = CGFloat(Embed.appleMusicHeight)
    nonisolated static let inset: CGFloat = 16
    /// The smallest artwork worth showing; a shorter card gives its width to the controls.
    nonisolated static let minArtworkSide: CGFloat = 64

    /// The side of the square artwork in a card `height` tall, or nil when it would be too small.
    nonisolated static func artworkSide(height: CGFloat) -> CGFloat? {
        let side = height - 2 * inset
        return side >= minArtworkSide ? side : nil
    }

    let player: PlayerModel
    let music: any MusicPlayback
    /// A fixed height, as the panel gives the embed; nil grows past ``height`` with the text.
    var fixedHeight: CGFloat?
    /// Leads the controls with play and pause, where no bar above carries them.
    var showsPlay = false
    /// Heads the controls with the track and its artist, where no bar beside it names them.
    var showsTitle = true

    var body: some View {
        HStack(spacing: 14) {
            if let side = Self.artworkSide(height: fixedHeight ?? Self.height) {
                MusicArtwork(music: music, side: side)
            }
            VStack(alignment: .leading, spacing: 2) {
                if showsTitle {
                    Text(music.trackTitle ?? player.title ?? "")
                        .contentMask()
                        .font(.headline)
                        .lineLimit(1)
                    if let artist = music.artistName {
                        Text(artist)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                MusicPlayerBody(music: music, showsPlay: showsPlay)
                // With no title above, the controls center beside the artwork.
                if !showsTitle { Spacer(minLength: 4) }
            }
        }
        .padding(Self.inset)
        .frame(minHeight: fixedHeight == nil ? Self.height : nil)
        .frame(height: fixedHeight)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.tertiary, in: .rect(cornerRadius: 12))
    }
}

/// The position and controls for what MusicKit plays: skips back and forward, and, for an
/// album, the previous and next track.
struct MusicPlayerBody: View {
    let music: any MusicPlayback
    var showsPlay = false

    var body: some View {
        VStack(spacing: 0) {
            // MusicKit does not announce its position, so it is read on a tick while shown.
            TimelineView(.periodic(from: .now, by: 0.5)) { context in
                PlaybackScrubber(audio: music, tick: context.date)
            }
            HStack(spacing: 4) {
                if music.hasAlbum {
                    control(MusicPlayerText.previousTrack, "backward.end.fill") { music.skipTrack(forward: false) }
                }
                control(RecordingPlayerText.skipBack(AudioPlayer.skipInterval), "gobackward.15") {
                    music.skip(by: -AudioPlayer.skipInterval)
                }
                if showsPlay {
                    TransportToggle(transport: music, font: .title2)
                }
                control(RecordingPlayerText.skipForward(AudioPlayer.skipInterval), "goforward.15") {
                    music.skip(by: AudioPlayer.skipInterval)
                }
                if music.hasAlbum {
                    control(MusicPlayerText.nextTrack, "forward.end.fill") { music.skipTrack(forward: true) }
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func control(_ label: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(label, systemImage: symbol)
                .labelStyle(.iconOnly)
                .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.tint)
        .help(label)
    }
}

/// The playing track's artwork, square, or a music note in its place until MusicKit has it.
struct MusicArtwork: View {
    let music: any MusicPlayback
    let side: CGFloat

    var body: some View {
        Group {
            if let artwork = music.artwork {
                ArtworkImage(artwork, width: side, height: side)
            } else {
                Image(systemName: "music.note")
                    .font(.title)
                    .foregroundStyle(.secondary)
                    .frame(width: side, height: side)
                    .background(.fill.secondary)
            }
        }
        .clipShape(.rect(cornerRadius: 8))
        .accessibilityHidden(true)
    }
}
