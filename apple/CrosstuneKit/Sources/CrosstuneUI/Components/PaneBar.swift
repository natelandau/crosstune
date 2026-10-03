#if os(macOS)
    import SwiftUI

    extension View {
        /// Pins `controls` across the top of this split view column, trailing, as its toolbar.
        /// A Mac toolbar puts a content column's trailing items over the detail column, so a
        /// column's own controls sit here, over the pane they act on.
        func paneBar(@ViewBuilder _ controls: () -> some View) -> some View {
            modifier(PaneBar(controls: controls()))
        }
    }

    private struct PaneBar<Controls: View>: ViewModifier {
        let controls: Controls

        @Environment(\.spacing) private var spacing

        func body(content: Content) -> some View {
            content.safeAreaBar(edge: .top) {
                // A bar with nothing in it takes no room, so a screen can stand its controls down.
                // The controls are styled before the split, since a menu reads its indicator from
                // where it resolves.
                Group(subviews: controls.paneControls()) { subviews in
                    if !subviews.isEmpty {
                        HStack(spacing: spacing.stackGap) {
                            Spacer(minLength: 0)
                            subviews
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, spacing.stackGap)
                    }
                }
            }
        }
    }

    extension View {
        /// Styles controls as a pane bar's: glass, at the bar's height, a menu without its chevron.
        /// A control shows its glyph with `.labelStyle(.iconOnly)` on its own label, since on a
        /// menu the style would reach the menu's items too.
        func paneControls() -> some View {
            menuIndicator(.hidden)
                .buttonStyle(.glass)
                .controlSize(.large)
        }
    }
#endif
