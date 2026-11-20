/// The level meter as a few whole-number bars, small enough to send in a Live Activity update.
public enum MeterBars {
    public static let count = 10
    public static let steps: UInt8 = 8

    /// Reduces levels from 0 to 1, oldest first, to `count` bars with the newest at the end. Each
    /// bar is the peak of its slice of the levels.
    public static func reduce(_ levels: [Float]) -> [UInt8] {
        guard levels.count > count else {
            return Array(repeating: 0, count: count - levels.count) + levels.map(bar)
        }
        return (0..<count).map { index in
            let slice = levels[(index * levels.count / count)..<((index + 1) * levels.count / count)]
            return bar(slice.lazy.filter { !$0.isNaN }.max() ?? 0)
        }
    }

    /// Rounds up so any sound shows as at least one step.
    private static func bar(_ level: Float) -> UInt8 {
        guard !level.isNaN else { return 0 }
        let clamped = min(max(level, 0), 1)
        return min(steps, UInt8((clamped * Float(steps)).rounded(.up)))
    }
}
