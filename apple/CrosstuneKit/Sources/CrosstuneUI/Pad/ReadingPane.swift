import CrosstuneStore
import SwiftUI

extension ReadingChoice {
    var label: String {
        switch self {
        case .scans: StandText.scans
        case .lyrics: StandText.lyrics
        }
    }
}

/// The playing tune's scans and lyrics on the practice ground: the scans on their own paper, a
/// page at a time, or the lyrics at the reader's size. A tune with both opens on its scans, with
/// a control to turn to the lyrics.
struct ReadingPane: View {
    let reading: StandReading

    @State private var choice = ReadingChoice.scans

    init(reading: StandReading) {
        self.reading = reading
    }

    var body: some View {
        let segments = ReadingChoice.segments(reading)
        VStack(spacing: 12) {
            if !segments.isEmpty {
                Picker(StandText.reading, selection: $choice) {
                    ForEach(segments, id: \.self) { choice in
                        Text(choice.label).tag(choice)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .controlSize(.large)
                .fixedSize()
            }
            switch shown(segments) {
            case .scans:
                ReadingScans(tuneID: reading.tuneID, scans: reading.scans)
            case .lyrics:
                ReadingLyrics(lyrics: reading.lyrics ?? "")
            }
        }
        .padding(16)
    }

    /// The control's choice while it shows, else whichever kind the tune has.
    private func shown(_ segments: [ReadingChoice]) -> ReadingChoice {
        guard segments.isEmpty else { return choice }
        return reading.scans.isEmpty ? .lyrics : .scans
    }
}

/// The tune's scans a page at a time, each fitted to the pane, zoomed by a pinch or a double tap.
/// A tap opens the full-window viewer on that scan.
private struct ReadingScans: View {
    let tuneID: String
    let scans: [Scan]

    @Environment(\.store) private var store
    @Environment(\.tuneScreenActions) private var actions
    @State private var shown: String?
    @State private var scale = ScanZoom.fit

    var body: some View {
        let ids = scans.map(\.id)
        let shownIndex = shown.flatMap { ids.firstIndex(of: $0) } ?? 0
        VStack(spacing: 8) {
            if let store {
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 0) {
                        ForEach(Array(scans.enumerated()), id: \.element.id) { index, scan in
                            ScanSlide(
                                scan: scan, index: index, folder: store.scansFolder, invert: false,
                                // Only the scans beside the one shown hold their image.
                                isNear: abs(index - shownIndex) <= 1,
                                scale: scan.id == shown ? $scale : .constant(ScanZoom.fit),
                                onBroken: {},
                                // The full viewer, a tap away, confirms a delete.
                                onDelete: nil,
                                // The API names no practice origin, so a view from here counts as
                                // the tune's.
                                onTap: { actions.viewScans?(tuneID, index, .tune) }
                            )
                            .containerRelativeFrame([.horizontal, .vertical])
                            .id(scan.id)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.paging)
                .scrollPosition(id: $shown)
                .scrollIndicators(.never)
                // A zoomed scan pans under the finger rather than turning to the next.
                .scrollDisabled(scale > ScanZoom.fit)
                .onChange(of: shown) { scale = ScanZoom.fit }
            }
            if scans.count > 1 {
                Text(ScanPager.indicator(shown: shown, ids: ids))
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    // The scan above is what needs the room at the largest text sizes.
                    .dynamicTypeSize(...DynamicTypeSize.accessibility1)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(ScanCopy.scans)
        // The scroll position stays nil until a scroll, and only the shown scan zooms, so the
        // first scan is shown from the start, and again when the scans change under it.
        .onChange(of: scans.map(\.id), initial: true) { _, ids in
            if shown.map(ids.contains) != true {
                shown = ScanPager.initialScan(ids: ids, startIndex: 0)
            }
        }
    }
}

/// The tune's lyrics on the ground at the size the musician keeps for the lyrics reader.
private struct ReadingLyrics: View {
    let lyrics: String

    var body: some View {
        ScrollView {
            LyricsBody(lyrics: lyrics)
                .frame(maxWidth: PhoneStyle.lyricsMaxWidth, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
        }
        .scrollBounceBehavior(.basedOnSize)
    }
}
