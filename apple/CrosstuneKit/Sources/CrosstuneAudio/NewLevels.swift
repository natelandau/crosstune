/// Works out which of a recorder's levels are new since the last read.
public struct NewLevels: Sendable {
    private var seen = 0

    public init() {}

    /// Returns the levels measured since the last call. `levels` is the recorder's recent
    /// window, newest last, and `total` how many it has measured in all.
    public mutating func take(_ levels: [Float], total: Int) -> [Float] {
        // A smaller total is a new recording, whose levels are all new.
        let fresh = total < seen ? total : total - seen
        seen = total
        return Array(levels.suffix(min(fresh, levels.count)))
    }
}
