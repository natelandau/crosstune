import CrosstuneDesign
import SwiftUI

/// The Details tab: the recording's attributes, with the list controls while the page's recording
/// is the loaded one.
struct RecordingDetailsTab<Attributes: View>: View {
    let practice: PracticeModel?
    let rows: ScreenRows
    let player: PlayerModel
    /// Why the page's last write did not land, or why the trim editor gave way.
    let notice: String?
    @ViewBuilder let attributes: Attributes

    var body: some View {
        let isCurrent = practice?.isCurrent == true
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // The page replaces the dock and player bar while it plays, so a list's controls live here.
                if RecordingPageArrangement.showsListControls(isCurrent: isCurrent) {
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
