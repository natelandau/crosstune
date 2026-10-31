import CrosstuneAudio
import CrosstuneCommands
import CrosstuneDesign
import CrosstuneStore
import SwiftUI

/// Where the musician splits a recording into one per tune: the whole recording with its
/// pieces, a zoomed strip under a fixed center line where a cut lands, the readout, the main
/// button, the cuts, and a transport. Its model holds the player at 100% speed and no pitch
/// shift while it shows, so what is heard is exactly where a cut falls.
struct SplitScreen: View {
    let model: SplitModel
    let player: PlayerModel
    /// The peaks for the recording's trim range as the screen opened on it.
    let peaks: ShownPeaks?
    /// Returns to the recording screen.
    let onDone: () -> Void

    @State private var failure: String?
    @FocusState private var focus: SplitFocus?

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
                CenterLineStrip(model: model, peaks: peaks, focus: $focus)
                    .contentMask()
                VStack(spacing: 20) {
                    SplitReadout(model: model)
                    SplitMainButton(model: model, ready: ready)
                    HStack(spacing: 12) {
                        Button(action: model.previous) {
                            Text(RecordingScreenText.previousCut).frame(maxWidth: .infinity)
                        }
                        .disabled(!model.canStepPrevious)
                        Button(action: model.next) {
                            Text(RecordingScreenText.nextCut).frame(maxWidth: .infinity)
                        }
                        .disabled(!model.canStepNext)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    SplitCutList(model: model)
                    SplitTransport(model: model)
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
        #if os(iOS)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { cancelButton }
                ConfirmToolbarItem { saveButton }
            }
        #else
            .paneBar {
                cancelButton
                .buttonStyle(.macSecondary)
                .keyboardShortcut(.cancelAction)
                .help(RecordingScreenText.cancel)
                saveButton
                .buttonStyle(.macPrimary)
                .help(RecordingScreenText.save)
            }
        #endif
        .focusable()
        .focusEffectDisabled()
        .focused($focus, equals: .screen)
        .defaultFocus($focus, .screen)
        // These are off while text is typed, and a focused button keeps them.
        .onKeyPress(.space, phases: .down) { _ in
            guard ready, !TextEntry.isActive else { return .ignored }
            model.togglePlay()
            return .handled
        }
        // Held arrows repeat, sweeping the line, or a focused cut's handle, as a slider does.
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
            guard ready, !TextEntry.isActive, press.modifiers.isDisjoint(with: .otherCommand) else {
                return .ignored
            }
            let back = press.key == .leftArrow || press.key == .downArrow
            let step = press.modifiers.contains(.shift) ? WaveformSteps.largeNudgeMs : WaveformSteps.nudgeMs
            if case .cut(let index) = focus {
                model.nudgeCut(index, by: back ? -step : step)
                return .handled
            }
            guard press.key == .leftArrow || press.key == .rightArrow else { return .ignored }
            model.nudge(by: back ? -step : step)
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
        @Bindable var model = model
        return Button(RecordingScreenText.save) { model.isConfirming = true }
            .disabled(!model.state.canSave || model.isSaving)
            .coversShell(model.isConfirming)
            .confirmationDialog(
                RecordingScreenText.splitConfirmTitle(count: model.state.cuts.count + 1),
                isPresented: $model.isConfirming, titleVisibility: .visible
            ) {
                Button(RecordingScreenText.splitConfirmAction, role: .destructive) { Task { await save() } }
                Button(RecordingScreenText.cancel, role: .cancel) {}
            } message: {
                Text(RecordingScreenText.splitConfirmMessage)
            }
    }

    private func leave() {
        model.leave()
        onDone()
    }

    private func save() async {
        failure = nil
        do {
            if try await model.save() { onDone() }
        } catch CommandError.recordingNotFound {
            // The recording is gone, and the player and this screen go with it.
        } catch {
            // A trim from elsewhere closes the screen, saying why, in place of this.
            if !model.isStale { failure = failureMessage(error) }
        }
    }
}

/// The time at the line, the piece it is in, and that piece's length. Its own view, so the
/// playback tick redraws it and not the screen around it.
private struct SplitReadout: View {
    let model: SplitModel

    var body: some View {
        let lineMs = model.shownLineMs
        let pieces = model.state.pieces
        let index = min(model.state.pieceIndex(at: lineMs), pieces.count - 1)
        ZoomButtons(spacing: 12, canZoomOut: model.canZoomOut, canZoomIn: model.canZoomIn, onZoom: model.zoom(by:)) {
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
}

/// Skip back, play and pause, and skip forward. Play starts at the line, or at the selected
/// piece's start, and stops at the end of its piece.
private struct SplitTransport: View {
    let model: SplitModel

    var body: some View {
        let skip = AudioPlayer.skipInterval
        EditorTransport(playing: model.isPlaying, playName: RecordingPlayerText.play, onToggle: model.togglePlay) {
            Button(RecordingPlayerText.skipBack(skip), systemImage: "gobackward.15") {
                model.skip(by: -Int64(skip * 1000))
            }
            .help(RecordingPlayerText.skipBack(skip))
        } trailing: {
            Button(RecordingPlayerText.skipForward(skip), systemImage: "goforward.15") {
                model.skip(by: Int64(skip * 1000))
            }
            .help(RecordingPlayerText.skipForward(skip))
        }
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

    @Environment(\.practiceBackground) private var practiceScheme
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
                    .foregroundStyle(numberStyle)
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

    /// White on the practice background, the text color off it.
    private var numberStyle: AnyShapeStyle {
        practiceScheme != nil ? AnyShapeStyle(Palette.onPractice) : AnyShapeStyle(.textPrimary)
    }
}
