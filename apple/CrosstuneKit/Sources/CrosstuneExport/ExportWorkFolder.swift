import Foundation
import Synchronization

/// The temporary folders the exports build their files in, one per kind of export. Each export
/// builds in a job folder of its own, which is in use from when the export names it until its
/// owner discards it.
public enum ExportWorkFolder: String, CaseIterable, Sendable {
    case data = "crosstune-export"
    case recordings = "crosstune-recording-export"

    /// The names of the job folders in use. Each is a UUID, so a name alone identifies its job.
    private static let inUse = Mutex<Set<String>>([])

    var url: URL {
        FileManager.default.temporaryDirectory.appending(path: rawValue, directoryHint: .isDirectory)
    }

    /// Deletes everything in the temporary folders but the job folders in use. A job in use may
    /// be with a save panel, share service, or folder write that still reads its files, and its
    /// owner deletes it once that is done.
    public static func removeLeftovers() {
        for folder in allCases { removeLeftovers(root: folder.url) }
    }

    static func removeLeftovers(root: URL) {
        let manager = FileManager.default
        let path = root.path(percentEncoded: false)
        // Listed under the lock, so a job named after it is not in the list.
        let leftovers = inUse.withLock { inUse in
            ((try? manager.contentsOfDirectory(atPath: path)) ?? []).filter { !inUse.contains($0) }
        }
        for name in leftovers { try? manager.removeItem(at: root.appending(path: name)) }
        // Removes the folder only when it is empty, so a job made meanwhile stays.
        rmdir(path)
    }

    /// A new job folder under `root`, in use until ``discard(_:)``. The caller creates it.
    static func newJob(in root: URL) -> URL {
        let name = UUID().uuidString
        inUse.withLock { _ = $0.insert(name) }
        return root.appending(path: name, directoryHint: .isDirectory)
    }

    /// Deletes a job folder. Its name is no longer in use even when the delete fails, so the
    /// next ``removeLeftovers()`` tries again.
    static func discard(_ job: URL) {
        try? FileManager.default.removeItem(at: job)
        inUse.withLock { _ = $0.remove(job.lastPathComponent) }
    }
}
