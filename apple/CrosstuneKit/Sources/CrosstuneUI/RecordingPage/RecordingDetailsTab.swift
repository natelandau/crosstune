import CrosstuneDesign
import SwiftUI

/// The Details tab: the play bar over the recording's attributes.
struct RecordingDetailsTab<Attributes: View>: View {
    let practice: PracticeModel?
    let rows: ScreenRows
    let player: PlayerModel
    /// Why the page's last write did not land, or why the trim editor gave way.
    let notice: String?
    /// Why the plan stops the recording playing.
    let blockedReason: String?
    /// Why the recording cannot load or play now.
    let unavailableReason: String?
    let onBlocked: () -> Void
    @ViewBuilder let attributes: Attributes

    var body: some View {
        let isCurrent = practice?.isCurrent == true
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                RecordingPlayBar(
                    practice: practice, lengthMs: rows.trimmedLengthMs, blockedReason: blockedReason,
                    unavailableReason: unavailableReason,
                    onBlocked: onBlocked)
                // The page replaces the dock and player bar while it plays, so a list's controls live here.
                if RecordingPlayBar.showsListControls(isCurrent: isCurrent) {
                    PlaylistControlsRow()
                }
                if let message = (isCurrent ? player.failure : nil) ?? notice ?? practice?.failure {
                    PlayerFailureText(message)
                }
                attributes
            }
            #if os(macOS)
                .padding(MacStyle.pageMargin)
            #else
                .padding(16)
            #endif
            .frame(maxWidth: PageStyle.pageMaxWidth)
            .frame(maxWidth: .infinity)
        }
    }
}
