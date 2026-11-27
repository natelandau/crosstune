/// A claim on the time the system grants a backgrounded app to finish work.
@MainActor
public protocol BackgroundTimeHold: AnyObject {
    /// Gives the time back. Call it once the work the hold covered is done, on every path.
    func end()
}

/// Takes a hold on background time for the named piece of work.
public typealias BackgroundTimeHolder = @MainActor (_ name: String) -> any BackgroundTimeHold

/// A hold that asks for nothing, for platforms that never suspend a running app and for tests.
@MainActor
public final class NoBackgroundTimeHold: BackgroundTimeHold {
    /// A holder that hands out this hold, for any caller that must pass one.
    public nonisolated static let holder: BackgroundTimeHolder = { _ in NoBackgroundTimeHold() }

    public init() {}

    public func end() {}
}
