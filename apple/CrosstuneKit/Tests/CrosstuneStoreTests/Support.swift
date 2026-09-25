import Foundation
import GRDB

@testable import CrosstuneStore

/// A folder of user stores that removes itself when the test ends.
final class TemporaryRoot {
    let url = FileManager.default.temporaryDirectory
        .appending(path: "crosstune-store-tests-\(UUID().uuidString)", directoryHint: .isDirectory)

    deinit {
        try? FileManager.default.removeItem(at: url)
    }

    func open(_ userID: String = "user_a", schemaVersion: Int = Schema.version) throws -> CrosstuneStore {
        try CrosstuneStore.open(userID: userID, root: url, schemaVersion: schemaVersion)
    }
}

struct Deliberate: Error {}

let noon = Timestamp(iso: "2026-09-25T12:00:00.000Z")!

func later(_ milliseconds: Int64, than time: Timestamp = noon) -> Timestamp {
    Timestamp(milliseconds: time.milliseconds + milliseconds)
}
