import Foundation
import UniformTypeIdentifiers

/// A shared file copied into the extension's own folder, waiting to be checked and saved.
public struct IncomingFile: Sendable {
    public let url: URL
    /// Read from the stored name, as an upload from Files is judged.
    public let type: UTType?
    public let bytes: Int64
    /// The name the file was shared under, which a refusal names. The stored name can carry an
    /// added extension.
    public let sharedName: String
    public let label: String

    public init(url: URL, type: UTType?, bytes: Int64, sharedName: String, label: String) {
        self.url = url
        self.type = type
        self.bytes = bytes
        self.sharedName = sharedName
        self.label = label
    }
}
