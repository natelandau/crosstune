#if os(macOS)
    import SwiftUI

    /// What the Mac detail column shows: the recording's practice view while the player shows in
    /// full in this window, otherwise the tune, otherwise the placeholder.
    enum MacDetail: Equatable {
        case practice
        case tune(String)
        case placeholder

        @MainActor
        static func pick(_ player: PlayerModel, in window: UUID?, tune: String?) -> MacDetail {
            if player.showsExpanded(in: window) && player.item?.kind == .recording { return .practice }
            return tune.map(MacDetail.tune) ?? .placeholder
        }
    }

    /// The detail column's tune as the screens see it. While the practice view covers the tune,
    /// it reads as none, so no row shows as open and a click on the covered tune still writes.
    /// Any write closes the practice view; a clear written while it shows only unhighlights, so
    /// the tune under it stays.
    @MainActor
    func practiceAwareDetailTune(_ place: ShellPlace, player: PlayerModel, window: UUID?) -> Binding<String?> {
        Binding {
            MacDetail.pick(player, in: window, tune: place.detailTune) == .practice ? nil : place.detailTune
        } set: { tune in
            let practicing = MacDetail.pick(player, in: window, tune: place.detailTune) == .practice
            if practicing { player.isExpanded = false }
            if tune != nil || !practicing { place.detailTune = tune }
        }
    }
#endif
