import SwiftUI

/// The Loops mode: make a loop around the playhead, or delete the selected one. Why New loop is
/// off is its accessibility hint; on screen it simply goes disabled. While a name field is open,
/// the tune's parts show as suggestions. The panel is
/// the same height whatever it shows. With no audio to play, whose status the screen shows,
/// the controls are off, since the playhead has no place yet.
struct LoopsPanel: View {
    let model: PracticeModel
    /// Delete loop removed the selected loop, whose button goes disabled with it.
    let onDeleted: () -> Void

    @Environment(\.spacing) private var spacing
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: spacing.stackGap) {
            // Side by side while both fit, stacked when the labels outgrow the width.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: spacing(8)) { actions }
                VStack(spacing: spacing(8)) { actions }
            }
            .frame(maxWidth: .infinity)
            Text(PracticeText.loopsEmptyHint)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .reserved(shown: model.loops.isEmpty)
            LoopSuggestions(model: model, id: model.renaming)
        }
    }

    @ViewBuilder private var actions: some View {
        let reason = model.newLoopReason
        let canDelete = model.canDeleteSelected
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

    private func textButton(
        _ title: String, systemImage: String, role: ButtonRole? = nil, action: @escaping () -> Void
    ) -> some View {
        #if os(macOS)
            Button(role: role, action: action) {
                Label(title, systemImage: systemImage)
            }
            .buttonStyle(.bordered)
        #else
            Button(role: role, action: action) {
                // An explicit row, because a Label stacks its icon over its title at accessibility sizes.
                HStack(spacing: spacing(6)) {
                    Image(systemName: systemImage).accessibilityHidden(true)
                    Text(title).lineLimit(1)
                }
                .font(.subheadline)
                .fixedSize()
                .padding(.horizontal, spacing(12))
                .padding(.vertical, spacing.chipVertical)
                .frame(minHeight: 44)
                .background(neutralFill(colorScheme), in: .capsule)
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
        #endif
    }
}
