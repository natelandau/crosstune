import CrosstuneCommands

/// Which of a breakdown's values show: the top few, then the rest once opened.
enum StatsBreakdown {
    /// How many values show before Show all.
    static let visibleCount = 8

    static func visible(
        _ values: [Stats.Value], expanded: Bool, limit: Int = visibleCount
    ) -> (shown: [Stats.Value], hidden: Int) {
        guard !expanded, values.count > limit else { return (values, 0) }
        return (Array(values.prefix(limit)), values.count - limit)
    }
}
