import SwiftUI

extension View {
    /// Return moves to `next` on iPhone and iPad, labeled Next, for a form of several fields.
    /// The Mac moves with Tab, so its Return keeps its own meaning.
    package func returnFocuses(_ next: FocusState<Bool>.Binding) -> some View {
        #if os(iOS)
            submitLabel(.next)
                .onSubmit { next.wrappedValue = true }
        #else
            self
        #endif
    }
}
