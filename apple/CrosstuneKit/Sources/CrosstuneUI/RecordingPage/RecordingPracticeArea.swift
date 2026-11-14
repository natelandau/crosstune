import CrosstuneDesign
import SwiftUI

/// The page's practice: the practice view once the practice is made, and nothing while the
/// practice waits on what it writes through or the plan holds recordings back.
struct RecordingPracticeArea: View {
    let practice: PracticeModel?
    let rows: ScreenRows
    let peaks: ShownPeaks?
    /// Why the page's last write did not land, or why the trim editor gave way.
    let notice: String?
    /// Why the recording cannot load or play now.
    let unavailableReason: String?
    /// Escape with no name field open and no loop selected.
    let onClose: () -> Void

    var body: some View {
        if let practice {
            RecordingScreen(
                practice: practice, rows: rows, peaks: peaks, notice: notice,
                // The loaded recording's own audio state shows in practice's status line instead.
                blockedReason: practice.isCurrent ? nil : unavailableReason,
                onClose: onClose)
        } else {
            Color.clear
        }
    }
}
