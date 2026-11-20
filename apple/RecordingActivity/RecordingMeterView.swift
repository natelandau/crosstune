import CrosstunePalette
import CrosstuneRecordingActivity
import SwiftUI

/// The recent input levels as a row of bars across the full width, oldest first. A silent bar
/// keeps a short pill, so a flat meter still shows where the meter is.
struct RecordingMeterView: View {
    let bars: [UInt8]

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            let count = CGFloat(MeterBars.count)
            let spacing = proxy.size.width / (count * 3)
            let barWidth = (proxy.size.width - spacing * (count - 1)) / count
            HStack(alignment: .center, spacing: spacing) {
                ForEach(bars.indices, id: \.self) { index in
                    let barHeight = height(of: bars[index], in: proxy.size.height)
                    RoundedRectangle(cornerRadius: min(barWidth, barHeight) / 2)
                        .fill(Palette.record)
                        .frame(width: barWidth, height: barHeight)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .animation(reduceMotion ? nil : .smooth, value: bars)
        // The status text and the time carry what the meter shows.
        .accessibilityHidden(true)
    }

    /// The levels share the height above the silent pill, so the lowest level always draws
    /// taller than silence.
    private func height(of bar: UInt8, in maxHeight: CGFloat) -> CGFloat {
        let steps = CGFloat(MeterBars.steps)
        let silent = min(2, maxHeight / (steps + 1))
        return silent + (maxHeight - silent) * CGFloat(min(bar, MeterBars.steps)) / steps
    }
}
