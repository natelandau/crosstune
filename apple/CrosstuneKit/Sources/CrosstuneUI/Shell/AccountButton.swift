#if os(iOS)
    import CrosstuneAnalytics
    import CrosstuneAuth
    import SwiftUI

    /// The way into Settings in a compact window, which has no Settings tab: the account's
    /// initials in a disc, or a person when the account has no name.
    struct AccountButton: View {
        let action: @MainActor () -> Void

        @Environment(AccountSession.self) private var session: AccountSession?

        init(action: @escaping @MainActor () -> Void) {
            self.action = action
        }

        var body: some View {
            Button(action: action) {
                if let letters = initials(from: session?.name) {
                    Text(letters)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Palette.ink)
                        .frame(width: 32, height: 32)
                        .background(Palette.field, in: .circle)
                        .contentMask()
                } else {
                    Image(systemName: "person.crop.circle")
                        .font(.title2)
                        .foregroundStyle(.inkSecondary)
                }
            }
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(.rect)
            .buttonStyle(.plain)
            .accessibilityLabel(Destination.settingsTitle)
        }
    }
#endif
