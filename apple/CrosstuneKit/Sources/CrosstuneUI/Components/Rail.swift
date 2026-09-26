import SwiftUI

/// A rail of chips that stays on one line at every width and text size. When the chips do not
/// fit it scrolls, fades at each end while there is more that way, and keeps the chosen chip in
/// view.
///
/// Each chip carries `.id(_:)` with the value `chosen` names.
public struct Rail<ID: Hashable, Content: View>: View {
    private let chosen: ID
    private let inset: CGFloat
    private let content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Whether chips lie past the leading and the trailing edge.
    @State private var more = Overflow()

    private struct Overflow: Equatable {
        var leading = false
        var trailing = false
    }

    /// - Parameters:
    ///   - chosen: The id of the chip to keep in view.
    ///   - inset: The space before the first chip and after the last; a scrolling rail runs under
    ///     it to the edge.
    public init(chosen: ID, inset: CGFloat = 0, @ViewBuilder content: () -> Content) {
        self.chosen = chosen
        self.inset = inset
        self.content = content()
    }

    /// The width of the fade at each end.
    nonisolated static var fade: CGFloat { 32 }

    public var body: some View {
        // The fixed line comes first, so a rail that fits never scrolls, and an image renderer,
        // which cannot draw a scroll view, still draws it.
        ViewThatFits(in: .horizontal) {
            chips
                .padding(.horizontal, inset)
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    chips
                }
                .contentMargins(.horizontal, inset, for: .scrollContent)
                .scrollIndicators(.hidden)
                .onScrollGeometryChange(for: Overflow.self) { geometry in
                    // At rest the offset is minus the leading margin; at the far end the trailing
                    // margin shows past the content.
                    let offset = geometry.contentOffset.x
                    let farEnd =
                        geometry.contentSize.width + geometry.contentInsets.trailing - geometry.containerSize.width
                    return Overflow(
                        leading: offset > -geometry.contentInsets.leading + 1, trailing: offset < farEnd - 1)
                } action: { _, overflow in
                    more = overflow
                }
                .mask { fadeMask }
                .onAppear { proxy.scrollTo(chosen, anchor: .center) }
                .onChange(of: chosen) { _, chosen in
                    withAnimation(reduceMotion ? nil : .default) { proxy.scrollTo(chosen, anchor: .center) }
                }
            }
        }
    }

    private var chips: some View {
        HStack(spacing: 8) {
            content
        }
        .fixedSize()
    }

    private var fadeMask: some View {
        HStack(spacing: 0) {
            LinearGradient(
                colors: [.black.opacity(more.leading ? 0 : 1), .black], startPoint: .leading, endPoint: .trailing
            )
            .frame(width: Self.fade)
            Rectangle()
            LinearGradient(
                colors: [.black, .black.opacity(more.trailing ? 0 : 1)], startPoint: .leading, endPoint: .trailing
            )
            .frame(width: Self.fade)
        }
    }
}
