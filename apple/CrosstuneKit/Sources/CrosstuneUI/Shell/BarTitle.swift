import SwiftUI

extension View {
    /// Puts `title` in the navigation bar only once the page's own title has scrolled under it,
    /// so the title never shows twice. The Mac's window title stays as it is.
    func barTitle(_ title: String, shown: Bool) -> some View {
        #if os(iOS)
            toolbarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        Text(title)
                            .contentMask()
                            .font(.headline)
                            .lineLimit(1)
                            .opacity(shown ? 1 : 0)
                            .accessibilityHidden(!shown)
                    }
                }
        #else
            self
        #endif
    }
}
