import CrosstuneAnalytics
import CrosstuneStore
import SwiftUI

/// The row under the play button, or on the Mac the leading end of the stage's readout line:
/// the selected loop's name, or No loop, between Previous and Next, which select the loop that
/// way and bring its start under the playhead. While the recording has no loops it keeps its room
/// with nothing showing, so the controls around it stay put.
struct LoopSwitcher: View {
    let model: PracticeModel
    /// Why the screen cannot be used yet, which turns the arrows off.
    let blocker: String?

    @Environment(\.spacing) private var spacing

    var body: some View {
        let label = model.switcherLabel
        HStack(spacing: spacing(8)) {
            arrow(.previous, name: PracticeText.previousLoop, systemImage: "chevron.left")
            Text(label ?? PracticeText.noLoop)
                .contentMask()
                .font(.platform(.subheadline))
                .lineLimit(1)
                .truncationMode(.tail)
                .foregroundStyle(model.selected == nil ? .inkSecondary : AnyShapeStyle(.primary))
            arrow(.next, name: PracticeText.nextLoop, systemImage: "chevron.right")
        }
        #if os(macOS)
            .frame(maxWidth: .infinity, alignment: .leading)
        #else
            .frame(maxWidth: .infinity)
        #endif
        .reserved(shown: label != nil)
    }

    private func arrow(_ direction: LoopModel.Direction, name: String, systemImage: String) -> some View {
        Button {
            model.step(direction)
        } label: {
            #if os(macOS)
                Label(name, systemImage: systemImage)
                    .labelStyle(.iconOnly)
            #else
                Label(name, systemImage: systemImage)
                    .labelStyle(.iconOnly)
                    .font(.platform(.body))
                    .frame(minWidth: PracticeLayout.target, minHeight: PracticeLayout.target)
                    .contentShape(.rect)
            #endif
        }
        #if os(macOS)
            .buttonStyle(.mac(.icon, size: .small))
        #else
            .buttonStyle(.borderless)
        #endif
        .disabled(!model.canStep(direction) || blocker != nil)
        .help(name)
    }
}
