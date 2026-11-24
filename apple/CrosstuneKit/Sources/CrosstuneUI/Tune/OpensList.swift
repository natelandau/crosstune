import CrosstuneAnalytics
import CrosstuneDesign
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
            .buttonStyle(.labelOnly)
        } else {
            // A destination link, not a value: the Lists tab's path holds at most one list, so
            // pushing a list value there replaces the open list instead of stacking on it.
            NavigationLink {
                ListScreen(listID: listID)
            } label: {
                label(false)
            }
        }
    }
}
