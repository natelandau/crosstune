import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneDesign
import SwiftUI

extension EnvironmentValues {
    /// Opens Settings from a root tab's account button. Supplied by the phone shell's tab
    /// stacks; nil elsewhere, where the button is absent.
    @Entry var showAccount: MenuAction?
}

/// Whether a root tab's bar carries the account button: only where the phone shell supplies its
/// action, and not while selecting, whose controls take the whole row.
func showsAccountItem(showAccount: MenuAction?, isSelecting: Bool) -> Bool {
    showAccount != nil && !isSelecting
}

#if os(iOS)
    /// The way into Settings in a compact window, which has no Settings tab: the account's
    /// initials in a disc of the tint, or a person in the same disc when the account has no
    /// name. The disc is the control's whole look, so the toolbar draws no glass behind it.
    struct AccountButton: View {
        let action: @MainActor () -> Void

        @Environment(AccountSession.self) private var session: AccountSession?
        @Environment(\.colorScheme) private var colorScheme

        init(action: @escaping @MainActor () -> Void) {
            self.action = action
        }

        var body: some View {
            Button(action: action) {
                Group {
                    if let letters = initials(from: session?.name) {
                        Text(letters)
                            .font(.footnote.weight(.semibold))
                            .contentMask()
                    } else {
                        Image(systemName: "person.fill")
                            .font(.footnote)
                    }
                }
                .foregroundStyle(Palette.onTint(colorScheme))
                .frame(width: 32, height: 32)
                .background(Palette.tint(colorScheme), in: .circle)
            }
            // The disc does not grow, so its letters stop at the default size and a long press
            // shows the button enlarged.
            .dynamicTypeSize(...DynamicTypeSize.large)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
            .buttonStyle(.plain)
            .accessibilityLabel(Destination.settingsTitle)
            .accessibilityShowsLargeContentViewer()
        }
    }

    /// A root tab's account button, the bar's outermost trailing item, set apart from the other buttons'
    /// glass group. A screen lists it last in the same toolbar as its buttons, since the bar orders
    /// items from separate toolbar modifiers outer modifier first.
    struct AccountToolbarItem: ToolbarContent {
        @Environment(\.showAccount) private var showAccount
        @Environment(\.selecting) private var selecting

        var body: some ToolbarContent {
            if let showAccount, showsAccountItem(showAccount: showAccount, isSelecting: selecting?.isCovered == true) {
                ToolbarSpacer(.fixed, placement: .primaryAction)
                ToolbarItem(placement: .primaryAction) {
                    AccountButton { showAccount() }
                }
                .sharedBackgroundVisibility(.hidden)
            }
        }
    }
#endif
