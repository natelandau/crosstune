import CrosstuneDesign
import SwiftUI

/// The page's practice: the practice view once the practice is made, the plan's reason while it
/// holds recordings back, and nothing while the practice waits on what it writes through.
struct RecordingPracticeArea: View {
    let practice: PracticeModel?
    let rows: ScreenRows
    let peaks: ShownPeaks?
    /// Why the page's last write did not land, or why the trim editor gave way.
    let notice: String?
    /// Why the plan stops the recording playing.
    let blockedReason: String?
    /// Why the recording cannot load or play now.
    let unavailableReason: String?
    let onBlocked: () -> Void
    /// Escape with no name field open and no loop selected.
    let onClose: () -> Void

    /// What the practice area shows.
    enum Shown: Equatable {
        case controls
        /// The plan's lock, with why it holds recordings back.
        case blocked(String)
        /// Nothing yet: the practice is still being made, as while the shell's commands arrive.
        case waiting
    }

    static func shown(hasPractice: Bool, blockedReason: String?) -> Shown {
        if let blockedReason { return .blocked(blockedReason) }
        return hasPractice ? .controls : .waiting
    }

    var body: some View {
        switch Self.shown(hasPractice: practice != nil, blockedReason: blockedReason) {
        case .controls:
            if let practice {
                RecordingScreen(
                    practice: practice, rows: rows, peaks: peaks, notice: notice,
                    // The loaded recording's own audio state shows in practice's status line instead.
                    blockedReason: practice.isCurrent ? nil : unavailableReason,
                    onClose: onClose)
            }
        case .blocked(let reason):
            PracticeBlocked(reason: reason, onBlocked: onBlocked)
        case .waiting:
            Color.clear
        }
    }
}

/// The practice area while the plan holds recordings back: the reason, which opens the plan.
private struct PracticeBlocked: View {
    let reason: String
    let onBlocked: () -> Void

    var body: some View {
        VStack {
            Button(reason, action: onBlocked)
                .buttonStyle(.text(macLook: .button(.quiet)))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
