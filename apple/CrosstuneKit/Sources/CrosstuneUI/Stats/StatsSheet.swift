#if os(macOS)
    import SwiftUI

    /// The stats screen over the Mac Settings window. A push inside a Settings tab puts its Back
    /// button among the tabs and highlights the wrong one, so the window shows stats in a sheet.
    struct StatsSheet: View {
        @Environment(\.dismiss) private var dismiss

        var body: some View {
            // No stack, so the page's own title is the only one: nothing in the sheet pushes.
            StatsScreen()
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(AccountView.done) { dismiss() }
                    }
                }
                .frame(minWidth: 520, idealWidth: 560, minHeight: 480, idealHeight: 640)
                .shellSheet()
        }
    }
#endif
