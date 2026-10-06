import SwiftUI
import Testing

@testable import CrosstuneUI

#if os(macOS)
    import AppKit
#endif

@MainActor
@Suite struct BrandStyleTests {
    @Test func slateTextPassesContrast() {
        #expect(contrastRatio(BrandStyle.accentLight, "#FFFFFF") >= 4.5)
        #expect(contrastRatio(BrandStyle.accentDark, "#1E1E1E") >= 4.5)
    }

    @Test func labelOnSlatePassesContrast() {
        #expect(contrastRatio(BrandStyle.onAccentLight, BrandStyle.accentLight) >= 4.5)
        #expect(contrastRatio(BrandStyle.onAccentDark, BrandStyle.accentDark) >= 4.5)
    }

    /// The one label color every slate fill takes, through `onSlateLabel()`, the slate prominent
    /// button styles, and the chosen capsule and key pill, in each appearance.
    @Test(arguments: [ColorScheme.light, .dark])
    func theLabelOnSlatePassesContrast(scheme: ColorScheme) {
        #expect(contrastRatio(BrandStyle.onAccentHex(scheme), BrandStyle.accentHex(scheme)) >= 4.5)
    }

    /// The system's prominent styles draw a white label, short of 4.5:1 on dark mode's slate, so
    /// every prominent button goes through the slate styles that color it.
    @Test func everyProminentButtonUsesTheSlateStyle() throws {
        let sources = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "Sources/CrosstuneUI", directoryHint: .isDirectory)
        let files =
            FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil)?
            .compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" } ?? []
        #expect(!files.isEmpty)
        let offenders = try files.filter { file in
            let source = try String(contentsOf: file, encoding: .utf8)
            return source.contains(".borderedProminent") || source.contains(".glassProminent")
        }.map(\.lastPathComponent).filter { $0 != "SlateProminent.swift" }.sorted()
        #expect(offenders.isEmpty, "System prominent styles outside SlateProminent: \(offenders)")
    }

    /// A set filter's label on its slate wash, over the lightest and darkest windows each
    /// mode draws on the Mac and on iPhone. The primary label color is white at 85% in dark
    /// mode.
    @Test func setFilterLabelPassesContrastOnItsWash() {
        for (scheme, accent, windows) in [
            (ColorScheme.light, BrandStyle.accentLight, ["#FFFFFF", "#ECECEC", "#F2F2F7"]),
            (ColorScheme.dark, BrandStyle.accentDark, ["#1E1E1E", "#323232", "#000000", "#1C1C1E"]),
        ] {
            for window in windows {
                let wash = blend(accent, over: window, opacity: BrandStyle.setFillOpacity(scheme))
                let label = BrandStyle.setLabelIsSlate(scheme) ? accent : blend("#FFFFFF", over: wash, opacity: 0.85)
                #expect(contrastRatio(label, wash) >= 4.5, "\(scheme) on \(window)")
            }
        }
    }

    @Test func statusGlyphColorsAreTheStatusColors() {
        #expect(StatusGlyph.color(for: "known") == .green)
        #expect(StatusGlyph.color(for: "learning") == .orange)
        #expect(StatusGlyph.color(for: "want_to_learn") == .secondary)
    }

    @Test func statusGlyphShapes() {
        #expect(StatusGlyph.symbol(for: "known") == "checkmark.circle.fill")
        #expect(StatusGlyph.symbol(for: "learning") == "circle.lefthalf.filled")
        #expect(StatusGlyph.symbol(for: "want_to_learn") == "circle")
        #expect(StatusGlyph.symbol(for: "bogus") == "circle")
    }

    #if os(macOS)
        @Test func accentResolvesToItsSlateInEachAppearance() {
            for (name, hex) in [
                (NSAppearance.Name.aqua, BrandStyle.accentLight), (.darkAqua, BrandStyle.accentDark),
            ] {
                var resolved: String?
                NSAppearance(named: name)?.performAsCurrentDrawingAppearance {
                    resolved = NSColor(BrandStyle.accent).usingColorSpace(.sRGB).map {
                        KeyColor.RGB(
                            red: Double($0.redComponent), green: Double($0.greenComponent),
                            blue: Double($0.blueComponent)
                        ).hex
                    }
                }
                #expect(resolved == hex.lowercased(), "\(name.rawValue)")
            }
        }
    #endif
}
