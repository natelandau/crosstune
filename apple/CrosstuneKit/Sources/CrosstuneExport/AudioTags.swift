import AVFoundation
import Foundation

public struct AudioTagValues: Sendable {
    public var title: String
    public var album: String?
    public var date: String?

    public init(title: String, album: String?, date: String?) {
        self.title = title
        self.album = album
        self.date = date
    }
}

public enum AudioTagsError: Error {
    case unsupportedSource
    case destinationExists
    case exportUnavailable
}

public enum AudioTags {
    /// Copies `source` to `destination` with title, album, and date tags. A passthrough export
    /// keeps the audio bytes as they are, and only the listed items are written, so no location
    /// or other metadata travels with the copy. Throws for a source that is not MP4 or M4A.
    public static func write(from source: URL, to destination: URL, tags: AudioTagValues) async throws {
        guard ["m4a", "mp4"].contains(source.pathExtension.lowercased()) else {
            throw AudioTagsError.unsupportedSource
        }
        guard !FileManager.default.fileExists(atPath: destination.path(percentEncoded: false)) else {
            throw AudioTagsError.destinationExists
        }
        let asset = AVURLAsset(url: source)
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
            throw AudioTagsError.exportUnavailable
        }
        session.metadata = metadataItems(tags)
        do {
            try await session.export(to: destination, as: .m4a)
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }

    private static func metadataItems(_ tags: AudioTagValues) -> [AVMetadataItem] {
        [
            (AVMetadataIdentifier.iTunesMetadataSongName, tags.title),
            (.iTunesMetadataAlbum, tags.album),
            (.iTunesMetadataReleaseDate, tags.date),
        ].compactMap { identifier, value in
            guard let value else { return nil }
            let item = AVMutableMetadataItem()
            item.identifier = identifier
            item.value = value as NSString
            item.dataType = kCMMetadataBaseDataType_UTF8 as String
            return item
        }
    }
}
