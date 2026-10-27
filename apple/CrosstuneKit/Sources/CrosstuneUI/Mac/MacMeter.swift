#if os(macOS)
    import SwiftUI

    /// A hairline meter in the primary text color on a hairline track, quieter than a progress bar,
    /// for a fact to glance at (storage used) rather than a task under way. Never the accent: it is
    /// not a control.
    struct MacMeter: View {
        static let height: CGFloat = 3

        let fraction: Double

        static func clamped(_ fraction: Double) -> Double { min(max(fraction, 0), 1) }

        var body: some View {
            Capsule()
                .fill(Palette.border)
                .overlay(alignment: .leading) {
                    GeometryReader { proxy in
                        Capsule()
                            .fill(Palette.textTertiary)
                            .frame(width: proxy.size.width * Self.clamped(fraction))
                    }
                }
                .frame(height: Self.height)
                // VoiceOver reads it as a progress indicator; the call site names it.
                .accessibilityRepresentation { ProgressView(value: Self.clamped(fraction)) }
        }
    }
#endif
