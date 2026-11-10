#if os(macOS)
    import SwiftUI

    /// The actions that end a sheet or an editor: a leading slot for a Text button, a count, or
    /// why the primary is off, then Cancel, an optional secondary, and the one primary trailing,
    /// on a `surface` band under a hairline.
    package struct MacActionBar<Leading: View>: View {
        /// One of the bar's buttons.
        package struct Item {
            package let title: String
            package let role: MacButtonStyle.Role
            package let isEnabled: Bool
            /// The key that presses it: Escape for Cancel, Return for a primary that takes it.
            package let shortcut: KeyboardShortcut?
            package let action: @MainActor () -> Void

            package init(
                _ title: String, role: MacButtonStyle.Role, isEnabled: Bool = true, shortcut: KeyboardShortcut? = nil,
                action: @escaping @MainActor () -> Void
            ) {
                self.title = title
                self.role = role
                self.isEnabled = isEnabled
                self.shortcut = shortcut
                self.action = action
            }
        }

        private let cancel: Item?
        private let secondary: Item?
        private let primary: Item?
        private let leading: Leading

        package init(
            cancel: Item?, secondary: Item? = nil, primary: Item?, @ViewBuilder leading: () -> Leading
        ) {
            self.cancel = cancel
            self.secondary = secondary
            self.primary = primary
            self.leading = leading()
        }

        package var body: some View {
            MacActionBarBand {
                leading
            } trailing: {
                if let cancel { button(cancel) }
                if let secondary { button(secondary) }
                if let primary { button(primary) }
            }
        }

        private func button(_ action: Item) -> some View {
            Button(action.title, action: action.action)
                .buttonStyle(.mac(action.role))
                .disabled(!action.isEnabled)
                .keyboardShortcut(action.shortcut)
        }
    }

    /// The action bar's band for buttons a caller builds itself, such as one that asks before it
    /// saves: `leading` at the start, then the `trailing` buttons in order, Cancel first.
    package struct MacActionBarBand<Leading: View, Trailing: View>: View {
        private let leading: Leading
        private let trailing: Trailing

        package init(@ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing) {
            self.leading = leading()
            self.trailing = trailing()
        }

        package var body: some View {
            HStack(spacing: 8) {
                leading
                Spacer(minLength: 12)
                trailing
            }
            .padding(.horizontal, MacStyle.sheetMargin)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .background(Palette.surface)
            .macSurfaceContainer()
            .overlay(alignment: .top) {
                Rectangle().fill(Palette.border).frame(height: 1)
            }
        }
    }

#endif
