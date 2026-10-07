import SwiftUI

#if os(iOS)
    @preconcurrency import PostHog
#endif

extension View {
    /// Hides this view in session replay recordings. Put it on every view that shows what the
    /// musician wrote or named: titles, notes, lyrics, list and recording names, scans, and any
    /// field they type into. The replay also masks text and images by type; an explicit mask
    /// holds whatever the SDK's type rules match. The Mac records no replay, so there it changes
    /// nothing.
    public func contentMask() -> some View {
        #if os(iOS)
            postHogMask()
        #else
            self
        #endif
    }
}
