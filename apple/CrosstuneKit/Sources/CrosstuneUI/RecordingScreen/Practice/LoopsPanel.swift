import SwiftUI

/// The Loops mode: make a loop around the playhead, or delete the selected one. Why New loop is
/// off is its accessibility hint; on screen it simply goes disabled. While a name field is open,
/// the tune's parts show as suggestions. With no audio to play, whose status the screen shows,
/// the controls are off, since the playhead has no place yet.
struct LoopsPanel: View {
    let model: PracticeModel
    /// Delete loop removed the selected loop, whose button goes disabled with it.
    let onDeleted: () -> Void

    @Environment(\.spacing) private var spacing
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let reason = model.newLoopReason
        let canDelete = model.canDeleteSelected
        VStack(spacing: spacing.stackGap) {
            HStack(spacing: spacing(8)) {
                textButton(PracticeText.newLoop, systemImage: "plus", action: model.newLoop)
                    .disabled(reason != nil || !model.isLoaded)
                    .accessibilityHint(reason ?? "")
                textButton(PracticeText.deleteLoop, systemImage: "trash", role: .destructive) {
                    if model.deleteSelected() { onDeleted() }
                }
                // A plain button takes no color from its role.
                .foregroundStyle(canDelete ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
                .disabled(!canDelete)
            }
            .frame(maxWidth: .infinity)
            if model.loops.isEmpty {
                Text(PracticeText.loopsEmptyHint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
            if let renaming = model.renaming {
                LoopSuggestions(model: model, id: renaming)
            }
        }
    }

    private func textButton(
        _ title: String, systemImage: String, role: ButtonRole? = nil, action: @escaping () -> Void
    ) -> some View {
        Button(role: role, action: action) {
            Label(title, systemImage: systemImage)
                .font(.subheadline)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(neutralFill(colorScheme), in: .capsule)
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
    }
}
