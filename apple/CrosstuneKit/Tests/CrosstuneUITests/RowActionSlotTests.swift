#if os(macOS)
    import AppKit
    import CrosstuneStore
    import CrosstuneTestSupport
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor
    struct RowActionSlotTests {
        @Test func slotAndGlyphStopGrowingTogether() {
            let base = RowSlotMetrics.baseWidth
            let cap = base * RowSlotMetrics.maxGrowth
            #expect(RowSlotMetrics.cappedWidth(scaled: base, base: base) == base)
            #expect(RowSlotMetrics.cappedWidth(scaled: base * 1.2, base: base) == base * 1.2)
            #expect(RowSlotMetrics.cappedWidth(scaled: base * 3, base: base) == cap)
            let atBase = RowSlotMetrics.glyphSize(scaledWidth: base, baseWidth: base, baseGlyph: 24)
            let atCap = RowSlotMetrics.glyphSize(scaledWidth: base * 3, baseWidth: base, baseGlyph: 24)
            #expect(atBase == 24)
            #expect(atCap == 24 * RowSlotMetrics.maxGrowth)
            #expect(atCap / cap == atBase / base)
        }

        @Test func progressRingTurnsWithTheClockAndHoldsStillUnderReduceMotion() {
            let start = Date(timeIntervalSinceReferenceDate: 1_000)
            let quarter = start.addingTimeInterval(RowProgressRing.turnDuration / 4)
            #expect(RowProgressRing.angle(at: start, reduceMotion: false) == 0)
            #expect(abs(RowProgressRing.angle(at: quarter, reduceMotion: false) - 90) < 0.001)
            #expect(RowProgressRing.angle(at: quarter, reduceMotion: true) == 0)
        }

        @Test func actionSlotAddsNoHeightToARow() {
            let tune = Tune(createdAt: noon, title: "Soldier's Joy", key: "D")
            let userTune = UserTune(createdAt: noon, tuneID: tune.id, status: "learning")
            let row = TuneRow(tune: tune, userTune: userTune, instruments: [], stacked: true)
            let button = ListRowPlayButton(
                entry: bareListEntry(tune: tune, userTune: userTune), action: .play(sampleRecordingItem()),
                listID: "l1")
            let withSlot = HStack {
                row
                button
            }
            #expect(hostedSize(withSlot, width: 375).height == hostedSize(row, width: 375).height)
        }
    }
#endif
