import SwiftUI

#if os(iOS)
    import AVKit
#endif

extension View {
    /// Sets the system's control for choosing where audio plays (AirPlay speakers, headphones,
    /// or this device) at the trailing edge, and leaves its width clear on each side so the
    /// view never meets it. The Mac has none: its picker routes only an `AVPlayer`, and the
    /// engine follows the output chosen in the menu bar's Sound control.
    package func audioRoutePicker() -> some View {
        #if os(iOS)
            padding(.horizontal, minimumTapTarget)
                .overlay(alignment: .trailing) {
                    RoutePickerRepresentable()
                        .frame(width: minimumTapTarget, height: minimumTapTarget)
                        .dynamicTypeSize(...DynamicTypeSize.large)
                }
        #else
            self
        #endif
    }
}

#if os(iOS)
    /// Routes the whole audio session, which the player's engine plays into.
    private struct RoutePickerRepresentable: UIViewRepresentable {
        func makeUIView(context: Context) -> AVRoutePickerView {
            let view = AVRoutePickerView()
            view.prioritizesVideoDevices = false
            return view
        }

        func updateUIView(_ view: AVRoutePickerView, context: Context) {}
    }
#endif
