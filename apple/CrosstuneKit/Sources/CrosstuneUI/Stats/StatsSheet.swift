#if os(macOS)
    import SwiftUI

    /// The stats screen over the Mac Settings window. A push inside a Settings tab puts its Back
    /// button among the tabs and highlights the wrong one, so the window shows stats in a sheet.
    struct StatsSheet: View {
        @Environment(\.dismiss) private var dismiss

        var body: some View {
            MacSheet(
                title: StatsCopy.title,
                size: .overSettings(width: MacSettingsTabs.size.width), cancel: nil,
                primary: .init(AccountView.done) { dismiss() }, escape: { dismiss() }
            ) {
                // The sheet's title names the page, so the document leads with its first block.
                StatsScreen(headsItself: false)
            }
            .shellSheet()
        }
    }
#endif
