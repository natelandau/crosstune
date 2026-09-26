/// One field of a partial edit: `keep` leaves the stored value untouched, `value` replaces it,
/// even with `nil` for a nullable field, which clears it.
///
/// Mirrors the web client's `Partial<T>` patches, where an omitted key means keep and an
/// explicit `null` means clear, a distinction a plain optional cannot express on its own.
public enum Patch<Value: Sendable>: Sendable {
    case keep
    case value(Value)

    /// Whether this patch leaves the stored value untouched.
    public var isKeep: Bool {
        if case .keep = self { return true }
        return false
    }

    /// `current` unless this patch carries a replacement.
    public func resolved(from current: Value) -> Value {
        switch self {
        case .keep: current
        case .value(let value): value
        }
    }
}

extension Patch: Equatable where Value: Equatable {}
