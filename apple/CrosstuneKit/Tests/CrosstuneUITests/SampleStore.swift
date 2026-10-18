import CrosstuneStore
import CrosstuneTestSupport
import Foundation

@testable import CrosstuneUI

extension SampleCatalog {
    /// A store in `root` holding the sample as ``makeStore(root:withAudio:)`` writes it, copied
    /// from one written once per test process.
    @MainActor
    static func copiedStore(root: URL) async throws -> CrosstuneStore {
        try await StoreTemplate.open("sample", userID: userID, root: root) { try await makeStore(root: $0) }
    }
}
