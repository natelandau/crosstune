#if os(macOS)
    import AppKit
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @Suite struct MacStyleTests {
        @Test func slateTextPassesContrast() {
            #expect(contrastRatio(MacStyle.accentLight, "#FFFFFF") >= 4.5)
            #expect(contrastRatio(MacStyle.accentDark, "#1E1E1E") >= 4.5)
        }

        @Test func labelOnSlatePassesContrast() {
            #expect(contrastRatio(MacStyle.onAccentLight, MacStyle.accentLight) >= 4.5)
            #expect(contrastRatio(MacStyle.onAccentDark, MacStyle.accentDark) >= 4.5)
        }

        /// A set filter's label on its slate wash, over the lightest and darkest windows each
        /// mode draws. The primary label color is white at 85% in dark mode.
        @Test func setFilterLabelPassesContrastOnItsWash() {
            for (scheme, accent, windows) in [
                (ColorScheme.light, MacStyle.accentLight, ["#FFFFFF", "#ECECEC"]),
                (ColorScheme.dark, MacStyle.accentDark, ["#1E1E1E", "#323232"]),
            ] {
                for window in windows {
                    let wash = blend(accent, over: window, opacity: MacStyle.setFillOpacity(scheme))
                    let label = MacStyle.setLabelIsSlate(scheme) ? accent : blend("#FFFFFF", over: wash, opacity: 0.85)
                    #expect(contrastRatio(label, wash) >= 4.5, "\(scheme) on \(window)")
                }
            }
        }

        @Test func accentResolvesToItsSlateInEachAppearance() {
            for (name, hex) in [(NSAppearance.Name.aqua, MacStyle.accentLight), (.darkAqua, MacStyle.accentDark)] {
                var resolved: String?
                NSAppearance(named: name)?.performAsCurrentDrawingAppearance {
                    resolved = NSColor(MacStyle.accent).usingColorSpace(.sRGB).map {
                        KeyColor.RGB(
                            red: Double($0.redComponent), green: Double($0.greenComponent),
                            blue: Double($0.blueComponent)
                        ).hex
                    }
                }
                #expect(resolved == hex.lowercased(), "\(name.rawValue)")
            }
        }

        @Test func sidebarTintTakesEachModesSlate() {
            let light = MacStyle.sidebarTint(.light).resolve(in: EnvironmentValues())
            let dark = MacStyle.sidebarTint(.dark).resolve(in: EnvironmentValues())
            #expect(light != dark)
            #expect(abs(Double(light.opacity) - 0.15) < 0.001)
            #expect(abs(Double(dark.opacity) - 0.20) < 0.001)
        }

        @Test func glassFallsBackToAnOpaqueFillBeforeAnyMaterial() {
            #expect(MacGlassMode(reduceTransparency: false, increasedContrast: false, drawsGlass: true) == .glass)
            #expect(MacGlassMode(reduceTransparency: false, increasedContrast: false, drawsGlass: false) == .material)
            for drawsGlass in [true, false] {
                #expect(
                    MacGlassMode(reduceTransparency: true, increasedContrast: false, drawsGlass: drawsGlass) == .opaque)
                #expect(
                    MacGlassMode(reduceTransparency: false, increasedContrast: true, drawsGlass: drawsGlass) == .opaque)
            }
        }

        @Test func statusGlyphColorsFollowTheStatusDot() {
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
    }
#endif
