/// A value a control has written but the store may not show yet, so the control keeps the
/// new value instead of springing back to the old one until the store's next read.
///
/// Each write takes a token, so an earlier write that settles late never clears a later one.
struct PendingWrite<Value: Equatable> {
    /// The value to show over the stored one, or nil to show the stored one.
    private(set) var value: Value?
    private var token = 0
    private var landed = false

    /// Starts a write of `value` and returns its token.
    mutating func begin(_ value: Value) -> Int {
        token += 1
        self.value = value
        landed = false
        return token
    }

    /// The write failed, so the stored value stands.
    mutating func fail(_ token: Int) {
        guard token == self.token else { return }
        value = nil
    }

    /// The write landed. A store already showing it needs no cover; otherwise the next read
    /// will, since it is taken after the write committed.
    mutating func land(_ token: Int, stored: Value?) {
        guard token == self.token else { return }
        if stored == value {
            value = nil
        } else {
            landed = true
        }
    }

    /// The store read anew, which includes every write that has landed.
    mutating func storeChanged() {
        guard landed else { return }
        value = nil
        landed = false
    }
}
