import SwiftUI

/// Zoom out, Fit, and Zoom in on a translucent capsule. The shortcuts match the Practice
/// waveform's: Cmd-minus, Cmd-0, Cmd-equals. On the Mac zoom out and zoom in are small icon
/// buttons with Fit a Text button between them, on a raised backing.
///
/// Built with `aroundReadouts`, it leads with the readouts it zooms; on the Mac that form draws
/// the zoom-out icon button, the readouts, and the zoom-in icon button, with no Fit and no
/// backing.
package struct ZoomControl: View {
    nonisolated package static let zoomOut = "Zoom out"
    nonisolated package static let fit = "Fit"
    nonisolated package static let zoomIn = "Zoom in"

    private let canZoomOut: Bool
    private let canZoomIn: Bool
    private let canFit: Bool
    private let onZoomOut: () -> Void
    private let onFit: () -> Void
    private let onZoomIn: () -> Void
    private let spacing: CGFloat?
    private let readouts: AnyView?

    package init(
        canZoomOut: Bool, canZoomIn: Bool, canFit: Bool,
        onZoomOut: @escaping () -> Void, onFit: @escaping () -> Void, onZoomIn: @escaping () -> Void
    ) {
        self.canZoomOut = canZoomOut
        self.canZoomIn = canZoomIn
        self.canFit = canFit
        self.onZoomOut = onZoomOut
        self.onFit = onFit
        self.onZoomIn = onZoomIn
        spacing = nil
        readouts = nil
    }

    /// - Parameter spacing: Between the readouts and the control.
    package init<Readouts: View>(
        canZoomOut: Bool, canZoomIn: Bool, canFit: Bool, spacing: CGFloat? = nil,
        onZoomOut: @escaping () -> Void, onFit: @escaping () -> Void, onZoomIn: @escaping () -> Void,
        @ViewBuilder aroundReadouts readouts: () -> Readouts
    ) {
        self.canZoomOut = canZoomOut
        self.canZoomIn = canZoomIn
        self.canFit = canFit
        self.onZoomOut = onZoomOut
        self.onFit = onFit
        self.onZoomIn = onZoomIn
        self.spacing = spacing
        self.readouts = AnyView(readouts())
    }

    @ViewBuilder package var body: some View {
        if let readouts {
            #if os(macOS)
                HStack(spacing: spacing) {
                    macButton(Self.zoomOut, systemImage: "minus.magnifyingglass", action: onZoomOut)
                        .disabled(!canZoomOut)
                    readouts
                    macButton(Self.zoomIn, systemImage: "plus.magnifyingglass", action: onZoomIn)
                        .disabled(!canZoomIn)
                }
                .buttonStyle(.mac(.icon))
            #else
                HStack(spacing: spacing) {
                    readouts
                    control
                }
            #endif
        } else {
            control
        }
    }

    @ViewBuilder private var control: some View {
        #if os(macOS)
            HStack(spacing: 0) {
                macButton(Self.zoomOut, systemImage: "minus.magnifyingglass", action: onZoomOut)
                    .keyboardShortcut("-", modifiers: .command)
                    .disabled(!canZoomOut)
                Button(Self.fit, action: onFit)
                    .buttonStyle(.mac(.plain, size: .small))
                    .keyboardShortcut("0", modifiers: .command)
                    .disabled(!canFit)
                macButton(Self.zoomIn, systemImage: "plus.magnifyingglass", action: onZoomIn)
                    .keyboardShortcut("=", modifiers: .command)
                    .disabled(!canZoomIn)
            }
            .buttonStyle(.mac(.icon, size: .small))
            .padding(2)
            .background {
                RoundedRectangle(cornerRadius: MacControl.radius)
                    .fill(Palette.surfaceRaised)
                    .elevation(.control)
            }
            // Takes every press on the backing, so none falls through to the waveform under it.
            .contentShape(.rect(cornerRadius: MacControl.radius))
        #else
            HStack(spacing: 0) {
                Button(Self.zoomOut, systemImage: "minus.magnifyingglass", action: onZoomOut)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.icon)
                    .keyboardShortcut("-", modifiers: .command)
                    .disabled(!canZoomOut)
                    .accessibilityShowsLargeContentViewer()
                Button(Self.fit, action: onFit)
                    .buttonStyle(.text(oneLine: true))
                    .keyboardShortcut("0", modifiers: .command)
                    .disabled(!canFit)
                    .accessibilityShowsLargeContentViewer()
                Button(Self.zoomIn, systemImage: "plus.magnifyingglass", action: onZoomIn)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.icon)
                    .keyboardShortcut("=", modifiers: .command)
                    .disabled(!canZoomIn)
                    .accessibilityShowsLargeContentViewer()
            }
            // Capped so the cluster stays a corner control that never reaches the playhead.
            .dynamicTypeSize(...DynamicTypeSize.large)
            .background(.regularMaterial, in: .capsule)
            .overlay { Capsule().strokeBorder(Palette.border, lineWidth: 1) }
            // Takes every press on the capsule, so none falls through to the waveform under it.
            .contentShape(.capsule)
        #endif
    }

    #if os(macOS)
        private func macButton(_ name: String, systemImage: String, action: @escaping () -> Void) -> some View {
            Button(action: action) {
                Label(name, systemImage: systemImage)
                    .labelStyle(.iconOnly)
            }
            .help(name)
            .accessibilityShowsLargeContentViewer()
        }
    #endif
}

#Preview("Zoom control") {
    ZoomControl(
        canZoomOut: true, canZoomIn: true, canFit: true, onZoomOut: {}, onFit: {}, onZoomIn: {}
    )
    .padding()
}
