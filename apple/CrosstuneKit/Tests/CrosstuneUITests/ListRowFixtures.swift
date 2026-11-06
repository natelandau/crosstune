import CrosstuneStore
import SwiftUI

@testable import CrosstuneUI

/// A list entry for `tune` on list "l1" with no recordings, files, or links.
func bareListEntry(tune: Tune, userTune: UserTune) -> ListEntry {
    ListEntry(
        item: ListItem(listID: "l1", userTuneID: userTune.id), tune: tune, userTune: userTune, recordings: [],
        files: [:], links: [])
}

/// A recording for a list row's play action to load.
func sampleRecordingItem() -> PlayerItem {
    PlayerItem(kind: .recording, id: "r1", title: "x")
}

#if os(macOS)
    import AppKit

    /// The size `view` takes at `textSize`: the height it needs at `width`, or its ideal size
    /// with no width.
    @MainActor
    func hostedSize(_ view: some View, width: CGFloat? = nil, textSize: DynamicTypeSize = .large) -> CGSize {
        let hosted = view.environment(\.dynamicTypeSize, textSize)
        guard let width else { return NSHostingView(rootView: hosted).fittingSize }
        return NSHostingController(rootView: hosted).sizeThatFits(in: CGSize(width: width, height: 10_000))
    }
#endif
