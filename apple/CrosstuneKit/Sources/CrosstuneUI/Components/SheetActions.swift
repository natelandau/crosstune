import SwiftUI

extension View {
    /// Pins a sheet's actions to its bottom edge where `PageStyle.pinsSheetActions` says so:
    /// `line` centered above, each button in `primary` full width and prominent, each in
    /// `secondary` full width and borderless, then `footer`. Elsewhere this adds nothing, and the
    /// sheet keeps its actions in its own content.
    @ViewBuilder
    func sheetActions(
        line: String? = nil, @ViewBuilder primary: () -> some View, @ViewBuilder secondary: () -> some View,
        @ViewBuilder footer: () -> some View = { EmptyView() }
    ) -> some View {
        #if os(macOS)
            self
        #else
            if PageStyle.pinsSheetActions {
                safeAreaBar(edge: .bottom) {
                    SheetActionBar(line: line, primary: primary(), secondary: secondary(), footer: footer())
                }
            } else {
                self
            }
        #endif
    }
}

/// A sheet's Close: the system close button where `PageStyle.pinsSheetActions` says so, named
/// `label` for VoiceOver, and otherwise a button that reads `label`.
struct SheetCloseButton: View {
    let label: String
    let action: @MainActor () -> Void

    init(_ label: String, action: @escaping @MainActor () -> Void) {
        self.label = label
        self.action = action
    }

    var body: some View {
        if PageStyle.pinsSheetActions {
            Button(role: .close, action: action)
                .accessibilityLabel(label)
        } else {
            Button(label, action: action)
        }
    }
}

#if !os(macOS)
    private struct SheetActionBar<Primary: View, Secondary: View, Footer: View>: View {
        let line: String?
        let primary: Primary
        let secondary: Secondary
        let footer: Footer

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
                    primary.buttonStyle(SheetPrimaryButtonStyle())
                    secondary.buttonStyle(SheetSecondaryButtonStyle())
                }
                .fontWeight(.semibold)
                .controlSize(.large)
                footer
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal)
            .padding(.vertical, spacing.stackGap)
        }
    }

    /// A sheet's primary button: full width and slate prominent.
    struct SheetPrimaryButtonStyle: PrimitiveButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            Button(role: configuration.role, action: configuration.trigger) {
                configuration.label.frame(maxWidth: .infinity)
            }
            .buttonStyle(.slateProminent)
        }
    }

    private struct SheetSecondaryButtonStyle: PrimitiveButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            SheetSecondaryButton(configuration: configuration)
        }
    }

    private struct SheetSecondaryButton: View {
        let configuration: PrimitiveButtonStyleConfiguration

        @Environment(\.spacing) private var spacing

        var body: some View {
            Button(role: configuration.role, action: configuration.trigger) {
                configuration.label
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, spacing.stackGap)
            }
            .buttonStyle(.borderless)
        }
    }
#endif
