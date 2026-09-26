import CrosstuneAudio
import SwiftUI

/// Records one take over whatever screen is open, so finishing returns the musician to where
/// they were. A live take refuses a swipe away; Stop and Cancel are the ways out.
public struct RecordSheet: View {
    private let model: RecordSheetModel
    private let claim: @MainActor () -> Bool

    @Environment(\.dismiss) private var dismiss

    /// - Parameter claim: Takes the shared recorder as the sheet shows; false when another
    ///   window's sheet has it.
    public init(model: RecordSheetModel, claim: @escaping @MainActor () -> Bool) {
        self.model = model
        self.claim = claim
    }

    public var body: some View {
        NavigationStack {
            RecordSheetBody(model: model)
                .navigationTitle(RecordSheetModel.title)
                #if os(iOS)
                    .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        if model.isLive || model.phase == .saving {
                            Button(RecordSheetModel.cancel) { Task { await model.cancel() } }
                                .disabled(!model.isLive)
                        } else {
                            Button(RecordSheetModel.done) { model.finish() }
                        }
                    }
                }
        }
        #if os(macOS)
            .frame(minWidth: 420, idealWidth: 460, minHeight: 440, idealHeight: 480)
        #endif
        .interactiveDismissDisabled(model.isLive || model.phase == .saving)
        .confirmationDialog(
            RecordSheetModel.discardTitle, isPresented: Bindable(model).confirmsDiscard, titleVisibility: .visible
        ) {
            Button(RecordSheetModel.discard, role: .destructive) { Task { await model.discard() } }
        } message: {
            Text(RecordSheetModel.discardMessage)
        }
        .sensoryFeedback(trigger: model.phase) { old, new in
            RecordSheetModel.feedback(from: old, to: new)
        }
        .task { await model.open(claim: claim) }
        .onChange(of: model.recorder.savedRecordingID) { model.settle() }
        .onChange(of: model.outcome) {
            guard model.outcome != nil else { return }
            dismiss()
        }
        .onDisappear {
            Task { await model.abandon() }
        }
        .shellSheet()
    }
}

private struct RecordSheetBody: View {
    let model: RecordSheetModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    @ScaledMetric(relativeTo: .largeTitle) private var timerSize: CGFloat = 64

    var body: some View {
        VStack(spacing: 24) {
            status
            Spacer(minLength: 0)
            VStack(spacing: 16) {
                if model.isLive {
                    LiveWaveform(
                        levels: model.recorder.levels, levelCount: model.recorder.levelCount,
                        paused: model.phase != .recording)
                }
                if model.showsTimer {
                    timer
                }
                notes
            }
            Spacer(minLength: 0)
            controls
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(reduceMotion ? nil : .default, value: model.phase)
    }

    private var status: some View {
        HStack(spacing: 6) {
            if model.hasStarted {
                Image(systemName: "record.circle.fill")
                    .foregroundStyle(Color.recordingRed)
                    .symbolEffect(.pulse, options: .repeating, isActive: model.phase == .recording && !reduceMotion)
                    .transition(.symbolEffect(.appear))
                    .accessibilityHidden(true)
            }
            Text(model.status)
                .contentTransition(.opacity)
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }

    private var timer: some View {
        Text(RecordingText.duration(milliseconds: model.elapsedMilliseconds) ?? "")
            .font(.system(size: timerSize, weight: .light).monospacedDigit())
            .contentTransition(reduceMotion ? .identity : .numericText(countsDown: false))
            .animation(reduceMotion ? nil : .snappy, value: model.elapsedMilliseconds / 1000)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }

    @ViewBuilder private var notes: some View {
        if model.phase == .interrupted {
            Text(RecordSheetModel.interruptedMessage)
                .font(.footnote)
                .foregroundStyle(.orange)
                .multilineTextAlignment(.center)
        }
        if let message = model.message {
            Text(message)
                .font(.footnote)
                .foregroundStyle(model.phase == .saved ? Color.secondary : Color.red)
                .multilineTextAlignment(.center)
        }
        if model.recorder.permissionDenied, let url = Recorder.settingsURL {
            Button(RecordSheetModel.openSettings) { openURL(url) }
                .buttonStyle(.bordered)
        }
    }

    @ViewBuilder private var controls: some View {
        if model.isLive {
            HStack(spacing: 24) {
                StopButton(disabled: !model.hasStarted) { Task { await model.stop() } }
                if model.canResume {
                    Button(RecordSheetModel.resume, systemImage: "record.circle") { Task { await model.resume() } }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .transition(.opacity)
                }
            }
        }
    }
}

/// Stop, in the recording red with a large white label, the one thing to press while recording.
private struct StopButton: View {
    static let diameter: CGFloat = 96

    let disabled: Bool
    let action: () -> Void

    @Environment(\.drawsGlass) private var drawsGlass
    /// Grows with the label, so a large text size never cuts the word short.
    @ScaledMetric(relativeTo: .title2) private var scaledDiameter: CGFloat = StopButton.diameter

    var body: some View {
        let size = min(scaledDiameter, Self.diameter * 1.75)
        let button = Button(action: action) {
            Text(RecordSheetModel.stop)
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(.horizontal, 8)
                .frame(width: size, height: size)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .keyboardShortcut(.defaultAction)
        if drawsGlass {
            button.glassEffect(.regular.tint(.recordingRed).interactive(), in: .circle)
        } else {
            button.background(Circle().fill(Color.recordingRed))
        }
    }
}
