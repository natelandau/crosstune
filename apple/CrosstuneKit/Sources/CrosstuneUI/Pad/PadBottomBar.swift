import CrosstuneDesign
import SwiftUI

/// The iPad window's bottom bar: the player while something is loaded. Where the tab bar has no
/// prominent slot for Record (iPadOS 26), Record leads the capsule and the player extends from it.
struct PadBottomBar: View {
    private let player: PlayerModel
    private let showsRecord: Bool
    private let onRecord: @MainActor () -> Void

    @Environment(ListPlayback.self) private var playback: ListPlayback?
    @Environment(\.recordCover) private var cover
    @Environment(\.playerWindow) private var window

    init(player: PlayerModel, showsRecord: Bool, onRecord: @escaping @MainActor () -> Void) {
        self.player = player
        self.showsRecord = showsRecord
        self.onRecord = onRecord
    }

    /// Whether the player part shows in `window`.
    @MainActor static func showsPlayer(_ player: PlayerModel, _ playback: ListPlayback?, in window: UUID?) -> Bool {
        PlayerBar.isShown(player, playback, in: window)
    }

    /// Whether the capsule shows at all in `window`: never empty.
    @MainActor static func isShown(
        showsRecord: Bool, _ player: PlayerModel, _ playback: ListPlayback?, in window: UUID?
    ) -> Bool {
        showsRecord || showsPlayer(player, playback, in: window)
    }

    /// Whether Record takes a press.
    @MainActor static func recordIsEnabled(cover: ShellCover?) -> Bool {
        TabSlot.recordIsEnabled(cover: cover)
    }

    var body: some View {
        let isEnabled = Self.recordIsEnabled(cover: cover)
        let showsPlayer = Self.showsPlayer(player, playback, in: window)
        HStack(spacing: 0) {
            if showsRecord {
                Button(action: onRecord) {
                    HStack(spacing: PadStyle.bottomBarRecordSpacing) {
                        Image(systemName: "circle.fill")
                            .foregroundStyle(Palette.record)
                            .accessibilityHidden(true)
                        Text(RecordControl.shortLabel)
                            .fontWeight(.semibold)
                    }
                    // The label-only style draws no disabled look, so the whole label dims while Record is disabled.
                    .opacity(isEnabled ? 1 : ControlMetrics.disabledSurfaceOpacity)
                    .padding(.horizontal, PadStyle.bottomBarRecordPadding)
                    .frame(minHeight: minimumTapTarget)
                    .contentShape(.rect)
                }
                .buttonStyle(.labelOnly(hoverShape: .capsule))
                .accessibilityLabel(RecordControl.label)
                .disabled(!isEnabled)
            }

            if showsPlayer {
                if showsRecord {
                    Divider().padding(.vertical, PadStyle.bottomBarDividerInset)
                }
                PlayerBar(player: player)
                    // The bottom bar's own transition brings the bar in; a second motion would double it.
                    .environment(\.playerBarRises, false)
                    .phoneTransition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .dynamicTypeSize(PadStyle.bottomBarTextSizes)
        .frame(height: PadStyle.bottomBarHeight)
        // Record alone hugs its label; with the player, the capsule takes the width it is given.
        .frame(maxWidth: showsPlayer ? PadStyle.bottomBarMaxWidth : nil)
        .modifier(GlassCapsule())
        .phoneAnimation(.snappy, value: showsPlayer)
    }
}
