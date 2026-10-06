import CrosstuneStore
import CrosstuneSync
import Foundation

/// What the model is made for: a new store or engine, as after signing in as someone else,
/// needs a new one.
struct ModelKey: Equatable {
    let store: ObjectIdentifier?
    let engine: ObjectIdentifier?

    init(store: CrosstuneStore?, engine: SyncEngine?) {
        self.store = store.map(ObjectIdentifier.init)
        self.engine = engine.map(ObjectIdentifier.init)
    }
}
