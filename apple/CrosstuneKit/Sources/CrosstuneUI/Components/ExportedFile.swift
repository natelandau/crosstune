import CoreTransferable
import Foundation
import UniformTypeIdentifiers

/// A finished export file that a save panel copies from where it already is.
struct ExportedFile: Transferable {
    let url: URL
    let type: UTType

    /// Each instance offers only its own type, so the save panel names and filters the file as it is.
    static var transferRepresentation: some TransferRepresentation {
        representation(.zip)
        // Audiovisual content, not audio: a WebM capture is a movie type and must keep its extension.
        representation(.audiovisualContent)
    }

    private static func representation(_ type: UTType) -> some TransferRepresentation<Self> {
        // The Mac save panel names its file wrapper from the suggested name and throws on an empty one.
        FileRepresentation(exportedContentType: type) { SentTransferredFile($0.url) }
            .suggestedFileName { $0.url.lastPathComponent }
            .exportingCondition { $0.type == type }
    }
}
