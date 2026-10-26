import CrosstuneAnalytics
import CrosstuneAudio
import SwiftUI

/// Records one recording over whatever screen is open, so finishing returns the musician to where
/// they were. A live recording refuses a swipe away; Stop and Cancel are the ways out.
public struct RecordSheet: View {
    private let model: RecordSheetModel
    private let claim: @MainActor () -> Bool

    /// - Parameter claim: Takes the shared recorder as the sheet shows; false when another
    ///   window's sheet has it.
    public init(model: RecordSheetModel, claim: @escaping @MainActor () -> Bool) {
        self.model = model
        self.claim = claim
    }

    /// The line naming the tune a recording is filed under.
    public static func filingUnder(_ title: String) -> String {
        "Filing under \(title)"
    }

    public var body: some View {
        #if os(macOS)
            MacSheet(
                title: macTitle, size: Self.macSize, cancel: macCancel,
                primary: Self.macPrimary(asksLocation: model.asksLocation, isContinuing: model.isContinuing) {
                    Task { await model.continueFromLocationNote() }
                }
            ) {
                RecordSheetBody(model: model)
            } accessory: {
                RecordingDot(model: model)
            }
            // The title is the only place the state shows, so VoiceOver hears each change.
            .onChange(of: model.status) { _, status in
                AccessibilityNotification.Announcement(status).post()
            }
            .modifier(RecordSheetLifecycle(model: model, claim: claim))
        #else
            NavigationStack {
                RecordSheetBody(model: model)
                    .navigationTitle(RecordSheetModel.title)
                    .navigationBarTitleDisplayMode(.inline)
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
            .modifier(RecordSheetLifecycle(model: model, claim: claim))
        #endif
    }

    #if os(macOS)
        static let macSize = MacSheetSize(
            minWidth: MacStyle.recordPanelWidth, idealWidth: MacStyle.recordPanelWidth, minHeight: 440,
            idealHeight: 480)

        /// The recording's state names the sheet, so no status line repeats it; the location note
        /// before the first recording keeps the sheet's own name.
        static func macTitle(asksLocation: Bool, status: String) -> String {
            asksLocation ? RecordSheetModel.title : status
        }

        private var macTitle: String {
            Self.macTitle(asksLocation: model.asksLocation, status: model.status)
        }

        /// Continue, which shows the location prompt, while the note before the first recording shows;
        /// afterward the sheet has no primary and Stop takes Return.
        static func macPrimary(
            asksLocation: Bool, isContinuing: Bool, action: @escaping @MainActor () -> Void
        ) -> MacSheetAction? {
            guard asksLocation else { return nil }
            return MacSheetAction(RecordSheetModel.continueToLocation, isEnabled: !isContinuing, action: action)
        }

        private var macCancel: MacSheetAction {
            if model.isLive || model.phase == .saving {
                .cancel(RecordSheetModel.cancel, isEnabled: model.isLive) { Task { await model.cancel() } }
            } else {
                .cancel(RecordSheetModel.done) { model.finish() }
            }
        }
    #endif
}

/// What the sheet does around its recording on both platforms: the discard question, the claim on
/// the recorder, and closing once the recording has an outcome.
private struct RecordSheetLifecycle: ViewModifier {
    let model: RecordSheetModel
    let claim: @MainActor () -> Bool

    @Environment(\.dismiss) private var dismiss

