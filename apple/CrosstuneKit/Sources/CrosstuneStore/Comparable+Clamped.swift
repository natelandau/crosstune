extension Comparable {
    /// The value held between `min` and `max`. When `min` is above `max`, `max` wins.
    public func clamped(min low: Self, max high: Self) -> Self {
        Swift.min(Swift.max(self, low), high)
    }
}
