import CrosstuneAudio
import CrosstuneDesign
import CrosstuneVocabulary
import SwiftUI

/// Solo or mute of a stereo range and a frequency range of the recording: Solo or Mute and Reset,
/// then each range under its name and readout. A mono recording shows a notice in place of the
/// stereo range, since its stereo picture has nothing to pick from. Each change goes to
/// `onChange` at once.
struct IsolatePanel: View {
    let value: IsolateSetting
    /// Nil until the recording is measured, which shows the stereo range.
    let isMono: Bool?
    /// False where the device could not make the isolate unit, which leaves only a line saying so.
    var isAvailable = true
    /// Reads the audio's outline.
    let outline: () -> IsolateOutline?
    /// Whether the outlines follow the audio now; otherwise they hold their last levels.
    let isLive: Bool
    let onChange: (IsolateSetting) -> Void

    @State private var outlineReader = IsolateOutlineReader()

    static let stereoBounds = IsolateRangeBounds(
        min: Vocabulary.Ranges.Recording.isolatePanStart.lowerBound,
        max: Vocabulary.Ranges.Recording.isolatePanEnd.upperBound, scale: .linear, minSpan: 10)
    static let stereoSteps = IsolateRangeSteps(step: 5, largeStep: 20)
    /// A third of an octave at the shortest.
    static let frequencyBounds = IsolateRangeBounds(
        min: Vocabulary.Ranges.Recording.isolateLowHz.lowerBound,
        max: Vocabulary.Ranges.Recording.isolateHighHz.upperBound, scale: .log, minSpan: 1.0 / 3)
    /// A semitone, and an octave.
    static let frequencySteps = IsolateRangeSteps(step: 1.0 / 12, largeStep: 1)
    private static let effects: [Vocabulary.IsolateEffect] = [.solo, .mute]

    /// Until the recording is measured, the stereo range shows.
    var showsMonoNotice: Bool { isMono == true }

    private static func effectName(_ effect: Vocabulary.IsolateEffect) -> String {
        effect == .mute ? RecordingScreenText.mute : RecordingScreenText.solo
    }

    var body: some View {
        if !isAvailable {
            Text(RecordingScreenText.isolateUnavailable)
                #if os(macOS)
                    .font(MacStyle.secondary)
                    .foregroundStyle(Palette.textSecondary)
                #else
                    .font(.platform(.subheadline))
                    .foregroundStyle(.textSecondary)
                #endif
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            #if os(macOS)
                macBody
            #else
                touchBody
            #endif
        }
    }

