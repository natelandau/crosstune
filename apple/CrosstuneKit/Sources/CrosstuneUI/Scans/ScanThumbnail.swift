import CrosstuneStore
import Foundation
import ImageIO
import SwiftUI

/// A scan at a fixed height: its image downsampled once and cached, a broken-scan mark, or a
/// placeholder of its size while its file is still to come.
struct ScanThumbnail: View {
    /// The decoded height in pixels for a tile `height` points tall on a screen of `scale`, so
    /// the image is never stretched on screen.
    nonisolated static func pixelHeight(height: CGFloat, scale: CGFloat) -> Int {
        Int((height * scale).rounded(.up))
    }

    let scan: Scan
    let index: Int
    let height: CGFloat

    @Environment(\.store) private var store
    @Environment(\.displayScale) private var displayScale
    @State private var decoded: (key: String, image: CGImage?)?

    var body: some View {
        let size = CGSize(width: height * scan.aspectRatio, height: height)
        let pixelHeight = Self.pixelHeight(height: height, scale: displayScale)
        let key = scan.file.map { Self.thumbnailKey(scan: scan.record, file: $0, pixelHeight: pixelHeight) }
        Group {
            if let key, let image = image(for: key) {
                Image(decorative: image, scale: 1)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else if key != nil && decoded?.key == key {
                // Decoded and found unreadable.
                placeholder {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                        .accessibilityLabel(ScanCopy.unreadableScan)
                }
            } else if scan.file == nil && scan.record.state != ScanRecord.pendingUpload {
                placeholder {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel(ScanCopy.downloadingScan(index))
                }
            } else {
                placeholder { EmptyView() }
            }
        }
        .frame(width: size.width, height: size.height)
        .task(id: key) {
            guard let key, let file = scan.file, let store else { return }
            let url = store.scansFolder.appending(path: file.fileName)
            let image = await Self.load(key: key, url: url, pixelHeight: pixelHeight, cache: Self.cache)
            guard !Task.isCancelled else { return }
            decoded = (key, image)
        }
    }

    private func image(for key: String) -> CGImage? {
        Self.shown(key: key, decoded: decoded, cache: Self.cache)
    }

    /// The image to show for `key`: the cached one first, so a store read that leaves the file
    /// as it was shows it at once, then the view's own decode, which outlives an eviction.
    static func shown(key: String, decoded: (key: String, image: CGImage?)?, cache: ThumbnailCache) -> CGImage? {
        if let cached = cache.image(for: key) { return cached }
        return decoded?.key == key ? decoded?.image : nil
    }

    /// The cached image for `key`, or the file at `url` decoded off the main actor and cached.
    static func load(key: String, url: URL, pixelHeight: Int, cache: ThumbnailCache) async -> CGImage? {
        if let cached = cache.image(for: key) { return cached }
        let image = await Task.detached(priority: .utility) { decode(url, height: pixelHeight) }.value
        if let image { cache.insert(image, for: key) }
        return image
    }

    private func placeholder(@ViewBuilder _ content: () -> some View) -> some View {
        Rectangle()
            .fill(.quaternary)
            .overlay { content() }
    }

    /// Names a scan's decoded image by the scan and the file it came from, and nothing that
    /// changes while a file uploads, so an upload's bookkeeping never decodes it again.
    static func key(scan: ScanRecord, file: ScanFile) -> String {
        "\(scan.id)/\(file.fileName)"
    }

    /// `key` plus the decoded size, so a tile that grows decodes again rather than stretching.
    static func thumbnailKey(scan: ScanRecord, file: ScanFile, pixelHeight: Int) -> String {
        "\(key(scan: scan, file: file))/\(pixelHeight)"
    }

    // Twenty scans a tune, a few tunes' worth.
    private static let cache = ThumbnailCache(countLimit: 100)

    /// The image at `url` downsampled to `height` pixels tall, never past its own size, or nil
    /// when it does not decode.
    nonisolated static func decode(_ url: URL, height: Int) -> CGImage? {
        let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithURL(url as CFURL, sourceOptions as CFDictionary),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let fullHeight = properties[kCGImagePropertyPixelHeight] as? Int, width > 0, fullHeight > 0
        else { return nil }
        let longEdge = max(width, fullHeight)
        // The thumbnail size names the long edge, so a wide scan asks for more than `height`.
        let wanted = Int((Double(height) * Double(longEdge) / Double(fullHeight)).rounded())
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: min(longEdge, wanted),
            kCGImageSourceShouldCacheImmediately: true,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    /// The image at `url` at its own size, for the viewer, or nil when it does not decode.
    nonisolated static func decodeFull(_ url: URL) -> CGImage? {
        let options: [CFString: Any] = [kCGImageSourceShouldCacheImmediately: true]
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, options as CFDictionary)
    }
}

/// Decoded thumbnails by scan and file, which the system may empty under memory pressure.
@MainActor
final class ThumbnailCache {
    private let storage = NSCache<NSString, CGImage>()

    init(countLimit: Int) {
        storage.countLimit = countLimit
    }

    func image(for key: String) -> CGImage? { storage.object(forKey: key as NSString) }
    func insert(_ image: CGImage, for key: String) { storage.setObject(image, forKey: key as NSString) }
    func removeAll() { storage.removeAllObjects() }
}
