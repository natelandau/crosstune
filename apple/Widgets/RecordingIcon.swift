import CrosstunePalette
import CrosstuneRecordingActivity
import SwiftUI

/// A white waveform in a record red circle: the mark of a recording under way.
struct RecordingIcon: View {
    var diameter: CGFloat = 24

    var body: some View {
        Circle()
            .fill(Palette.record)
            .overlay {
                Image(systemName: "waveform")
                    .resizable()
                    .scaledToFit()
                    .fontWeight(.bold)
                    .padding(diameter / 4)
                    // White on record is an owner-approved exception for this icon and the
                    // status capsule: a graphic needs 3:1, which white holds on record.
                    .foregroundStyle(Palette.onAccentFill)
            }
            .frame(width: diameter, height: diameter)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(RecordingActivityText.recording)
    }
}

#Preview {
    RecordingIcon()
}
