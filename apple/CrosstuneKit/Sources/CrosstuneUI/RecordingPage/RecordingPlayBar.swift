import CrosstuneDesign
import SwiftUI

/// The Details tab's play bar: the play button, a scrubber, the elapsed time, and the trimmed
/// length, with no waveform. It plays the trimmed recording at the speed and pitch its practice
/// holds, and loads it when the player holds another. While the plan holds recordings back it
/// is disabled, with Subscribe to play in its place opening the Plan sheet; while the recording
/// cannot load or play, Play is off and the reason shows under the bar.
struct RecordingPlayBar: View {
    /// The recording's practice, nil while the plan holds recordings back or until it is made.
    let practice: PracticeModel?
    /// The trimmed length the row reads, for a bar with no practice to ask.
    let lengthMs: Int64?
    /// Why the plan holds the bar back, nil while it lets recordings play.
    let blockedReason: String?
    /// Why the recording cannot load or play now, nil while it can.
    let unavailableReason: String?
    /// Subscribe to play: opens the Plan sheet.
    let onBlocked: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 12) { bar }
                .frame(minHeight: PageStyle.minTarget)
            if blockedReason == nil, let unavailableReason {
                Text(unavailableReason)
                    .font(PageStyle.secondary)
                    .foregroundStyle(.textSecondary)
            }
        }
        .font(PageStyle.body)
    }

    /// What the bar and the practice area show.
    enum Shown: Equatable {
        case controls
        /// The plan's lock, with why it holds recordings back.
        case blocked(String)
        /// Nothing yet: the practice is still being made, as while the shell's commands arrive.
        case waiting
    }

    static func shown(hasPractice: Bool, blockedReason: String?) -> Shown {
        if let blockedReason { return .blocked(blockedReason) }
        return hasPractice ? .controls : .waiting
    }

    /// Whether the Details tab carries the list controls: while the page's recording is the
    /// loaded one. The row draws only while a list plays.
    static func showsListControls(isCurrent: Bool) -> Bool { isCurrent }

    @ViewBuilder private var bar: some View {
        switch Self.shown(hasPractice: practice != nil, blockedReason: blockedReason) {
        case .controls:
            if let practice {
                PlayBarControls(
                    practice: practice, canPlay: Self.canPlay(practice, unavailableReason: unavailableReason))
            }
        case .blocked(let reason):
            Button(action: onBlocked) {
                Label(reason, systemImage: "lock.fill")
            }
            #if os(macOS)
                .buttonStyle(.mac(.quiet))
            #endif
            Spacer(minLength: 0)
            length
        case .waiting:
            Spacer(minLength: 0)
            length
        }
    }

    @ViewBuilder private var length: some View {
        if let length = RecordingText.duration(milliseconds: lengthMs) {
            Text(length)
                .monospacedDigit()
                .foregroundStyle(.textSecondary)
        }
    }

    /// Whether Play can be pressed: nothing stops the recording loading, and the loaded one's
    /// audio is ready.
    static func canPlay(_ practice: PracticeModel, unavailableReason: String?) -> Bool {
        unavailableReason == nil && practice.isLoaded
    }
}

/// The bar's play button, scrubber, and times, all read from the practice model, so they show
/// live playback while the player holds the recording and the model's own playhead otherwise.
private struct PlayBarControls: View {
    let practice: PracticeModel
    let canPlay: Bool

    /// Where a drag on the scrubber has the playhead until it lets go, in milliseconds.
    @State private var dragged: Double?

    var body: some View {
        let length = Double(max(practice.lengthMs, 1))
        let shown = dragged ?? min(practice.positionMs, length)
        let playLabel = PlayButtonLabel(isPlaying: practice.isPlaying, repeating: nil)
        Button(playLabel.label, systemImage: playLabel.systemImage) {
            practice.togglePlay()
        }
        .labelStyle(PlayIconLabelStyle())
        .font(.platform(.title2))
        .contentTransition(.symbolEffect(.replace))
        .buttonStyle(.plain)
        .help(playLabel.label)
        .disabled(!canPlay)
        Text(RecordingText.duration(of: Int64(shown)))
            .monospacedDigit()
            .foregroundStyle(.textSecondary)
        Slider(
            value: Binding {
                shown
            } set: {
                dragged = $0
            },
            in: 0...length,
            onEditingChanged: { editing in
                guard !editing, let dragged else { return }
                practice.seek(toMs: Int64(dragged.rounded()))
                self.dragged = nil
            }
        )
        .accessibilityLabel(RecordingPageCopy.playhead)
        .accessibilityValue(PracticeText.position(Int64(shown), of: practice.lengthMs))
        .disabled(!canPlay || practice.lengthMs == 0)
        Text(RecordingText.duration(of: practice.lengthMs))
            .monospacedDigit()
            .foregroundStyle(.textSecondary)
    }
}

/// The play button's icon alone, as `.iconOnly` shows it with the title as its spoken name,
/// taking presses across the page's minimum target. The target is on the icon, since a plain
/// button takes presses only on its label.
private struct PlayIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        Label {
            configuration.title
        } icon: {
            configuration.icon
                .frame(minWidth: PageStyle.minTarget, minHeight: PageStyle.minTarget)
                .contentShape(.rect)
        }
        .labelStyle(.iconOnly)
    }
}
