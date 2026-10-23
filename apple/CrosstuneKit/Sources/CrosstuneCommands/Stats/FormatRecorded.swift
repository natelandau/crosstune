/// A recorded total as `9 h 12 min`, or `12 min` under an hour. Minutes round down.
public func formatRecorded(_ ms: Int) -> String {
    let minutes = ms / 60_000
    let hours = minutes / 60
    return hours > 0 ? "\(hours) h \(minutes % 60) min" : "\(minutes) min"
}