    func body(content: Content) -> some View {
        content
            .interactiveDismissDisabled(model.blocksSwipeDismiss)
            .confirmationDialog(
                RecordSheetModel.discardTitle, isPresented: Bindable(model).confirmsDiscard, titleVisibility: .visible
            ) {
                Button(RecordSheetModel.discard, role: .destructive) { Task { await model.discard() } }
            } message: {
                Text(RecordSheetModel.discardMessage)
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

#if os(macOS)
    /// The pulsing red dot on the Mac sheet's title line while a recording is under way.
    private struct RecordingDot: View {
        let model: RecordSheetModel

        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            if model.hasStarted {
                Image(systemName: "circle.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(Color.recordingRed)
                    .symbolEffect(.pulse, options: .repeating, isActive: model.phase == .recording && !reduceMotion)
                    .accessibilityHidden(true)
            }
        }
    }
#endif

struct RecordSheetBody: View {
    let model: RecordSheetModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 24) {
            if model.asksLocation {
                #if os(macOS)
                    // Read as a notice under the title, with Continue in the footer.
                    MacLocationNote()
                    Spacer(minLength: 0)
                #else
                    filing
                    Spacer(minLength: 0)
                    LocationNoteCard(model: model)
                    Spacer(minLength: 0)
                #endif
            } else {
                #if os(iOS)
                    status
                #endif
                filing
                Spacer(minLength: 0)
                VStack(spacing: 16) {
                    if model.isLive {
                        LiveWaveform(recorder: model.recorder, paused: model.phase != .recording)
                    }
                    if model.showsTimer {
                        RecordTimer(model: model)
                    }
                    notes
                }
                Spacer(minLength: 0)
                controls
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(reduceMotion ? nil : .default, value: model.phase)
    }

    #if os(iOS)
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
            .font(.platform(.subheadline))
            .foregroundStyle(.inkSecondary)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        }
    #endif

    /// Only the iPhone sheet names the tune; the Mac panel keeps its layout.
    @ViewBuilder private var filing: some View {
        #if os(iOS)
            if let title = model.tuneTitle {
                Text(RecordSheet.filingUnder(title))
                    .contentMask()
                    .font(.platform(.subheadline))
                    .foregroundStyle(.inkSecondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
        #endif
    }

    @ViewBuilder private var notes: some View {
        if model.phase == .interrupted {
            Text(RecordSheetModel.interruptedMessage)
                .font(.platform(.footnote))
                .foregroundStyle(SignalSwatch.warning(colorScheme).ink.color)
                .multilineTextAlignment(.center)
        }
        if let message = model.message {
            Text(message)
                .font(.platform(.footnote))
                #if os(macOS)
                    .foregroundStyle(
                        model.phase == .saved
                            ? .inkSecondary : AnyShapeStyle(SignalSwatch.danger(colorScheme).ink.color))
                #else
                    .foregroundStyle(
                        model.phase == .saved ? Palette.inkSecondary : SignalSwatch.danger(colorScheme).ink.color)
                #endif
                .multilineTextAlignment(.center)
        }
        if model.recorder.permissionDenied, let url = Recorder.settingsURL {
            Button(RecordSheetModel.openSettings) { openURL(url) }
                #if os(macOS)
                    .buttonStyle(.macSecondary)
                #else
                    .buttonStyle(.bordered)
                #endif
        }
    }

    @ViewBuilder private var controls: some View {
        if model.isLive {
            #if os(iOS)
                // A hidden copy of Resume on the leading side keeps Stop centered; where the
                // three do not fit across, Resume stacks under Stop.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 24) {
                        resume.hidden().accessibilityHidden(true)
                        stop
                        resume
                    }
                    VStack(spacing: 16) {
                        stop
                        resume
                    }
                }
            #else
                // A hidden copy of Resume on the leading side keeps Stop centered.
                HStack(spacing: 24) {
                    resume.hidden().accessibilityHidden(true)
                    stop
                    resume
                }
            #endif
        }
    }

    private var stop: some View {
        StopButton(disabled: !model.hasStarted) { Task { await model.stop() } }
    }

    @ViewBuilder private var resume: some View {
        if model.canResume {
            Button(RecordSheetModel.resume, systemImage: "record.circle") { Task { await model.resume() } }
                #if os(macOS)
                    .buttonStyle(.mac(.secondary, size: .large))
                #else
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                #endif
                .transition(.opacity)
        }
    }
}

#if os(macOS)
    /// Says why the recording will ask for location, ahead of the system prompt, laid out as a notice:
    /// the glyph leading, the headline, and the reason under it. The footer's Continue shows the
    /// prompt.
    private struct MacLocationNote: View {
        var body: some View {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "location.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(Palette.inkSecondary)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(RecordSheetModel.locationNoteTitle)
                        .font(MacStyle.sectionHeading)
                        .foregroundStyle(Palette.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(RecordSheetModel.locationNoteBody)
                        .font(MacStyle.body)
                        .foregroundStyle(Palette.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
#endif

#if os(iOS)
    /// Says why the recording will ask for location, ahead of the system prompt, which Continue shows.
    private struct LocationNoteCard: View {
        let model: RecordSheetModel

        var body: some View {
            VStack(spacing: 12) {
                Image(systemName: "location.fill")
                    .font(.platform(.title2))
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                Text(RecordSheetModel.locationNoteTitle)
                    .font(.platform(.headline))
                    .accessibilityAddTraits(.isHeader)
                Text(RecordSheetModel.locationNoteBody)
                    .font(.platform(.subheadline))
                    .foregroundStyle(.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button(RecordSheetModel.continueToLocation) {
                    Task { await model.continueFromLocationNote() }
                }
                .buttonStyle(.accentProminent)
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)
                .disabled(model.isContinuing)
                .padding(.top, 4)
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(20)
            .background(.fill.tertiary, in: .rect(cornerRadius: 12))
        }
    }
#endif

/// The recording's length, read apart from the sheet, since the recorder moves it on with every
/// buffer it captures.
private struct RecordTimer: View {
    let model: RecordSheetModel

    var body: some View {
        RecordTimerLabel(second: RecordingText.wholeSeconds(of: model.elapsedMilliseconds))
            .equatable()
    }
}

/// The timer's text, which redraws and rolls its digits only when the second it shows changes.
private struct RecordTimerLabel: View, Equatable {
    let second: Int64

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var timerSize: CGFloat = 64

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.second == rhs.second
    }

    var body: some View {
        Text(RecordingText.duration(of: second * 1000))
            #if os(macOS)
                .font(MacStyle.timer)
                .tracking(MacStyle.timerTracking)
            #else
                .font(.system(size: timerSize, weight: .light).monospacedDigit())
            #endif
            .contentTransition(reduceMotion ? .identity : .numericText(countsDown: false))
            .animation(reduceMotion ? nil : .snappy, value: second)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}

/// Stop, in the recording red with a large white label, the one thing to press while recording.
private struct StopButton: View {
    #if os(macOS)
        static let diameter = MacStyle.stopDiameter
    #else
        static let diameter = PhoneStyle.stopDiameter
    #endif

    let disabled: Bool
    let action: () -> Void

    #if os(iOS)
        @Environment(\.drawsGlass) private var drawsGlass
    #endif
    /// Grows with the label, so a large text size never cuts the word short.
    @ScaledMetric(relativeTo: .title2) private var scaledDiameter: CGFloat = StopButton.diameter

    var body: some View {
        let size = min(scaledDiameter, Self.diameter * 1.75)
        let button = Button(action: action) {
            Text(RecordSheetModel.stop)
                .font(.platform(.title2).weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(.horizontal, 8)
                .frame(width: size, height: size)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .keyboardShortcut(.defaultAction)
        // The whole button dims, so a Stop that cannot run never reads as ready.
        Group {
            #if os(macOS)
                // Glass tinted red draws gray in a sheet, so the Mac's Stop is always solid.
                button.background(Color.recordingRed, in: .circle)
            #else
                if drawsGlass {
                    button.glassEffect(.regular.tint(.recordingRed).interactive(), in: .circle)
                } else {
                    button.background(Color.recordingRed, in: .circle)
                }
            #endif
        }
        .opacity(disabled ? Self.dimmed : 1)
    }

    #if os(macOS)
        private static let dimmed = 0.4
    #else
        private static let dimmed = 0.5
    #endif
}
