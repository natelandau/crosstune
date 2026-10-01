import CrosstuneStore
import SwiftUI

#if os(iOS)
    import GameController
#elseif os(macOS)
    import AppKit
#endif

/// The overview, the loop lane, and the zoomed waveform, sharing one zoom, then the readout:
/// the playhead, the selected loop, Fit, and the zoom buttons. A pinch over the lane or the
/// waveform zooms, as does Control scroll on a Mac.
struct PracticeLanes: View {
    let model: PracticeModel
    let peaks: ShownPeaks?
    /// The zoomed waveform's height: shorter on a landscape phone.
    let detailHeight: CGFloat
    var focus: FocusState<PracticeFocus?>.Binding

    @Environment(\.spacing) private var spacing
    @GestureState private var isPinching = false

    /// Whether a drag snaps its edges now: not while Option is held on a hardware keyboard. The
    /// Mac hears Option change; an iPad's keyboard is read as the drag moves.
    static func snaps(_ model: PracticeModel) -> Bool {
        #if os(iOS)
            let keys = GCKeyboard.coalesced?.keyboardInput
            return ![GCKeyCode.leftAlt, .rightAlt].contains { keys?.button(forKeyCode: $0)?.isPressed == true }
        #else
            model.snapsEdges
        #endif
    }

    var body: some View {
        VStack(spacing: spacing.stackGap) {
            if model.laneView != nil {
                OverviewStrip(model: model, peaks: peaks)
                VStack(spacing: spacing.stackGap) {
                    LoopLane(model: model)
                    if let reason = model.create.reason {
                        Text(reason)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    DetailWaveform(model: model, peaks: peaks, height: detailHeight, focus: focus)
                }
                .simultaneousGesture(
                    MagnifyGesture()
                        .updating($isPinching) { _, pinching, _ in pinching = true }
                        .onChanged { value in
                            model.pinch(value.magnification, anchorX: Double(value.startAnchor.x) * model.width)
                        }
                )
                #if os(macOS)
                    .background { ControlScrollZoom(isEnabled: true) { model.zoom(by: $0, aroundX: $1) } }
                #endif
                readout
            } else {
                // Holds the width to measure until the zoom can be laid out.
                Color.clear.frame(height: 1)
            }
        }
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: Double.self) {
            Double($0.size.width)
        } action: {
            model.setWidth($0)
        }
        #if os(macOS)
            // Holding Option lets a drag land between snap points. A change only reports keys
            // pressed after the view appears, so one already held is read on appear.
            .onAppear { model.snapsEdges = !NSEvent.modifierFlags.contains(.option) }
            .onModifierKeysChanged(mask: .option) { _, keys in
                model.snapsEdges = !keys.contains(.option)
            }
        #endif
        .onChange(of: isPinching) { _, pinching in
            if !pinching { model.endPinch() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(PracticeText.waveform)
    }

    private var readout: some View {
        HStack(spacing: spacing.stackGap) {
            Text(PlayerTime.clock(model.positionMs / 1000))
                .font(.footnote)
                .monospacedDigit()
            Text(selectedText)
                .font(.footnote)
                .monospacedDigit()
                .lineLimit(1)
                .frame(maxWidth: .infinity)
            Button {
                model.fit()
            } label: {
                Text(PracticeText.fit)
                    .font(.subheadline)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
            iconButton(RecordingScreenText.zoomOut, systemImage: "minus.magnifyingglass") {
                model.zoom(by: 1 / PracticeModel.zoomStep)
            }
            .keyboardShortcut("-", modifiers: .command)
            .disabled(!model.canZoomOut)
            iconButton(RecordingScreenText.zoomIn, systemImage: "plus.magnifyingglass") {
                model.zoom(by: PracticeModel.zoomStep)
            }
            .keyboardShortcut("=", modifiers: .command)
            .disabled(!model.canZoomIn)
        }
        .buttonStyle(.borderless)
    }

    private func iconButton(_ name: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(name, systemImage: systemImage)
                .labelStyle(.iconOnly)
                .font(.title3)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        .help(name)
    }

    /// `B part · 0:58 – 1:51`, or nothing with no loop selected.
    private var selectedText: String {
        guard let row = model.selected, let span = model.shownSpan(row.id) else { return "" }
        let range = PracticeText.range(startMs: span.startMs - model.trimStartMs, endMs: span.endMs - model.trimStartMs)
        return "\(model.name(row)) · \(range)"
    }
}
