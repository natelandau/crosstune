import CrosstuneDesign
import SwiftUI

#if os(iOS)
    import UIKit
#else
    import AppKit
#endif

/// A status glyph for a menu item, in the color the catalog's rows draw it. A menu redraws a
/// symbol in one color, so the glyph goes in as an image already colored for `scheme`.
enum StatusMenuIcon {
    @MainActor
    static func image(_ status: String, scheme: ColorScheme) -> Image {
        let symbol = StatusGlyph.symbol(for: status)
        var environment = EnvironmentValues()
        environment.colorScheme = scheme
        let color = Color(StatusGlyphStyle(status: status).resolve(in: environment).resolve(in: environment))
        #if os(iOS)
            guard let base = UIImage(systemName: symbol) else { return Image(systemName: symbol) }
            return Image(uiImage: base.withTintColor(UIColor(color), renderingMode: .alwaysOriginal))
                .renderingMode(.original)
        #else
            guard let base = NSImage(systemSymbolName: symbol, accessibilityDescription: nil),
                let colored = base.withSymbolConfiguration(.init(paletteColors: [NSColor(color)]))
            else { return Image(systemName: symbol) }
            colored.isTemplate = false
            return Image(nsImage: colored).renderingMode(.original)
        #endif
    }
}
