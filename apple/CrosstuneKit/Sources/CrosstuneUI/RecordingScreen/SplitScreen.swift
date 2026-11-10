import CrosstuneAudio
import CrosstuneDesign
import SwiftUI

/// Where the musician splits a recording into one per tune: the whole recording with its
/// pieces, a zoomed strip under a fixed center line where a cut lands, the readout, the main
/// button, the cuts, and a transport. Its model holds the player at 100% speed, no pitch
/// shift, and nothing isolated while it shows, so what is heard is exactly where a cut falls.
struct SplitScreen: View {
    let model: SplitModel
    let player: PlayerModel
    /// The peaks for the recording's trim range as the screen opened on it.
    let peaks: ShownPeaks?
    /// Returns to the recording screen.
    let onDone: () -> Void

    @State private var failure: String?

    var body: some View {
        let ready = player.isRecordingAudioReady
        ScrollView {
            VStack(spacing: 20) {
                if let message = player.failure ?? failure {
                    PlayerFailureText(message)
                        .controlsColumn()
                }
                SplitOverviewStrip(model: model, peaks: peaks)
                    .contentMask()
                CenterLineStrip(model: model, peaks: peaks)
                    .contentMask()
                VStack(spacing: 20) {
                    SplitReadout(model: model)
                    SplitMainButton(model: model, ready: ready)
                    SplitCutSteps(model: model)
                    SplitCutList(model: model)
                    SplitTransport(model: model, ready: ready)
                }
                .controlsColumn()
            }
            .disabled(!ready)
            .padding(16)
        }
        .navigationTitle(RecordingScreenText.split)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .navigationBarBackButtonHidden()
        .editorActions {
            cancelButton
        } save: {
            saveButton
        }
        .keySurface()
        // These are off while text is typed, and a focused button keeps them.
        .onKeyPress(.space, phases: .down) { _ in
            guard ready, !TextEntry.isActive else { return .ignored }
            model.togglePlay()
            return .handled
        }
        // Held arrows repeat, sweeping the line, as a slider does. A focused cut's handle takes
        // its own arrows first.
        .onKeyPress(keys: [.leftArrow, .rightArrow]) { press in
            guard ready, !TextEntry.isActive, press.modifiers.isDisjoint(with: .otherCommand) else {
                return .ignored
            }
            let step = press.modifiers.contains(.shift) ? WaveformSteps.largeNudgeMs : WaveformSteps.nudgeMs
            model.nudge(by: press.key == .leftArrow ? -step : step)
            return .handled
        }
        .onKeyPress(characters: CharacterSet(charactersIn: "sS"), phases: .down) { press in
            guard ready, !TextEntry.isActive, press.modifiers.isDisjoint(with: .otherCommand) else {
                return .ignored
            }
            model.addCut()
            return .handled
        }
        .onChange(of: ready, initial: true) { _, ready in
            if ready { model.attach(player.audio) { player.endPlayback(atSourceMs: $0) } }
        }
        .background {
            PlayerReadingWatch(player: player) { model.follow(playing: $0.playing, elapsed: $0.elapsed) }
        }
        .onDisappear { model.leave() }
    }

    private var cancelButton: some View {
        Button(RecordingScreenText.cancel, action: leave)
    }

    private var saveButton: some View {
        EditorSaveButton(
            model: model, isDisabled: !model.canPressSave,
            confirmTitle: RecordingScreenText.splitConfirmTitle(count: model.state.cuts.count + 1),
            confirmAction: RecordingScreenText.splitConfirmAction,
            confirmMessage: RecordingScreenText.splitConfirmMessage, failure: $failure,
            failureText: failureMessage, onLeave: leave, onDone: onDone)
    }

    private func leave() {
        model.leave()
        onDone()
    }
}

/// The zoom control around the time at the line, the piece it is in, and that piece's length.
private struct SplitReadout: View {
    let model: SplitModel

    var body: some View {
        ZoomControl(
            canZoomOut: model.canZoomOut, canZoomIn: model.canZoomIn, canFit: model.canZoomOut, spacing: 12,
            onZoomOut: { model.zoom(by: 1 / WaveformSteps.zoomStep) }, onFit: model.fit,
            onZoomIn: { model.zoom(by: WaveformSteps.zoomStep) },
            aroundReadouts: { SplitReadoutText(model: model) })
    }
}

/// The readouts beside the zoom control. Its own view, so the playback tick redraws the texts
/// and not the control around them.
private struct SplitReadoutText: View {
    let model: SplitModel

    var body: some View {
        let lineMs = model.shownLineMs
        let pieces = model.state.pieces
        let index = min(model.state.pieceIndex(at: lineMs), pieces.count - 1)
        HStack(spacing: 12) {
            Text(RecordingScreenText.preciseTime(milliseconds: lineMs - model.bounds.lowerBound))
            Text(RecordingScreenText.pieceOf(index + 1, count: pieces.count))
            Text(RecordingText.duration(of: pieces[index].lengthMs))
        }
        .font(.platform(.footnote))
        .monospacedDigit()
        .foregroundStyle(.textSecondary)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// Skip back, play and pause, and skip forward. Play starts at the line, or at the selected
/// piece's start, and stops at the end of its piece.
private struct SplitTransport: View {
    let model: SplitModel
    let ready: Bool

    var body: some View {
        let skip = Int64(AudioPlayer.skipInterval * 1000)
        Transport(
            isPlaying: model.isPlaying, size: .feature, canPlay: ready, canGoBack: ready,
            canGoForward: ready, onPlayPause: model.togglePlay, onBack: { model.skip(by: -skip) },
            onForward: { model.skip(by: skip) })
    }
}

/// The whole trimmed recording with its pieces as numbered bands in loop colors once cut, a
/// line at each cut, the line, and a box around the stretch the zoomed strip shows. A tap or drag
/// moves the line there. Touch and pointer only: the zoomed strip and the cut list reach the same
/// places otherwise.
private struct SplitOverviewStrip: View {
    let model: SplitModel
    let peaks: ShownPeaks?

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        OverviewStrip(source: model, peaks: peaks, style: .split) {
            PieceNumbers(model: model)
        }
        .opacity(isEnabled ? 1 : 0.5)
    }
}

/// Each piece's number, centered over its band.
private struct PieceNumbers: View {
    let model: SplitModel

    @State private var width: Double = 0

    private static let height: CGFloat = 16

    var body: some View {
        let low = model.bounds.lowerBound
        let lengthMs = Double(model.bounds.upperBound - low)
        ZStack(alignment: .topLeading) {
            Color.clear
            ForEach(model.state.pieces.enumerated(), id: \.offset) { index, piece in
                Text("\(index + 1)")
                    .font(.platform(.caption))
                    .monospacedDigit()
                    .foregroundStyle(.textPrimary)
                    .fixedSize()
                    .position(
                        x: lengthMs > 0 ? Double(piece.startMs + piece.endMs - 2 * low) / 2 / lengthMs * width : 0,
                        y: Self.height / 2)
            }
        }
        .frame(height: Self.height)
        .onGeometryChange(for: Double.self) {
            Double($0.size.width)
        } action: {
            width = $0
        }
    }

}
