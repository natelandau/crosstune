import Foundation

/// A UserDefaults suite of its own whose values are gone once it goes away. Bind it to a name
/// for the test's whole scope, as with `TemporaryRoot`.
public final class TemporaryDefaults: @unchecked Sendable {
    /// Every suite's name starts with this, so stale files can be found and removed.
    static let prefix = "crosstune.tests."

    public let name: String
    public let defaults: UserDefaults

    /// - Parameter label: Names the suite after the tests that use it, for reading a stray file.
    public init(_ label: String = "suite") {
        Self.removeStaleFiles
        name = "\(Self.prefix)\(label).\(UUID().uuidString)"
        // A suite name is never the app's own domain, so this always makes one.
        defaults = UserDefaults(suiteName: name)!
    }

    deinit {
        defaults.removePersistentDomain(forName: name)
    }

    private static var folder: URL {
        FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Preferences")
    }

    /// The preferences daemon writes an emptied suite's file some time after the test that used
    /// it has ended, so each test process removes the files earlier runs left. A file younger
    /// than a minute may belong to a suite another process still uses, so it stays.
    private static let removeStaleFiles: Void = {
        let manager = FileManager.default
        let cutoff = Date.now.addingTimeInterval(-60)
        let files =
            (try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey]))
            ?? []
        for file in files where file.lastPathComponent.hasPrefix(prefix) && file.pathExtension == "plist" {
            let modified = try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
            if let modified, modified < cutoff { try? manager.removeItem(at: file) }
        }
    }()
}
