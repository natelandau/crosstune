import CrosstuneStore
import CrosstuneSync

/// Names a point through the server's `/v1/places/reverse`, so a dropped pin is named as the web
/// names it and the app does no reverse geocoding of its own.
enum ReversePlaceLookup {
    /// The lookup through `engine`, which answers nil offline, where there is no place, and on any
    /// failure. With no engine every point has no name.
    @MainActor
    static func through(_ engine: SyncEngine?) -> DropPinModel.Lookup {
        guard let engine else { return { _ in nil } }
        return { point in await engine.reversePlace(at: point) }
    }
}
