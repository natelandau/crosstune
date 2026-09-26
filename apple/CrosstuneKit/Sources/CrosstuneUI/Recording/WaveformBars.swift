import CoreGraphics

/// The levels behind the live waveform and where each bar goes. Scrolling keeps the newest
/// level at the right edge; fixed keeps one slot per bar and overwrites them in turn, so the
/// level shows without horizontal travel, as Reduce Motion asks.
struct WaveformBars: Equatable, Sendable {
    enum Mode: Equatable, Sendable {
        case scrolling
        case fixed
    }

    static let barWidth: CGFloat = 3
    static let barGap: CGFloat = 2
    static let step = barWidth + barGap
    /// A silent bar still shows, so the waveform reads as listening rather than empty.
    static let minimumBar: CGFloat = 2
    /// Speech and a violin at arm's length sit well under full scale, so levels are lifted to
    /// fill the height.
    static let gain: CGFloat = 2.5

    let mode: Mode
    private(set) var levels: [Float] = []
    /// The fixed slot the next level is written to.
    private(set) var cursor = 0

    init(mode: Mode) {
        self.mode = mode
    }

    /// How many bars fit across `width`.
    static func count(forWidth width: CGFloat) -> Int {
        max(0, Int((width / step).rounded(.up)))
    }

    mutating func push(_ level: Float, capacity: Int) {
        guard capacity > 0 else { return }
        switch mode {
        case .scrolling:
            levels.append(level)
            if levels.count > capacity { levels.removeFirst(levels.count - capacity) }
        case .fixed:
            // A resize changes the slot count; keep what still fits and restart the cursor inside it.
            if levels.count != capacity {
                levels = (0..<capacity).map { $0 < levels.count ? levels[$0] : 0 }
                cursor %= capacity
            }
            levels[cursor] = level
            cursor = (cursor + 1) % capacity
        }
    }

    /// Each bar's rectangle in a canvas `width` by `height`, centered vertically.
    func layout(width: CGFloat, height: CGFloat) -> [CGRect] {
        let count = levels.count
        return levels.enumerated().map { index, level in
            let bar = min(height, max(Self.minimumBar, CGFloat(level) * height * Self.gain))
            let x =
                switch mode {
                case .scrolling: width - CGFloat(count - index) * Self.step
                case .fixed: CGFloat(index) * Self.step
                }
            return CGRect(x: x, y: (height - bar) / 2, width: Self.barWidth, height: bar)
        }
    }
}
