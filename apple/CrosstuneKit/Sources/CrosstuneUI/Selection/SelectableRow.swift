import SwiftUI

/// The button that enters selection mode, in a screen's More menu or a row's context menu.
struct SelectButton: View {
    let action: () -> Void

    var body: some View {
        Button(TuneRowActions.select, systemImage: "checkmark.circle", action: action)
    }
}

extension View {
    /// A row's swipe actions and context menu, or neither while the row is selecting. The
    /// condition sits inside each builder, since an empty menu shows nothing and the row keeps
    /// one shape either way. A long swipe only reveals the actions: a full swipe would run the
    /// edge action, and no swipe acts on its own.
    func selectableRowActions(
        isSelecting: Bool, @ViewBuilder swipe: () -> some View, @ViewBuilder menu: () -> some View
    ) -> some View {
        let swipeItems = swipe()
        let menuItems = menu()
        return swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if !isSelecting { swipeItems }
        }
        .contextMenu {
            if !isSelecting { menuItems }
        }
    }

    /// ``selectableRowActions(isSelecting:swipe:menu:)`` with a preview over the context menu.
    func selectableRowActions(
        isSelecting: Bool, @ViewBuilder swipe: () -> some View, @ViewBuilder menu: () -> some View,
        @ViewBuilder preview: () -> some View
    ) -> some View {
        let swipeItems = swipe()
        let menuItems = menu()
        return swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if !isSelecting { swipeItems }
        }
        .contextMenu {
            if !isSelecting { menuItems }
        } preview: {
            preview()
        }
    }
}
