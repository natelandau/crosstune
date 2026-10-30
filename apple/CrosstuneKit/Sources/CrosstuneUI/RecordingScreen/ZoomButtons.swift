import SwiftUI

/// The Trim and Split screens' readouts between a zoom out and a zoom in button.
struct ZoomButtons<Readouts: View>: View {
    var spacing: CGFloat?
    let canZoomOut: Bool
    let canZoomIn: Bool
    /// Takes how many times to zoom in; under 1 zooms out.
    let onZoom: @MainActor (Double) -> Void
    @ContentBuilder let readouts: Readouts

    var body: some View {
        HStack(spacing: spacing) {
            Button(RecordingScreenText.zoomOut, systemImage: "minus.magnifyingglass") {
                onZoom(1 / WaveformSteps.zoomStep)
            }
            .help(RecordingScreenText.zoomOut)
            .disabled(!canZoomOut)
            readouts
            Button(RecordingScreenText.zoomIn, systemImage: "plus.magnifyingglass") {
                onZoom(WaveformSteps.zoomStep)
            }
            .help(RecordingScreenText.zoomIn)
            .disabled(!canZoomIn)
        }
        .labelStyle(.iconTapTarget)
        .buttonStyle(.borderless)
        .font(.platform(.title3))
    }
}
