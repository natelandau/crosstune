/// Converts between a source time in ms and a range handle's place, in seconds from an origin
/// such as the start of the trim.
enum HandleTime {
    static func seconds(_ sourceMs: Int64, from origin: Int64) -> Double {
        Double(sourceMs - origin) / 1000
    }

    static func sourceMs(_ seconds: Double, from origin: Int64) -> Int64 {
        origin + Int64((seconds * 1000).rounded())
    }
}
