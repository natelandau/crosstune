import SwiftUI

extension View {
    /// Pins a sheet's actions to its bottom edge where `PageStyle.pinsSheetActions` says so:
    /// `line` centered above, each button in `primary` the Large filled button, and each in
    /// `secondary` a full-width text button. Elsewhere this adds nothing, and the
    /// sheet keeps its actions in its own content. `isShown` false hides the bar without
    /// rebuilding the sheet's content, for a sheet whose decision comes only in one step.
    @ViewBuilder
    package func sheetActions(
        line: String? = nil, isShown: Bool = true, @ViewBuilder primary: () -> some View,
        @ViewBuilder secondary: () -> some View
    ) -> some View {
        #if os(macOS)
            self
        #else
            if PageStyle.pinsSheetActions {
                safeAreaBar(edge: .bottom) {
                    if isShown {
                        SheetActionBar(line: line, primary: primary(), secondary: secondary())
                    }
                }
            } else {
                self
            }
        #endif
    }
}

/// A sheet's Close: the system close button where `PageStyle.pinsSheetActions` says so, named
/// `label` for VoiceOver, and otherwise a button that reads `label`.
package struct SheetCloseButton: View {
    /// The name of every control that closes a sheet or page, on every platform.
    package nonisolated static let close = "Close"

    package let label: String
    package let action: @MainActor () -> Void

    package init(_ label: String = SheetCloseButton.close, action: @escaping @MainActor () -> Void) {
        self.label = label
        self.action = action
    }

    package var body: some View {
        if PageStyle.pinsSheetActions {
            Button(role: .close, action: action)
                .accessibilityLabel(label)
        } else {
            Button(label, action: action)
        }
    }
}

#if !os(macOS)
    private struct SheetActionBar<Primary: View, Secondary: View>: View {
        let line: String?
        let primary: Primary
        let secondary: Secondary

        @Environment(\.spacing) private var spacing

        var body: some View {
            VStack(spacing: spacing.stackGap) {
                if let line {
                    Text(line)
                        .font(.platform(.footnote))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(spacing: spacing(4)) {
                    primary.buttonStyle(.filled)
                    secondary.buttonStyle(.text)
                        .environment(\.libraryButtonFillsWidth, true)
                }
                .controlSize(.large)
                // A bar's button is never a form row, even over a grouped form.
                .environment(\.asyncButtonIsRow, false)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal)
            .padding(.vertical, spacing.stackGap)
        }
    }
#endif
