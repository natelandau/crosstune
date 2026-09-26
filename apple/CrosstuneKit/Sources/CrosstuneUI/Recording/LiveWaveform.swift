import CrosstuneAudio
import Foundation
import SwiftUI

/// Feeds a recorder's levels onto the bars at the rate they were measured. Levels arrive a
/// buffer's worth at a time; drawing them one frame at a time lets the waveform glide rather
/// than jump by each buffer.
final class WaveformFeed {
    static let rate = Double(InputLevels.perSecond)
    /// The most levels left waiting, a quarter second, so the bars never trail the sound.
    static let maximumQueued = InputLevels.perSecond / 4

    private(set) var bars: WaveformBars
    private var queue: [Float] = []
    private var seen = 0
    /// The moment the bars are drawn up to; nil until the first frame.
    private var drawnTo: TimeInterval?

    init(mode: WaveformBars.Mode) {
        bars = WaveformBars(mode: mode)
    }

    /// Takes the levels a recorder has measured since the last call. `levels` is its recent
    /// window, newest last, and `total` how many it has measured in all.
    func receive(_ levels: [Float], total: Int) {
        // A smaller total is a new take, whose levels are all new.
        let fresh = total < seen ? total : total - seen
        seen = total
        queue.append(contentsOf: levels.suffix(min(fresh, levels.count)))
    }

    /// Draws the levels due by `time` onto `capacity` bars.
    func advance(to time: TimeInterval, capacity: Int) {
        let behind = queue.count - Self.maximumQueued
        if behind > 0 { push(behind, capacity: capacity) }
        guard let drawnTo else {
            drawnTo = time
            return
        }
        // Rounded, since display frames land a hair either side of a level's slot.
        let due = Int(((time - drawnTo) * Self.rate).rounded())
        push(min(due, queue.count), capacity: capacity)
        // With nothing waiting there is nothing to catch up on, so the time does not bank.
        self.drawnTo = queue.isEmpty ? time : drawnTo + Double(due) / Self.rate
    }

    private func push(_ count: Int, capacity: Int) {
        guard count > 0 else { return }
        for level in queue.prefix(count) { bars.push(level, capacity: capacity) }
        queue.removeFirst(count)
    }
}

/// The live level waveform of a recording: bars that scroll in from the right, or under Reduce
/// Motion stay in place and change height. It holds still while `paused`.
struct LiveWaveform: View {
    static let height: CGFloat = 128

    let levels: [Float]
    let levelCount: Int
    let paused: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scrolling = WaveformFeed(mode: .scrolling)
    @State private var fixed = WaveformFeed(mode: .fixed)

    var body: some View {
        let feed = reduceMotion ? fixed : scrolling
        let levels = levels
        let levelCount = levelCount
        TimelineView(.animation(paused: paused)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            Canvas { context, size in
                feed.receive(levels, total: levelCount)
                feed.advance(to: time, capacity: WaveformBars.count(forWidth: size.width))
                for bar in feed.bars.layout(width: size.width, height: size.height) {
                    context.fill(
                        Path(roundedRect: bar, cornerRadius: WaveformBars.barWidth / 2), with: .style(.tint))
                }
            }
        }
        .frame(height: Self.height)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }
}
