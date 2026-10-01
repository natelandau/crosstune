import CrosstuneVocabulary
import SwiftUI

/// Speed and pitch as compact rows: each value between a step down and a step up. Tapping the
/// value opens the setting's full panel in place of the steps.
struct PracticeSteppers: View {
    let player: PlayerModel

    @Environment(\.spacing) private var spacing
    @Environment(\.colorScheme) private var colorScheme
    @State private var open: PlaybackSetting?

    private static let pitchStepCents = 100

    var body: some View {
        let speed = player.speedPercent
        let pitch = player.pitchCents
        let speedRange = Vocabulary.Ranges.Recording.speedPercent
        let pitchRange = Vocabulary.Ranges.Recording.pitchCents
        VStack(spacing: spacing.stackGap) {
            row(
                .speed, label: RecordingScreenText.speed, value: RecordingScreenText.speedBadge(speed),
                less: (RecordingScreenText.slower, speed <= speedRange.lowerBound),
                more: (RecordingScreenText.faster, speed >= speedRange.upperBound)
            ) { by in
                player.setSpeed(SpeedPanel.stepped(speed, by: by * SpeedPanel.step))
            }
            if open == .speed {
                SpeedPanel(value: speed, onChange: player.setSpeed)
            }
            row(
                .pitch, label: RecordingScreenText.pitch,
                value: pitch == 0 ? "0" : RecordingScreenText.pitchBadge(pitch),
                less: (RecordingScreenText.pitchDown, pitch <= pitchRange.lowerBound),
                more: (RecordingScreenText.pitchUp, pitch >= pitchRange.upperBound)
            ) { by in
                player.setPitch(
                    min(max(pitch + by * Self.pitchStepCents, pitchRange.lowerBound), pitchRange.upperBound))
            }
            if open == .pitch {
                PitchPanel(value: pitch, onChange: player.setPitch)
            }
        }
    }

    private func row(
        _ setting: PlaybackSetting, label: String, value: String, less: (name: String, disabled: Bool),
        more: (name: String, disabled: Bool), onStep: @escaping (Int) -> Void
    ) -> some View {
        let expanded = open == setting
        return HStack(spacing: spacing(12)) {
            Button {
                open = expanded ? nil : setting
            } label: {
                HStack {
                    Text(label).font(.subheadline)
                    Spacer()
                    Text(value).font(.headline).monospacedDigit()
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(neutralFill(colorScheme), in: .rect(cornerRadius: 12))
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(expanded ? .isSelected : [])
            if !expanded {
                PanelStepButton(name: less.name, systemImage: "minus") { onStep(-1) }
                    .disabled(less.disabled)
                PanelStepButton(name: more.name, systemImage: "plus") { onStep(1) }
                    .disabled(more.disabled)
            }
        }
    }
}
