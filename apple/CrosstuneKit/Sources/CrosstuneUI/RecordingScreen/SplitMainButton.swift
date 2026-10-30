import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// Split at the line, or Remove cut while a cut is selected, with the hint that says why a cut
/// or Save is refused. Its own view, so the playback tick redraws it and not the screen around it.
struct SplitMainButton: View {
    let model: SplitModel
    let ready: Bool

    var body: some View {
        let removes = model.state.selected != nil
        let hint = hint(removes: removes)
        VStack(spacing: 8) {
            Button(action: model.pressMain) {
                Text(
                    removes
                        ? RecordingScreenText.removeCut
                        : RecordingScreenText.splitAt(milliseconds: model.shownLineMs - model.bounds.lowerBound)
                )
                .monospacedDigit()
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.accentProminent)
            .controlSize(.large)
            .disabled(!removes && !model.canAddCut)
            .accessibilityHint(hint ?? "")
            if let hint {
                Text(hint)
                    .font(.platform(.footnote))
                    .foregroundStyle(.textSecondary)
                    .multilineTextAlignment(.center)
                    .accessibilityHidden(true)
            }
        }
    }

    private func hint(removes: Bool) -> String? {
        let pieces = model.state.pieces
        if model.state.overLimit, pieces.contains(where: { $0.lengthMs > RecordingLimits.maxRecordingMs }) {
            return RecordingScreenText.pieceMaxHint
        }
        if ready, !removes, !model.canAddCut, pieces.count < RecordingLimits.maxSplitPieces {
            return RecordingScreenText.pieceMinHint
        }
        return nil
    }
}
