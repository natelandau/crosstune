import CrosstuneDesign
import CrosstuneVocabulary
import SwiftUI

/// Playback speed with the pitch held: a slider in steps of 5% read from a stepper, Reset, and
/// presets. Each change goes to `onChange` at once.
struct SpeedPanel: View {
    let value: Int
    let onChange: (Int) -> Void

    static let step = 5
    static let presets = [50, 75, 100]
    private static let range = Vocabulary.Ranges.Recording.speedPercent

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ValueSlider(
                RecordingScreenText.speed,
                value: Binding {
                    value
                } set: {
                    if let speed = Self.moved(from: value, to: $0) { onChange(speed) }
                },
                // The Mac draws the panel in a popover headed "Speed", so the slider does not
                // repeat it.
                in: Self.range, step: Self.step, defaultValue: 100, showsTitle: false,
                format: RecordingScreenText.speedBadge)
            presets
        }
    }

    #if os(macOS)
        private var presets: some View {
            MacSegmented(
                selection: Binding<Int?> {
                    Self.presets.contains(value) ? value : nil
                } set: {
                    if let preset = $0 { onChange(preset) }
                },
                options: Self.presets.map(Optional.some),
                label: { RecordingScreenText.speedBadge($0 ?? 100) },
                title: RecordingScreenText.speedPresets)
        }
    #else
        private var presets: some View {
            SpeedPresetRow(value: value, onChange: onChange)
        }
    #endif

    /// The speed a step or drag from `percent` to `next` sets, or nil when it sets none. A speed
    /// off the 5% grid steps onto it rather than keeping its offset.
    static func moved(from percent: Int, to next: Int) -> Int? {
        next == percent ? nil : stepped(percent, by: next - percent)
    }

    /// `percent` moved by `delta` and clamped to the range. A speed off the 5% grid lands on
    /// the nearest grid step in the direction of travel, so the first step from 72% is 70% or
    /// 75%, never 65%.
    static func stepped(_ percent: Int, by delta: Int) -> Int {
        let moved = Double(percent + delta) / Double(step)
        let snapped = Int(delta < 0 ? moved.rounded(.up) : moved.rounded(.down)) * step
        return clamped(snapped)
    }

    private static func clamped(_ percent: Int) -> Int {
        min(max(percent, range.lowerBound), range.upperBound)
    }
}

/// The iOS presets, wrapping at larger text sizes so no capsule is squeezed and no label breaks
/// inside itself. Compiles on every platform so a snapshot can draw it.
struct SpeedPresetRow: View {
    let value: Int
    let onChange: (Int) -> Void

    @Environment(\.spacing) private var spacing

    var body: some View {
        FlowLayout(spacing: spacing.chipGap, lineSpacing: spacing(12)) {
            ForEach(SpeedPanel.presets, id: \.self) { preset in
                Chip(.choice(isChosen: value == preset)) {
                    onChange(preset)
                } label: {
                    Text(RecordingScreenText.speedBadge(preset)).monospacedDigit()
                }
            }
        }
        // A wrapped row is as wide as its longest line; without this the parent centers it.
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
