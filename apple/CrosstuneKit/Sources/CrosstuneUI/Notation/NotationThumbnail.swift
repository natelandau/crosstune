import CrosstuneStore
import Foundation
import ImageIO
import SwiftUI

/// A page at a fixed height: its image downsampled once and cached, a broken-page mark, or a
/// placeholder of its size while its file is still to come.
struct NotationThumbnail: View {
    /// The decoded height in pixels: twice the section's 120 pt row, for a sharp image on a
    /// Retina screen.
    nonisolated static let pixelHeight = 240

    let page: NotationPage
    let index: Int
    let height: CGFloat

    @Environment(\.store) private var store
    @State private var decoded: (key: String, image: CGImage?)?

    var body: some View {
        let size = CGSize(width: height * page.aspectRatio, height: height)
        let key = page.file.map { Self.key(page: page.record, file: $0) }
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
                        .accessibilityLabel(NotationCopy.unreadablePage)
                }
            } else if page.file == nil && page.record.state != NotationPageRecord.pendingUpload {
                placeholder {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel(NotationCopy.downloadingPage(index))
                }
            } else {
                placeholder { EmptyView() }
            }
        }
        .frame(width: size.width, height: size.height)
        .task(id: key) {
            guard let key, let file = page.file, let store else { return }
            let url = store.notationFolder.appending(path: file.fileName)
            let image = await Self.load(key: key, url: url, cache: Self.cache)
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
    static func load(key: String, url: URL, cache: ThumbnailCache) async -> CGImage? {
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

    /// Names a page's decoded image by the page and the file it came from, and nothing that
    /// changes while a file uploads, so an upload's bookkeeping never decodes it again.
    static func key(page: NotationPageRecord, file: NotationFile) -> String {
        "\(page.id)/\(file.fileName)"
    }

    // Twenty pages a tune, a few tunes' worth.
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
        // The thumbnail size names the long edge, so a wide page asks for more than `height`.
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

/// Decoded thumbnails by page and file, which the system may empty under memory pressure.
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
