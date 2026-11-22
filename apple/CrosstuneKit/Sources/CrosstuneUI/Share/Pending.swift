import Observation

/// A value held until one reader takes it.
@MainActor
@Observable
public final class Pending<Value: Equatable> {
    public internal(set) var value: Value
    @ObservationIgnored private let empty: Value

    init(_ empty: Value) {
        value = empty
        self.empty = empty
    }

    /// The value, which is then cleared so it is taken once.
    public func take() -> Value {
        defer { clear() }
        return value
    }

    func clear() {
        value = empty
    }
}
