import CrosstuneVocabulary

/// A new row ID: a lowercase UUIDv7.
public func newID(at time: Timestamp = .now) -> String {
    uuidV7(milliseconds: time.milliseconds)
}
