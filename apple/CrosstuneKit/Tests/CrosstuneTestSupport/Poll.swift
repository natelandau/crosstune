/// Checks `condition` until it holds or `timeout` has passed, and says whether it held. The
/// deadline is long so a loaded CI runner cannot fail a test that is only slow; a condition that
/// holds returns at once.
public func poll(
    timeout: Duration = .seconds(10), isolation: isolated (any Actor)? = #isolation,
    _ condition: () async throws -> Bool
) async throws -> Bool {
    let deadline = ContinuousClock.now + timeout
    while true {
        if try await condition() { return true }
        if ContinuousClock.now >= deadline { return false }
        try await Task.sleep(for: .milliseconds(5))
    }
}
