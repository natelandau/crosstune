import SwiftUI

extension View {
    /// Holds a row's line of text to one line, or to three at the accessibility text sizes,
    /// where one line holds too few words to tell one row from the next.
    func rowLineLimit() -> some View {
        modifier(RowLineLimit())
    }
}

private struct RowLineLimit: ViewModifier {
    @Environment(\.dynamicTypeSize) private var size

    func body(content: Content) -> some View {
        content.lineLimit(size.isAccessibilitySize ? 3 : 1)
    }
}
