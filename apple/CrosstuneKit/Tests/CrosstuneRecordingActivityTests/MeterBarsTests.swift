import Testing

@testable import CrosstuneRecordingActivity

@Test(
    arguments: [
        ([], Array(repeating: 0, count: 10)),
        (Array(repeating: 0, count: 60), Array(repeating: 0, count: 10)),
        (Array(repeating: 1, count: 60), Array(repeating: 8, count: 10)),
        // Each bar is the peak of its slice, rounded up so any sound shows.
        (Array(repeating: 0, count: 54) + [0.01] + Array(repeating: 0, count: 5), Array(repeating: 0, count: 9) + [1]),
        // Fewer levels than bars: the levels fill the newest bars, older bars stay flat.
        // Levels get the in-app waveform's gain, since playing at arm's length sits well under full scale.
        ([0.1, 0.2], Array(repeating: 0, count: 8) + [2, 4]),
        ([0.4, 1], Array(repeating: 0, count: 8) + [8, 8]),
        // Values outside 0 to 1 clamp.
        (Array(repeating: 2, count: 20), Array(repeating: 8, count: 10)),
        // A level that is not a number counts as silence, and never hides a louder level in its slice.
        ([.nan], Array(repeating: 0, count: 10)),
        ([.nan] + Array(repeating: 1, count: 59), Array(repeating: 8, count: 10)),
    ] as [([Float], [UInt8])])
func reducesLevelsToBars(levels: [Float], expected: [UInt8]) {
    #expect(MeterBars.reduce(levels) == expected)
}
