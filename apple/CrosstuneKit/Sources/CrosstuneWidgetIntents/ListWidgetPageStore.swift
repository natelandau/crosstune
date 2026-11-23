import CrosstuneShare
import CrosstuneWidgetData
import Foundation

/// The page each List widget shows, keyed by list ID and widget size, in the App Group's defaults
/// so the app and the extension agree on it. Each size has its own key, so a large and an extra
/// large widget of one list page independently.
// `UserDefaults` is thread-safe but not marked `Sendable` in this SDK.
public struct ListWidgetPageStore: @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    /// The store in the App Group, or nil when this build lacks the entitlement.
    public static func appGroup() -> ListWidgetPageStore? {
        UserDefaults(suiteName: ShareContainer.appGroupID).map(ListWidgetPageStore.init(defaults:))
    }

    /// The stored page, unclamped, or nil when none is stored.
    func storedPage(forList listID: String, size: ListWidgetSize) -> Int? {
        defaults.object(forKey: Self.key("page", listID, size)) as? Int
    }

    public func setPage(_ page: Int, forList listID: String, size: ListWidgetSize) {
        defaults.set(page, forKey: Self.key("page", listID, size))
    }

    /// The page a List widget at `size` shows for `state`: the stored one, kept inside the list's
    /// current page count, after following the current tune. Call it once per timeline. Sizes
    /// with no page buttons return 0 and touch nothing. While the list is not playing, the
    /// followed tune is forgotten, so the next playback jumps to its first tune's page even when
    /// that tune was the last one followed.
    public func page(showing state: ListWidgetState, size: ListWidgetSize) -> Int {
        guard size.showsPages, let list = state.list else { return 0 }
        let paging = state.paging(for: size)
        if let playback = state.playback {
            if let index = state.currentTuneIndex {
                followCurrentTune(
                    listID: list.id, size: size, tuneID: playback.currentTuneID, tuneIndex: index, paging: paging)
            }
        } else {
            defaults.removeObject(forKey: Self.key("followedTune", list.id, size))
        }
        return paging.clamped(storedPage(forList: list.id, size: size) ?? 0)
    }

    /// The page every moment of one List widget timeline at `size` shows, or nil when the first
    /// moment has no summary. The page is read once, from the first moment, and kept for the
    /// rest: reading a later moment where the list no longer plays would forget the followed
    /// tune, so the next reload would snap a flipped page back to the playing tune's.
    public func page(for moments: [WidgetMoment], listID: String?, size: ListWidgetSize) -> Int? {
        guard let first = moments.first, case .available(let summary) = first.current else { return nil }
        return page(showing: ListWidgetState(summary: summary, listID: listID), size: size)
    }

    /// Call it each time the summary is written, so a deleted list's pages do not stay behind.
    public func keepPages(forLists listIDs: Set<String>) {
        for key in storedKeys() where !listIDs.contains(String(Self.listID(inKey: key))) {
            defaults.removeObject(forKey: key)
        }
    }

    /// Call it when the musician signs out. The lists are theirs, so no later account reads them.
    public func removeAllPages() {
        for key in storedKeys() { defaults.removeObject(forKey: key) }
    }

    /// Moves to the page holding the current tune only when the tune changed since the last
    /// call, so a page the musician flipped to stays until the next tune. The tune is matched by
    /// ID, so an edit that moves tunes around the current one keeps the page.
    private func followCurrentTune(
        listID: String, size: ListWidgetSize, tuneID: String, tuneIndex: Int, paging: ListWidgetPaging
    ) {
        let followedKey = Self.key("followedTune", listID, size)
        guard defaults.string(forKey: followedKey) != tuneID else { return }
        defaults.set(tuneID, forKey: followedKey)
        setPage(paging.page(holding: tuneIndex), forList: listID, size: size)
    }

    private static let keyPrefix = "listWidget."

    private func storedKeys() -> [String] {
        defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix(Self.keyPrefix) }
    }

    private static func key(_ name: String, _ listID: String, _ size: ListWidgetSize) -> String {
        "\(keyPrefix)\(name).\(size.rawValue).\(listID)"
    }

    /// The list ID is all that follows the third dot, so an ID that holds a dot still reads whole.
    private static func listID(inKey key: String) -> Substring {
        key.split(separator: ".", maxSplits: 3).last ?? ""
    }
}
