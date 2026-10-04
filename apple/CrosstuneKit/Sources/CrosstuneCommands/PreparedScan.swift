import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// An image ready to store as a scan: an upright JPEG, at most 2400 px on its long
/// edge, transparency on white, with none of the original's metadata.
///
/// Preparing decodes and encodes a full image, so call it off the main thread.
public struct PreparedScan: Sendable, Equatable {
    public enum Error: Swift.Error, Equatable {
        /// The data is not an image ImageIO can read.
        case undecodable
    }

    public static let maxEdge = 2400
    public static let jpegQuality = 0.75

    public let jpeg: Data
    public let width: Int
    public let height: Int

    /// Prepares a picked photo or file, turning it upright by its orientation tag.
    public static func make(from data: Data) throws -> PreparedScan {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0
        else { throw Error.undecodable }
        let options: [CFString: Any] = [
            // Always from the full image, never an embedded thumbnail, which may be tiny.
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxEdge,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw Error.undecodable
        }
        return try encode(image, width: image.width, height: image.height)
    }

    /// Prepares a document camera page, which arrives upright.
    public static func make(from image: CGImage) throws -> PreparedScan {
        guard image.width > 0, image.height > 0 else { throw Error.undecodable }
        let scale = min(1, Double(maxEdge) / Double(max(image.width, image.height)))
        let width = max(1, Int((Double(image.width) * scale).rounded()))
        let height = max(1, Int((Double(image.height) * scale).rounded()))
        return try encode(image, width: width, height: height)
    }

    /// Draws `image` at the given size onto white and encodes it. Drawing into a fresh bitmap
    /// leaves every metadata property of the source behind.
    private static func encode(_ image: CGImage, width: Int, height: Int) throws -> PreparedScan {
        guard let sRGB = CGColorSpace(name: CGColorSpace.sRGB),
            let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB,
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { throw Error.undecodable }
        let bounds = CGRect(x: 0, y: 0, width: width, height: height)
        // JPEG has no alpha, and an encoder left to itself turns clear pixels black.
        context.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
        context.fill(bounds)
        context.interpolationQuality = .high
        context.draw(image, in: bounds)
        guard let flattened = context.makeImage() else { throw Error.undecodable }

        let output = NSMutableData()
        guard
            let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil)
        else { throw Error.undecodable }
        let properties: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: jpegQuality]
        CGImageDestinationAddImage(destination, flattened, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw Error.undecodable }
        return PreparedScan(jpeg: withoutMetadataSegments(output as Data), width: width, height: height)
    }

    /// Drops every APP1 (Exif, XMP) and APP13 (Photoshop, IPTC) segment from a JPEG. ImageIO
    /// writes both into every JPEG it encodes, even with no metadata given; they hold only the
    /// new image's color space and size, but a scan carries no Exif at all.
    static func withoutMetadataSegments(_ jpeg: Data) -> Data {
        let bytes = [UInt8](jpeg)
        guard bytes.count > 4, bytes[0] == 0xFF, bytes[1] == 0xD8 else { return jpeg }
        var kept = Data(bytes[0..<2])
        var at = 2
        // Marker segments run until start of scan (FFDA), after which the entropy-coded data
        // and the rest of the file are copied as they are.
        while at + 4 <= bytes.count, bytes[at] == 0xFF, bytes[at + 1] != 0xDA {
            let end = at + 2 + (Int(bytes[at + 2]) << 8 | Int(bytes[at + 3]))
            guard end <= bytes.count else { return jpeg }
            if bytes[at + 1] != 0xE1 && bytes[at + 1] != 0xED { kept.append(contentsOf: bytes[at..<end]) }
            at = end
        }
        kept.append(contentsOf: bytes[at...])
        return kept
    }
}
