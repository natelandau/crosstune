import SwiftUI

/// The Trim and Split screens' transport: a button each side of a large play and pause button.
struct EditorTransport<Leading: View, Trailing: View>: View {
    let playing: Bool
    /// The play button's name while paused.
    let playName: String
    let onToggle: @MainActor () -> Void
    @ContentBuilder let leading: Leading
    @ContentBuilder let trailing: Trailing

    var body: some View {
        HStack(spacing: 40) {
            leading
            Button(
                playing ? RecordingPlayerText.pause : playName, systemImage: playing ? "pause.fill" : "play.fill",
                action: onToggle
            )
            .help(playing ? RecordingPlayerText.pause : playName)
            .font(.platform(.largeTitle, mac: .columnTitle))
            .contentTransition(.symbolEffect(.replace))
            .frame(minWidth: 64, minHeight: 64)
            trailing
        }
        .labelStyle(.iconTapTarget)
        .buttonStyle(.borderless)
        .font(.platform(.title2))
    }
}
