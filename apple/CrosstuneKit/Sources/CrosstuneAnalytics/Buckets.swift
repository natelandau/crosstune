/// The fixed ranges a count, a length, a size, or a speed is sent as, so no event carries a
/// number precise enough to single anyone out.
public enum Bucket {
    public static func count(_ n: Int) -> String {
        switch n {
        case ...0: "0"
        case 1...9: "1-9"
        case 10...49: "10-49"
        case 50...199: "50-199"
        default: "200+"
        }
    }

    public static func duration(seconds: Double) -> String {
        switch seconds {
        case ..<30: "<30s"
        case ..<120: "30s-2m"
        case ..<300: "2-5m"
        default: "5m+"
        }
    }

    /// Decimal megabytes, as the system shows a file's size.
    public static func bytes(_ n: Int64) -> String {
        let megabyte: Int64 = 1_000_000
        return switch n {
        case ...0: "0"
        case ..<(10 * megabyte): "<10MB"
        case ..<(50 * megabyte): "10-50MB"
        case ..<(500 * megabyte): "50-500MB"
        default: "500MB+"
        }
    }

    /// A rate within a hair of 1 is normal speed, so arithmetic on a stepped rate still lands there.
    public static func speed(_ rate: Double) -> String {
        if abs(rate - 1) < 0.001 { return "1" }
        return switch rate {
        case ..<0.75: "<0.75"
        case ..<1: "0.75-0.99"
        default: ">1"
        }
    }
}
