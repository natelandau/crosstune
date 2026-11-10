#if os(macOS)
    import SwiftUI

    /// A label that turns semibold when chosen without changing width: the semibold copy is laid
    /// out hidden under it, so choosing never shifts the neighbors.
    struct MacSteadyWidthLabel<Label: View>: View {
        let isSemibold: Bool
        @ViewBuilder let label: (Font.Weight) -> Label

        var body: some View {
            ZStack {
                label(.semibold).hidden()
                label(isSemibold ? .semibold : .regular)
            }
        }
    }
#endif
