/// How the recording screen sizes its waveform. The height comes from the screen alone, never
/// from what sits under the waveform, so changing mode, adding the first loop, or opening a name
/// field never moves the controls the musician is reaching for.
enum PracticeLayout {
    /// The waveform's share of the screen's height, and the limits it is held to.
    private static let regular = (share: 0.4, floor: 140.0, ceiling: 480.0)
    /// A phone on its side has little height, so the waveform takes less of it.
    private static let compact = (share: 0.3, floor: 64.0, ceiling: 110.0)

    /// The waveform's height, in points, on a screen `screenHeight` points tall.
    static func waveformHeight(screenHeight: Double, isCompactHeight: Bool) -> Double {
        let limits = isCompactHeight ? compact : regular
        return min(max(screenHeight * limits.share, limits.floor), limits.ceiling)
    }
}
