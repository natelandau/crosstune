import CrosstuneDesign
import SwiftUI

/// The one line a tune page shows on a free plan in place of its recordings. It expands in
/// place to the dimmed rows, which keep their menus, and collapses again.
struct RecordingsLine: View {
    let count: Int
    @Binding var isExpanded: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button {
            withAnimation(reduceMotion ? nil : .default) { isExpanded.toggle() }
        } label: {
            HStack(spacing: 6) {
                Text(RecordingText.recordingsLine(count: count))
                Image(systemName: "chevron.right")
                    .imageScale(.small)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
            }
            .foregroundStyle(.textSecondary)
            .font(.platform(.subheadline))
            .frame(minHeight: PageStyle.lineButtonHeight)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityValue(
            isExpanded ? RecordingText.recordingsLineExpanded : RecordingText.recordingsLineCollapsed)
    }
}
