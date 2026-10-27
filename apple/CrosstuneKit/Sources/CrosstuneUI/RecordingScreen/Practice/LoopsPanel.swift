import SwiftUI

/// The Loops mode: make a loop around the playhead, or delete the selected one. Why New loop is
/// off is its accessibility hint; on iOS it simply goes disabled, and the Mac also captions it.
/// While a name field is open, the tune's parts show as suggestions. The panel is the same
/// height whatever it shows. With no audio to play, whose status the screen shows, the controls
/// are off, since the playhead has no place yet.
struct LoopsPanel: View {
    let model: PracticeModel
    /// Delete loop removed the selected loop, whose button goes disabled with it.
    let onDeleted: () -> Void

    @Environment(\.spacing) private var spacing

    var body: some View {
        VStack(spacing: spacing.stackGap) {
            // Side by side while both fit, stacked when the labels outgrow the width.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: spacing(8)) { actions }
                VStack(spacing: spacing(8)) { actions }
            }
            .frame(maxWidth: .infinity)
            #if os(macOS)
                // With no audio yet the screen's own status says why, so no reason repeats it.
                let caption = Self.macCaption(
                    reason: model.isLoaded ? model.newLoopReason : nil, hasLoops: !model.loops.isEmpty)
                // A space holds the line's height while it is empty, so the panel keeps its size.
                Text(caption ?? " ")
                    .contentMask()
                    .font(MacStyle.secondary)
                    .foregroundStyle(.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .reserved(shown: caption != nil)
            #else
                Text(PracticeText.loopsEmptyHint)
                    .font(.platform(.footnote))
                    .foregroundStyle(.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .reserved(shown: model.loops.isEmpty)
            #endif
            LoopSuggestions(model: model, id: model.renaming)
        }
    }

    #if os(macOS)
        /// The Mac's caption under the buttons: why New loop is off, which a pointer cannot learn
        /// from a disabled button, or the empty hint until there is a loop.
        nonisolated static func macCaption(reason: String?, hasLoops: Bool) -> String? {
            reason ?? (hasLoops ? nil : PracticeText.loopsEmptyHint)
        }
    #endif

    @ViewBuilder private var actions: some View {
        let reason = model.newLoopReason
        let canDelete = model.canDeleteSelected
        #if os(macOS)
            Button(action: model.newLoop) {
                Label {
                    Text(PracticeText.newLoop)
                } icon: {
                    Image(systemName: "plus").foregroundStyle(Palette.accent)
                }
            }
            .buttonStyle(.macSecondary)
            .disabled(reason != nil || !model.isLoaded)
            .accessibilityHint(reason ?? "")
            Button(role: .destructive) {
                if model.deleteSelected() { onDeleted() }
            } label: {
                // On the label, which wins over the plain style's accent.
                Label(PracticeText.deleteLoop, systemImage: "trash")
                    .foregroundStyle(Palette.danger)
            }
            .buttonStyle(.macPlain)
            .disabled(!canDelete)
        #else
            textButton(PracticeText.newLoop, systemImage: "plus", action: model.newLoop)
                .disabled(reason != nil || !model.isLoaded)
                .accessibilityHint(reason ?? "")
            textButton(PracticeText.deleteLoop, systemImage: "trash", role: .destructive) {
                if model.deleteSelected() { onDeleted() }
            }
            // A plain button takes no color from its role.
            .foregroundStyle(canDelete ? AnyShapeStyle(Palette.danger) : .textSecondary)
            .disabled(!canDelete)
        #endif
    }

    #if !os(macOS)
        private func textButton(
            _ title: String, systemImage: String, role: ButtonRole? = nil, action: @escaping () -> Void
        ) -> some View {
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
                .frame(minHeight: minimumTapTarget)
                .background(.neutralFill, in: .capsule)
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
        }
    #endif
}
