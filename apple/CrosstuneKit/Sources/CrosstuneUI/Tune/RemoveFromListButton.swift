import CrosstuneAnalytics
import CrosstuneCommands
import CrosstuneStore
import SwiftUI

/// Takes the tune out of one of its lists.
struct RemoveFromListButton: View {
    let model: TuneModel
    let membership: TuneMembership

    var body: some View {
        Button(TuneScreen.remove, systemImage: "text.badge.xmark", role: .destructive) {
            Task { await model.removeFromList(itemID: membership.itemID, listID: membership.list.id) }
        }
    }
}
