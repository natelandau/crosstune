import Foundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

@testable import CrosstuneUI

/// `apple/.build/snapshots/`, found from this file so it holds wherever `swift test` runs from.
private let snapshotFolder = URL(filePath: #filePath)
    .deletingLastPathComponent()  // CrosstuneUITests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // CrosstuneKit
    .deletingLastPathComponent()  // apple
    .appending(path: ".build/snapshots", directoryHint: .isDirectory)

/// Renders `content` on the page background to `<name>-light.png` and `<name>-dark.png` for a
/// person to look at, at Dynamic Type `size`, which names the file when it is not the default.
/// The Mac renderer does not scale type, so a size other than the default shows its spacing
/// only. Nothing is compared: a rendering that fails, as it can on a machine with no display, is
/// skipped rather than failing the test.
@MainActor
func snapshot(
    _ name: String, width: CGFloat = 390, size: DynamicTypeSize = .large, @ViewBuilder _ content: () -> some View
) {
    let name = size == .large ? name : "\(name)-\(size)"
    try? FileManager.default.createDirectory(at: snapshotFolder, withIntermediateDirectories: true)
    for (scheme, suffix) in [(ColorScheme.light, "light"), (.dark, "dark")] {
        let page = content()
            .padding(16)
            .frame(width: width, alignment: .topLeading)
            .background(scheme == .dark ? Color.black : Color.white)
            .environment(\.colorScheme, scheme)
            .environment(\.drawsGlass, false)
            .environment(\.dynamicTypeSize, size)
        let renderer = ImageRenderer(content: page)
        renderer.scale = 2
        guard let image = renderer.cgImage else { continue }
        let url = snapshotFolder.appending(path: "\(name)-\(suffix).png")
        guard
            let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
        else { continue }
        CGImageDestinationAddImage(destination, image, nil)
        CGImageDestinationFinalize(destination)
    }
}
