import SwiftUI

/// The iPad window's foot: the player while something is loaded. Where the tab bar has no
/// prominent slot for Record (iPadOS 26), Record leads the capsule and the player extends from it.
struct PadFoot: View {
    private let player: PlayerModel
    private let showsRecord: Bool
    private let onRecord: @MainActor () -> Void

    @Environment(ListPlayback.self) private var playback: ListPlayback?
    @Environment(\.recordCover) private var cover

    init(player: PlayerModel, showsRecord: Bool, onRecord: @escaping @MainActor () -> Void) {
        self.player = player
        self.showsRecord = showsRecord
        self.onRecord = onRecord
    }

    /// Whether the player part shows.
    @MainActor static func showsPlayer(_ player: PlayerModel, _ playback: ListPlayback?) -> Bool {
        PlayerBar.isShown(player, playback)
    }

    /// Whether the capsule shows at all: never empty.
    @MainActor static func isShown(showsRecord: Bool, _ player: PlayerModel, _ playback: ListPlayback?) -> Bool {
        showsRecord || showsPlayer(player, playback)
    }

    /// Whether Record takes a press.
    @MainActor static func recordIsEnabled(cover: ShellCover?) -> Bool {
        TabSlot.recordIsEnabled(cover: cover)
    }

    var body: some View {
        let isEnabled = Self.recordIsEnabled(cover: cover)
        let showsPlayer = Self.showsPlayer(player, playback)
        HStack(spacing: 0) {
            if showsRecord {
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
            }

            if showsPlayer {
                if showsRecord {
                    Divider().padding(.vertical, PadStyle.footDividerInset)
                }
                PlayerBar(player: player)
                    // The foot's own transition brings the bar in; a second motion would double it.
                    .environment(\.playerBarRises, false)
                    .phoneTransition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .dynamicTypeSize(PadStyle.footTextSizes)
        .frame(height: PadStyle.footHeight)
        // Record alone hugs its label; with the player, the capsule takes the width it is given.
        .frame(maxWidth: showsPlayer ? PadStyle.footMaxWidth : nil)
        .modifier(GlassCapsule())
        .phoneAnimation(.snappy, value: showsPlayer)
    }
}
