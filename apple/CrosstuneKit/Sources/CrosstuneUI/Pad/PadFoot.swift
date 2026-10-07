import SwiftUI

/// The iPad window's foot: Record, and the player extending from it while something is loaded.
struct PadFoot: View {
    private let player: PlayerModel
    private let onRecord: @MainActor () -> Void

    @Environment(ListPlayback.self) private var playback: ListPlayback?
    @Environment(\.recordCover) private var cover

    init(player: PlayerModel, onRecord: @escaping @MainActor () -> Void) {
        self.player = player
        self.onRecord = onRecord
    }

    /// Whether the player part shows beside Record.
    @MainActor static func showsPlayer(_ player: PlayerModel, _ playback: ListPlayback?) -> Bool {
        PlayerBar.isShown(player, playback)
    }

    /// Whether Record takes a press.
    @MainActor static func recordIsEnabled(cover: ShellCover?) -> Bool {
        TabSlot.recordIsEnabled(cover: cover)
    }

    var body: some View {
        let isEnabled = Self.recordIsEnabled(cover: cover)
        let showsPlayer = Self.showsPlayer(player, playback)
        HStack(spacing: 0) {
            Button(action: onRecord) {
                HStack(spacing: PadStyle.footRecordSpacing) {
                    Image(systemName: "circle.fill")
                        .foregroundStyle(Color.recordingRed)
                        .accessibilityHidden(true)
                    Text(RecordControl.shortLabel)
                        .fontWeight(.semibold)
                }
                // The plain style dims nothing, so the whole label dims while Record stands down.
                .opacity(isEnabled ? 1 : 0.35)
                .padding(.horizontal, PadStyle.footRecordPadding)
                .frame(minHeight: minimumTapTarget)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(RecordControl.label)
            .disabled(!isEnabled)

            if showsPlayer {
                Divider().padding(.vertical, PadStyle.footDividerInset)
                PlayerBar(player: player)
                    // The foot's own transition brings the bar in; a second motion would double it.
                    .environment(\.playerBarRises, false)
                    .phoneTransition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .dynamicTypeSize(PadStyle.footTextSizes)
        .frame(height: PadStyle.footHeight)
        // Alone, Record hugs its label; with the player, the capsule takes the width it is given.
        .frame(maxWidth: showsPlayer ? PadStyle.footMaxWidth : nil)
        .modifier(GlassCapsule())
        .phoneAnimation(.snappy, value: showsPlayer)
    }
}
