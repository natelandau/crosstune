/// One comparison the recorded total can read as.
public struct EquivalenceEntry: Sendable {
    public let id: Stats.EquivalenceID
    /// The length of one unit. Nil for `tune`, whose unit is the musician's own recordings.
    public let unitMs: Int?
    public let minMs: Int
    public let maxMs: Int
}

/// Curated comparisons for the recorded total, in pick order. The web module keeps the same list.
public let equivalences: [EquivalenceEntry] = [
    EquivalenceEntry(id: .tune, unitMs: nil, minMs: 60_000, maxMs: .max),
    EquivalenceEntry(id: .lpSide, unitMs: 1_320_000, minMs: 1_320_000, maxMs: 21_600_000),
    EquivalenceEntry(id: .bostonDublin, unitMs: 23_400_000, minMs: 23_400_000, maxMs: 360_000_000),
    EquivalenceEntry(id: .workWeek, unitMs: 144_000_000, minMs: 144_000_000, maxMs: .max),
    EquivalenceEntry(id: .crossCountry, unitMs: 147_600_000, minMs: 147_600_000, maxMs: .max),
]

/// The line under the recorded total. `tuneTitle` names the tune of a `tune` equivalence.
public func equivalenceText(_ eq: Stats.Equivalence, tuneTitle: String?) -> String {
    let n = groupedThousands(eq.n)
    let one = eq.n == 1
    return switch eq.id {
    case .tune: "About \(n) \(one ? "time" : "times") through \(tuneTitle ?? "")"
    case .lpSide: "About \(n) \(one ? "side" : "sides") of an LP"
    case .bostonDublin: "About \(n) \(one ? "flight" : "flights") from Boston to Dublin"
    case .workWeek: "About \(n) working \(one ? "week" : "weeks")"
    case .crossCountry: "About \(n) \(one ? "drive" : "drives") from New York to Los Angeles"
    }
}

/// `1,200`, as the web's `en-US` number format writes it whatever the device's locale.
public func groupedThousands(_ value: Int) -> String {
    let digits = String(value.magnitude)
    var grouped = ""
    for (index, digit) in digits.enumerated() {
        if index > 0 && (digits.count - index) % 3 == 0 { grouped.append(",") }
        grouped.append(digit)
    }
    return value < 0 ? "-" + grouped : grouped
}
