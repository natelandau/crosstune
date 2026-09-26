import CrosstuneStore
import Foundation

/// Where a recording's audio lives in the user's `audio/` folder, named by the recording's ID.
public enum CaptureFiles {
    /// A capture in progress is AAC in ADTS framing: every packet carries its own header, so a
    /// file cut off by a crash or kill still plays up to its last whole packet. A Core Audio
    /// Format file holding AAC writes its packet table only on close, so one never closed does
    /// not open.
    public static let captureExtension = CrosstuneStore.captureExtension
    /// A finished recording, AAC in an MPEG-4 container.
    public static let finishedExtension = CrosstuneStore.finishedExtension

    public static func captureName(_ recordingID: String) -> String { "\(recordingID).\(captureExtension)" }
    public static func finishedName(_ recordingID: String) -> String { "\(recordingID).\(finishedExtension)" }

    /// The recording IDs of every capture file in `folder`. A file not named for a recording is
    /// left out, since its name could never become a row ID the API accepts.
    static func captureIDs(in folder: URL) -> [String] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == captureExtension }
            .map { $0.deletingPathExtension().lastPathComponent }
            .filter { UUID(uuidString: $0) != nil }
    }

    static func size(of url: URL) throws -> Int64 {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path(percentEncoded: false))
        return (attributes[.size] as? NSNumber)?.int64Value ?? 0
    }

    static func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path(percentEncoded: false))
    }

    static func removeIfPresent(_ url: URL) throws {
        do {
            try FileManager.default.removeItem(at: url)
        } catch CocoaError.fileNoSuchFile {
            return
        }
    }
}
