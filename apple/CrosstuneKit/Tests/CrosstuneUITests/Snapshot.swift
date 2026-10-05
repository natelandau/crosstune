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

#if os(macOS)
    import AppKit

    /// Renders `content` in an offscreen window to `<name>-light.png` and `<name>-dark.png`, for
    /// views the image renderer cannot draw: AppKit-backed controls, scroll views, and canvases
    /// inside a timeline view. Glass is off, as in ``snapshot(_:width:size:_:)``.
    @MainActor
    func windowSnapshot(_ name: String, size: CGSize, @ViewBuilder _ content: () -> some View) async {
        try? FileManager.default.createDirectory(at: snapshotFolder, withIntermediateDirectories: true)
        for (appearance, suffix) in [(NSAppearance.Name.aqua, "light"), (.darkAqua, "dark")] {
            let view = NSHostingView(
                rootView: content()
                    .frame(width: size.width, height: size.height)
                    .background(.background)
                    .environment(\.drawsGlass, false))
            view.frame = CGRect(origin: .zero, size: size)
            let window = NSWindow(
                contentRect: CGRect(origin: CGPoint(x: -20_000, y: -20_000), size: size), styleMask: [.borderless],
                backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.appearance = NSAppearance(named: appearance)
            window.contentView = view
            window.orderFrontRegardless()
            // A few turns of the run loop let geometry reads and their state changes settle.
            for _ in 0..<5 {
                view.layoutSubtreeIfNeeded()
                try? await Task.sleep(for: .milliseconds(50))
            }
            write(view, to: "\(name)-\(suffix)")
            window.orderOut(nil)
            window.close()
        }
    }

    /// Presents `content` as a real sheet over an offscreen window and renders the sheet with its
    /// toolbar to `<name>-light.png` and `<name>-dark.png`.
    @MainActor
    func sheetSnapshot(_ name: String, @ViewBuilder _ content: @escaping () -> some View) async {
        try? FileManager.default.createDirectory(at: snapshotFolder, withIntermediateDirectories: true)
        for (appearance, suffix) in [(NSAppearance.Name.aqua, "light"), (.darkAqua, "dark")] {
            let size = CGSize(width: 800, height: 700)
            let window = NSWindow(
                contentRect: CGRect(origin: CGPoint(x: -20_000, y: -20_000), size: size),
                styleMask: [.titled], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.appearance = NSAppearance(named: appearance)
            window.contentView = NSHostingView(
                rootView: Color.clear
                    .frame(width: size.width, height: size.height)
                    .sheet(isPresented: .constant(true)) { content().environment(\.drawsGlass, false) })
            window.orderFrontRegardless()
            var sheet: NSWindow?
            for _ in 0..<20 where sheet == nil {
                try? await Task.sleep(for: .milliseconds(50))
                sheet = window.attachedSheet
            }
            // Let the sheet's own layout and geometry reads settle.
            try? await Task.sleep(for: .milliseconds(400))
            if let frame = sheet?.contentView?.superview {
                write(frame, to: "\(name)-\(suffix)")
            }
            if let sheet { window.endSheet(sheet) }
            window.orderOut(nil)
            window.close()
        }
    }

    @MainActor
    private func write(_ view: NSView, to name: String) {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        if let data = rep.representation(using: .png, properties: [:]) {
            try? data.write(to: snapshotFolder.appending(path: "\(name).png"))
        }
    }
#endif
