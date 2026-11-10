#if os(macOS)
    import SwiftUI

    /// Draws a `LabeledContent` as its content alone, for a control that something else already
    /// names, such as a row's label or a menu's own word. The automatic style ignores
    /// `.labelsHidden()` outside a `Form`.
    struct MacControlOnlyStyle: LabeledContentStyle {
        func makeBody(configuration: Configuration) -> some View {
            configuration.content
        }
    }
#endif
