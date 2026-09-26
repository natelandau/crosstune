import SwiftUI

/// A tune's status as a dot beside its label. Status is never color alone.
public struct StatusDot: View {
    private let status: String
    private let onFill: Bool

    @ScaledMetric(relativeTo: .subheadline) private var diameter: CGFloat = 10

    /// `onFill` is for a dot on a chosen capsule, where it takes the capsule's text color so it
    /// never sinks into the fill; the label carries the meaning either way.
    public init(_ status: String, onFill: Bool = false) {
        self.status = status
        self.onFill = onFill
    }

    public var body: some View {
        HStack(spacing: 6) {
            dot
                .frame(width: diameter, height: diameter)
                .accessibilityHidden(true)
            Text(StatusStyle.label(status))
                .lineLimit(1)
        }
        .fixedSize()
    }

    @ViewBuilder private var dot: some View {
        switch StatusStyle.dot(status) {
        case .filled(let color):
            Circle().fill(onFill ? .white : color)
        case .ring:
            Circle().strokeBorder(onFill ? AnyShapeStyle(.white) : AnyShapeStyle(.secondary), lineWidth: 2)
        }
    }
}

#Preview("Status dots") {
    VStack(alignment: .leading, spacing: 12) {
        StatusDot("known")
        StatusDot("learning")
        StatusDot("want_to_learn")
        StatusDot("from_a_newer_server")
    }
    .font(.subheadline)
    .padding()
}
