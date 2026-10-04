import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// The images the notation tests prepare, drawn here rather than committed so each one says how
/// it was made. They cover the same cases as the web client's `prepareImage` fixtures.
enum NotationFixtures {
    struct RGBA: Equatable {
        let red: UInt8
        let green: UInt8
        let blue: UInt8
        let alpha: UInt8
    }

    /// An RGBA image whose pixels come from `pixel(x, y)`, with y counted from the top.
    static func image(width: Int, height: Int, pixel: (Int, Int) -> RGBA) -> CGImage {
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                let color = pixel(x, y)
                let at = (y * width + x) * 4
                // Premultiplied, as the bitmap context below declares.
                let alpha = Int(color.alpha)
                bytes[at] = UInt8(Int(color.red) * alpha / 255)
                bytes[at + 1] = UInt8(Int(color.green) * alpha / 255)
                bytes[at + 2] = UInt8(Int(color.blue) * alpha / 255)
                bytes[at + 3] = color.alpha
            }
        }
        let context = CGContext(
            data: &bytes, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        return context.makeImage()!
    }

    static func encode(_ image: CGImage, as type: UTType, properties: [CFString: Any] = [:]) -> Data {
        let output = NSMutableData()
        let destination = CGImageDestinationCreateWithData(output, type.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        precondition(CGImageDestinationFinalize(destination))
        return output as Data
    }

    static let red = RGBA(red: 200, green: 40, blue: 40, alpha: 255)
    static let blue = RGBA(red: 40, green: 40, blue: 200, alpha: 255)

    /// Stored 60 wide by 40 tall, red on the left and blue on the right; orientation 6 tells a
    /// viewer to turn it a quarter clockwise, which puts red on top.
    static var rotatedEXIF: Data {
        let landscape = image(width: 60, height: 40) { x, _ in x < 30 ? red : blue }
        return encode(landscape, as: .jpeg, properties: [kCGImagePropertyOrientation: 6])
    }

    /// A phone photo's worth of metadata: orientation, camera, capture time, and location.
    static var withMetadata: Data {
        let landscape = image(width: 60, height: 40) { x, _ in x < 30 ? red : blue }
        return encode(
            landscape, as: .jpeg,
            properties: [
                kCGImagePropertyOrientation: 6,
                kCGImagePropertyTIFFDictionary: [
                    kCGImagePropertyTIFFMake: "Apple", kCGImagePropertyTIFFModel: "iPhone",
                    kCGImagePropertyTIFFOrientation: 6,
                ],
                kCGImagePropertyExifDictionary: [kCGImagePropertyExifDateTimeOriginal: "2026:09:25 12:00:00"],
                kCGImagePropertyGPSDictionary: [
                    kCGImagePropertyGPSLatitude: 39.74, kCGImagePropertyGPSLatitudeRef: "N",
                    kCGImagePropertyGPSLongitude: 104.99, kCGImagePropertyGPSLongitudeRef: "W",
                ],
            ])
    }

    /// One opaque color over the whole image, drawn by filling rather than pixel by pixel so a
    /// camera-sized image is quick to make.
    static func flat(width: Int, height: Int, _ color: RGBA) -> CGImage {
        let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        context.setFillColor(
            red: CGFloat(color.red) / 255, green: CGFloat(color.green) / 255, blue: CGFloat(color.blue) / 255, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        return context.makeImage()!
    }

    /// One flat color, 6000 by 4000, as a camera might take.
    static var large: Data {
        let gray = RGBA(red: 120, green: 140, blue: 160, alpha: 255)
        return encode(
            flat(width: 6000, height: 4000, gray), as: .jpeg,
            properties: [kCGImageDestinationLossyCompressionQuality: 0.1])
    }

    /// Clear everywhere except an opaque black square in the top-left corner.
    static var transparent: Data {
        let clear = RGBA(red: 0, green: 0, blue: 0, alpha: 0)
        let black = RGBA(red: 0, green: 0, blue: 0, alpha: 255)
        return encode(image(width: 64, height: 64) { x, y in x < 16 && y < 16 ? black : clear }, as: .png)
    }

    /// HEIC's container header with no image inside.
    static var notAnImage: Data {
        Data([0, 0, 0, 0x18] + Array("ftypheic".utf8) + [0, 0, 0, 0] + Array("mif1heic".utf8))
    }

    /// The color at `(x, y)`, y counted from the top, of an encoded image as a reader decodes it.
    static func pixel(of data: Data, x: Int, y: Int) -> RGBA {
        let source = CGImageSourceCreateWithData(data as CFData, nil)!
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let context = CGContext(
            data: &bytes, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        let at = (y * image.width + x) * 4
        return RGBA(red: bytes[at], green: bytes[at + 1], blue: bytes[at + 2], alpha: bytes[at + 3])
    }
}
