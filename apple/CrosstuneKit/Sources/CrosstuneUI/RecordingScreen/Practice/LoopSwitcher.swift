import CrosstuneStore
import SwiftUI

/// The row under the play button: the selected loop's name, or No loop, between Previous and
/// Next, which select the loop that way and bring its start under the playhead. While the
/// recording has no loops it keeps its room with nothing showing, so the panels under it stay put.
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
                .font(.subheadline)
                .lineLimit(1)
                .truncationMode(.tail)
                .foregroundStyle(model.selected == nil ? .secondary : .primary)
            arrow(.next, name: PracticeText.nextLoop, systemImage: "chevron.right")
        }
        .frame(maxWidth: .infinity)
        .reserved(shown: label != nil)
    }

    private func arrow(_ direction: LoopModel.Direction, name: String, systemImage: String) -> some View {
        Button {
            model.step(direction)
        } label: {
            Label(name, systemImage: systemImage)
                .labelStyle(.iconOnly)
                .font(.body)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.borderless)
        .disabled(!model.canStep(direction) || blocker != nil)
        .help(name)
    }
}
