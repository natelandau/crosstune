import Foundation
import GRDB

@testable import CrosstuneStore

/// A folder of user stores that removes itself when the test ends.
///
/// Bind this to a name for the test's whole scope (`let root = TemporaryRoot()`) rather than
/// chaining `TemporaryRoot().open()`: with nothing holding the instance, it is released, and its
/// `deinit` removes the folder, before the store it just opened is done with the files in it.
public final class TemporaryRoot {
    public let url = FileManager.default.temporaryDirectory
        .appending(path: "crosstune-tests-\(UUID().uuidString)", directoryHint: .isDirectory)

    public init() {}

    deinit {
        try? FileManager.default.removeItem(at: url)
    }

    public func open(_ userID: String = "user_a") throws -> CrosstuneStore {
        try CrosstuneStore.open(userID: userID, root: url)
    }

    /// Opens a store as though it were last closed at `schemaVersion`, for tests of the
    /// start-over behavior a version mismatch triggers.
    public func open(_ userID: String = "user_a", schemaVersion: Int) throws -> CrosstuneStore {
        try CrosstuneStore.open(userID: userID, root: url, schemaVersion: schemaVersion)
    }
}

public let noon = Timestamp(iso: "2026-09-25T12:00:00.000Z")!

public func later(_ milliseconds: Int64, than time: Timestamp = noon) -> Timestamp {
    Timestamp(milliseconds: time.milliseconds + milliseconds)
}
