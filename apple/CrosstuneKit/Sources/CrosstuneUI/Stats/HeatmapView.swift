import CrosstuneCommands
import SwiftUI

/// The heatmap's four steps, from the lightest active day to the busiest: the web's hue,
/// darkening in light mode and lightening in dark mode. Each step is at least 3:1 against every
/// surface the grid can sit on: the grouped row and page in light (#FFFFFF down to #E5E5EA) and
/// dark (#000000 up to #3A3A3C) on iOS and macOS. The steps sit further from the page than the
/// web's `--heat-1` to `--heat-4`, whose lightest dark step fails on a grouped row.
enum HeatColor {
    static let light: [UInt32] = [0x707c93, 0x56627a, 0x3b465b, 0x1f2634]
    static let dark: [UInt32] = [0x7f8ba2, 0xa0abbf, 0xc2c9d7, 0xe4e8ef]

    private static func value(_ level: Int, dark isDark: Bool) -> UInt32 {
        let index = min(max(level, 1), light.count) - 1
        return isDark ? dark[index] : light[index]
    }

    /// `#rrggbb` for `level`'s variant.
    static func hex(_ level: Int, dark: Bool) -> String {
        let digits = String(value(level, dark: dark), radix: 16)
        return "#" + String(repeating: "0", count: 6 - digits.count) + digits
    }

    /// The fill of an active day at `level`, 1 through 4.
    static func color(_ level: Int, scheme: ColorScheme) -> Color {
        let rgb = value(level, dark: scheme == .dark)
        return Color(
            .sRGB, red: Double(rgb >> 16 & 0xff) / 255, green: Double(rgb >> 8 & 0xff) / 255,
            blue: Double(rgb & 0xff) / 255)
    }
}

/// One cell per day, a column per week from Sunday. The cells are too small to be tap targets,
/// so the grid takes the tap, the pointer, or the arrow keys itself and shows the chosen day's
/// detail under it; each active cell also carries its detail for VoiceOver.
struct HeatmapView: View {
    let heatmap: Stats.Heatmap
    let today: String

    @State private var chosen: Int?
    @State private var gridSize = CGSize.zero
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    @Environment(\.spacing) private var spacing

    private static let gap: CGFloat = 1

    private var days: [Stats.Day] { heatmap.days }
    private var columns: Int { (days.count + 6) / 7 }

    var body: some View {
        VStack(alignment: .leading, spacing: spacing(4)) {
            monthLabels
            grid
            Text(chosen.flatMap { days.indices.contains($0) ? days[$0] : nil }.map(detail) ?? StatsCopy.activityHint)
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .padding(.top, spacing(4))
                .accessibilityHidden(true)
        }
    }

    private func detail(_ day: Stats.Day) -> String {
        StatsCopy.dayDetail(day, today: today)
    }

    private var monthLabels: some View {
        HStack(spacing: Self.gap) {
            ForEach(Array(StatsCopy.weekMonthLabels(days).enumerated()), id: \.offset) { _, label in
                Color.clear
                    .frame(maxWidth: .infinity, minHeight: 0)
                    .overlay(alignment: .leading) {
                        if let label {
                            Text(label).font(.caption2).foregroundStyle(.secondary).fixedSize()
                        }
                    }
            }
        }
        .frame(height: 14)
        .accessibilityHidden(true)
    }

    private var grid: some View {
        HStack(alignment: .top, spacing: Self.gap) {
            ForEach(0..<columns, id: \.self) { column in
                VStack(spacing: Self.gap) {
                    ForEach(0..<7, id: \.self) { row in
                        cell(column * 7 + row)
                    }
                }
            }
        }
        .onGeometryChange(for: CGSize.self) {
            $0.size
        } action: {
            gridSize = $0
        }
        .contentShape(.rect)
        .gesture(SpatialTapGesture().onEnded { choose(at: $0.location) })
        .onContinuousHover { phase in
            if case .active(let location) = phase { choose(at: location) }
        }
        .focusable()
        .focused($focused)
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow, .home, .end]) { press in
            move(press.key) ? .handled : .ignored
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(StatsCopy.activityHeader)
    }

    @ViewBuilder private func cell(_ index: Int) -> some View {
        let shape = RoundedRectangle(cornerRadius: 1)
        if let day = days.indices.contains(index) ? days[index] : nil {
            Group {
                if day.level > 0 {
                    shape.fill(HeatColor.color(day.level, scheme: colorScheme))
                        .accessibilityElement()
                        .accessibilityLabel(detail(day))
                } else {
                    // An empty day is blank: a hairline ring keeps its slot without reading as a step.
                    shape.strokeBorder(.quaternary, lineWidth: 1)
                        .accessibilityHidden(true)
                }
            }
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if index == chosen { shape.stroke(.primary, lineWidth: 1) }
            }
        } else {
            Color.clear.aspectRatio(1, contentMode: .fit).accessibilityHidden(true)
        }
    }

    /// The day under `location`, read from the grid's own size, since no single cell is big
    /// enough to take a tap.
    private func choose(at location: CGPoint) {
        guard columns > 0, gridSize.width > 0, gridSize.height > 0 else { return }
        let column = Int(location.x / (gridSize.width / CGFloat(columns)))
        let row = Int(location.y / (gridSize.height / 7))
        let index = min(max(column, 0), columns - 1) * 7 + min(max(row, 0), 6)
        if days.indices.contains(index) { chosen = index }
    }

    /// Weeks are columns, so a column away is a week away and a row away is a day. The first key
    /// lands on today, the day a musician looks for first.
    private func move(_ key: KeyEquivalent) -> Bool {
        let last = days.count - 1
        guard last >= 0 else { return false }
        let step: Int? =
            switch key {
            case .leftArrow: -7
            case .rightArrow: 7
            case .upArrow: -1
            case .downArrow: 1
            default: nil
            }
        let next: Int
        if let step {
            next = chosen.map { $0 + step } ?? last
        } else if key == .home {
            next = 0
        } else {
            next = last
        }
        let index = min(last, max(0, next))
        chosen = index
        // The detail under the grid changes in place, which VoiceOver would not otherwise read.
        if voiceOverEnabled {
            // High priority cuts off the last day's detail, so held arrow keys read only the latest.
            var text = AttributedString(detail(days[index]))
            text.accessibilitySpeechAnnouncementPriority = .high
            AccessibilityNotification.Announcement(text).post()
        }
        return true
    }
}
