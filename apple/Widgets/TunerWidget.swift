import CrosstunePalette
import CrosstuneWidgetData
import CrosstuneWidgetIntents
import SwiftUI
import WidgetKit

/// A link into the app's tuner, in the tuner screen's own colors. It shows no reading.
struct TunerWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.tuner.rawValue, provider: SummaryProvider(reloadsAtMidnight: false)) {
            entry in
            SummaryContent(current: entry.current) { summary in
                TunerWidgetView(referenceLabel: summary.tunerReferenceLabel)
            }
        }
        .configurationDisplayName(TunerLabels.title)
        .supportedFamilies([.systemSmall, .accessoryCircular])
        // A removable background gives way to the system's gray on a dark home screen, and the
        // widget keeps the tuner screen's colors in every appearance.
        .containerBackgroundRemovable(false)
    }
}

private struct TunerWidgetView: View {
    /// The reference pitch, set only when it is not the standard one, so a forgotten setting shows.
    let referenceLabel: String?

    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(intent: OpenTunerIntent()) {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .containerBackground(for: .widget) {
            if family == .accessoryCircular {
                AccessoryWidgetBackground()
            } else {
                Palette.tunerBackground(colorScheme)
            }
        }
    }

    @ViewBuilder private var content: some View {
        if family == .accessoryCircular {
            VStack(spacing: 2) {
                Image(systemName: TunerLabels.systemImage)
                    .font(.title3)
                    .accessibilityHidden(true)
                Text(TunerLabels.title)
                    .font(.caption)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity)
        } else {
            VStack(alignment: .leading) {
                Image(systemName: TunerLabels.systemImage)
                    .font(.title)
                    .foregroundStyle(Palette.onTuner)
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
                Text(TunerLabels.title)
                    .font(.headline.bold())
                    .foregroundStyle(Palette.onTuner)
                Text(referenceLabel ?? TunerLabels.listening)
                    .font(.footnote)
                    .foregroundStyle(Palette.onTunerSecondary)
            }
        }
    }
}

#Preview("Small", as: .systemSmall) {
    TunerWidget()
} timeline: {
    WidgetEntry(date: .now, current: .available(.preview(referenceLabel: nil)))
    WidgetEntry(date: .now, current: .available(.preview(referenceLabel: "A4 = 442 Hz")))
}

#Preview("Lock screen circle", as: .accessoryCircular) {
    TunerWidget()
} timeline: {
    WidgetEntry(date: .now, current: .available(.preview(referenceLabel: nil)))
}
