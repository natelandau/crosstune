import CrosstuneAnalytics
import SwiftUI

/// Opens a list from the tune it holds: in the split view's content column, or pushed where
/// there is no split view. `label` is told which, since a pushed link draws its own chevron.
struct OpensList<Label: View>: View {
    let listID: String
    @ViewBuilder let label: (_ inSplitView: Bool) -> Label

    @Environment(\.sidebarSelection) private var sidebarSelection

    var body: some View {
        if let sidebarSelection {
            Button {
                sidebarSelection.value = .list(id: listID)
            } label: {
                label(true)
            }
            .buttonStyle(.plain)
        } else {
            NavigationLink {
                ListScreen(listID: listID)
            } label: {
                label(false)
            }
        }
    }
}
