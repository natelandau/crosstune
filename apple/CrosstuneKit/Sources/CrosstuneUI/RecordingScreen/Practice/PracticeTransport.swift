import CrosstuneStore
import SwiftUI

/// The recording's transport with A B on its left and Repeat on its right.
struct PracticeTransport: View {
    let model: PracticeModel

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.spacing) private var spacing

    var body: some View {
        HStack(spacing: spacing(12)) {
            if model.showsCreate {
                markButton
            } else {
                Color.clear.frame(width: 44, height: 44)
            }
            Spacer(minLength: 0)
            RecordingTransport(player: model.player, spacing: spacing(24))
            Spacer(minLength: 0)
            repeatButton
        }
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity)
    }

    private var markButton: some View {
        let marking = model.isMarking
        return Button(action: model.markAB) {
            Text(marking ? PracticeText.markPendingFace : PracticeText.markFace)
                .font(.headline)
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(marking ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                .frame(minWidth: 44, minHeight: 44)
                .background(marking ? AnyShapeStyle(.tint) : neutralFill(colorScheme), in: .capsule)
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .disabled(!model.isLoaded || !model.create.allowed)
        .opacity(!model.isLoaded || !model.create.allowed ? 0.4 : 1)
        // The face reads "A B"; VoiceOver hears what it does instead.
        .accessibilityLabel(PracticeText.markLoop)
        .accessibilityAddTraits(marking ? .isSelected : [])
        .help(model.create.reason ?? PracticeText.markLoop)
    }

    private var repeatButton: some View {
        let on = model.isRepeating
        return Button(action: model.toggleRepeat) {
            Label(PracticeText.repeatLabel, systemImage: "repeat")
                .labelStyle(.iconOnly)
                .font(.headline)
                .foregroundStyle(on ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                .frame(width: 44, height: 44)
                .background(on ? AnyShapeStyle(.tint) : neutralFill(colorScheme), in: .circle)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .disabled(!model.canRepeat)
        .opacity(model.canRepeat ? 1 : 0.4)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityHint(model.selectedID == nil ? PracticeText.repeatNeedsLoop : "")
        .help(model.selectedID == nil ? PracticeText.repeatNeedsLoop : PracticeText.repeatLabel)
    }
}
