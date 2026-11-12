#if os(iOS)
    import SwiftUI

    extension View {
        /// The system search field pinned under the title, typed as a search, with scrolling the
        /// list closing the keyboard at once so the results come into view.
        package func listSearch(text: Binding<String>, prompt: String) -> some View {
            searchable(text: text, placement: .navigationBarDrawer(displayMode: .always), prompt: prompt)
                .textEntry(.search)
                .scrollDismissesKeyboard(.immediately)
        }
    }
#endif
