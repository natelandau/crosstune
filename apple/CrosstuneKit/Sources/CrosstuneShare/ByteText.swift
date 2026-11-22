/// Sizes as people read them.
public enum ByteText {
    /// A size in decimal units. Megabytes and gigabytes truncate to a tenth, so a shown size
    /// never overstates what is there.
    public static func bytes(_ bytes: Int64) -> String {
        if bytes < 1000 { return "\(bytes) B" }
        if bytes < 1_000_000 { return "\(Int64((Double(bytes) / 1000).rounded())) KB" }
        let (divisor, unit): (Int64, String) = bytes < 1_000_000_000 ? (1_000_000, "MB") : (1_000_000_000, "GB")
        let tenths = bytes * 10 / divisor
        let (whole, fraction) = tenths.quotientAndRemainder(dividingBy: 10)
        return fraction == 0 ? "\(whole) \(unit)" : "\(whole).\(fraction) \(unit)"
    }
}