    #if os(macOS)
        /// Solo or Mute and Reset, then each range under a label line of its name and readout, so
        /// the range spans the popover's full width.
        private var macBody: some View {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    MacSegmented(
                        selection: Binding {
                            value.effect
                        } set: {
                            choose(effect: $0)
                        }, options: Self.effects,
                        label: Self.effectName, title: RecordingScreenText.isolateEffect)
                    Spacer(minLength: 0)
                    reset.controlSize(.small)
                }
                .frame(minHeight: PracticeLayout.target)
                if showsMonoNotice {
                    Text(RecordingScreenText.monoNotice)
                        .font(MacStyle.secondary)
                        .foregroundStyle(Palette.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: PracticeLayout.target, alignment: .leading)
                } else {
                    macRangeRow(RecordingScreenText.stereo, range: stereoRange, readout: stereoReadout)
                }
                macRangeRow(RecordingScreenText.frequency, range: frequencyRange, readout: frequencyReadout)
            }
        }

        private func macRangeRow(_ name: String, range: some View, readout: String) -> some View {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(name)
                        .font(MacStyle.label)
                        .foregroundStyle(Palette.textSecondary)
                    Spacer(minLength: 8)
                    Text(readout)
                        .lineLimit(1)
                        .font(MacStyle.body)
                        .monospacedDigit()
                        .foregroundStyle(Palette.textPrimary)
                }
                .accessibilityHidden(true)
                range
                    .frame(maxWidth: .infinity)
            }
        }
    #endif

    #if !os(macOS)
        private var touchBody: some View {
            VStack(spacing: 2) {
                HStack(spacing: 12) {
                    Picker(
                        RecordingScreenText.isolateEffect,
                        selection: Binding {
                            value.effect
                        } set: {
                            choose(effect: $0)
                        }
                    ) {
                        ForEach(Self.effects, id: \.self) { effect in
                            Text(Self.effectName(effect)).tag(effect)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    reset
                }
                if showsMonoNotice {
                    Text(RecordingScreenText.monoNotice)
                        .font(.platform(.subheadline))
                        .foregroundStyle(.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    touchRangeRow(RecordingScreenText.stereo, range: stereoRange, readout: stereoReadout)
                }
                touchRangeRow(RecordingScreenText.frequency, range: frequencyRange, readout: frequencyReadout)
            }
        }

        private func touchRangeRow(_ name: String, range: some View, readout: String) -> some View {
            VStack(spacing: 0) {
                HStack {
                    Text(name)
                    Spacer()
                    Text(readout)
                        .monospacedDigit()
                }
                .font(.platform(.subheadline))
                .accessibilityElement(children: .combine)
                range
            }
        }
    #endif

    private var reset: some View {
        Button(RecordingScreenText.reset) { onChange(.standard) }
            .buttonStyle(.text(oneLine: true))
            .disabled(value.effective(isMono: isMono == true).isDefault)
    }

    private var stereoReadout: String { IsolateReadout.stereo(start: value.panStart, end: value.panEnd) }
    private var frequencyReadout: String { IsolateReadout.frequency(low: value.lowHz, high: value.highHz) }

    private var stereoRange: some View {
        IsolateRange(
            label: RecordingScreenText.stereo, startLabel: RecordingScreenText.stereoStart,
            endLabel: RecordingScreenText.stereoEnd, bounds: Self.stereoBounds, steps: Self.stereoSteps,
            start: value.panStart, end: value.panEnd, valueText: IsolateReadout.stereoEdge,
            outline: { readOutline(at: $0)?.pan },
            isLive: isLive, largeStepUp: RecordingScreenText.stereoRightLarge,
            largeStepDown: RecordingScreenText.stereoLeftLarge,
            onChange: { start, end in
                var next = value
                next.panStart = start
                next.panEnd = end
                onChange(next)
            })
    }

    private var frequencyRange: some View {
        IsolateRange(
            label: RecordingScreenText.frequency, startLabel: RecordingScreenText.frequencyLow,
            endLabel: RecordingScreenText.frequencyHigh, bounds: Self.frequencyBounds,
            steps: Self.frequencySteps, start: value.lowHz, end: value.highHz, valueText: IsolateReadout.hz,
            outline: { readOutline(at: $0)?.freq },
            isLive: isLive, largeStepUp: RecordingScreenText.frequencyUpLarge,
            largeStepDown: RecordingScreenText.frequencyDownLarge,
            onChange: { low, high in
                var next = value
                next.lowHz = low
                next.highHz = high
                onChange(next)
            })
    }

    private func readOutline(at date: Date) -> IsolateOutline? {
        outlineReader.outline(at: date, isLive: isLive, outline)
    }

    private func choose(effect: Vocabulary.IsolateEffect) {
        guard effect != value.effect else { return }
        var next = value
        next.effect = effect
        onChange(next)
    }
}

/// The audio's outline, read at most once per tick while live so every range drawing that tick
/// shares one read.
@MainActor
final class IsolateOutlineReader {
    private var last: (date: Date, outline: IsolateOutline?)?

    func outline(at date: Date, isLive: Bool, _ read: () -> IsolateOutline?) -> IsolateOutline? {
        // Paused, the timeline keeps its last date, so a cached read could go stale.
        guard isLive else { return read() }
        if let last, last.date == date { return last.outline }
        let outline = read()
        last = (date, outline)
        return outline
    }
}

/// The Isolate panel on the practice view's recording, whose outlines follow the audio while
/// the panel shows and the loaded recording plays. A recording the player does not hold has no
/// outline to show.
struct LiveIsolatePanel: View {
    let model: PracticeModel
    @Environment(\.isToolShown) private var shown

    var body: some View {
        let audio = model.player.audio
        let live = model.isCurrent
        IsolatePanel(
            value: model.isolate, isMono: model.isMono, isAvailable: audio.isolateAvailable,
            outline: { shown && live ? audio.isolateOutline : nil },
            isLive: shown && model.isPlaying, onChange: model.setIsolate)
    }
}
