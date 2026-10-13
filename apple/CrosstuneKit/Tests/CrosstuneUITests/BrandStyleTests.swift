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

    /// Coral and its ink are fixed colors, so the Premium tab and the Save badge read the same
    /// in both appearances.
    @Test func inkOnCoralPassesContrast() {
        #expect(contrastRatio(BrandStyle.onCoralHex, BrandStyle.coralHex) >= 4.5)
    }

    /// The Premium column's checks and values on the column's wash over the card.
    @Test(arguments: PlanSurface.all)
    func premiumColumnPassesContrastOnItsWash(surface: PlanSurface) {
        let wash = blend(
            BrandStyle.accentHex(surface.scheme), over: surface.card, opacity: BrandStyle.setFillOpacity(surface.scheme)
        )
        let ink = surface.scheme == .dark ? surface.primary(over: wash) : BrandStyle.premiumInkLight
        #expect(contrastRatio(ink, wash) >= 3, "check, \(surface)")
        #expect(contrastRatio(ink, wash) >= 4.5, "value, \(surface)")
    }

    /// A feature tile's symbol, in the set filter's label color on its wash over the card.
    @Test(arguments: PlanSurface.all)
    func featureTileGlyphPassesContrast(surface: PlanSurface) {
        let wash = blend(
            BrandStyle.accentHex(surface.scheme), over: surface.card, opacity: BrandStyle.setFillOpacity(surface.scheme)
        )
        let ink =
            BrandStyle.setLabelIsSlate(surface.scheme)
            ? BrandStyle.accentHex(surface.scheme) : surface.primary(over: wash)
        #expect(contrastRatio(ink, wash) >= 3, "\(surface)")
    }

    /// The Free column's checks and minus marks, in the secondary label color on the card.
    @Test(arguments: PlanSurface.all)
    func freeColumnGlyphsPassContrast(surface: PlanSurface) {
        #expect(contrastRatio(surface.secondary(over: surface.card), surface.card) >= 3, "\(surface)")
    }

    /// The Free column's values, which are text, on the card.
    @Test(arguments: PlanSurface.all)
    func freeColumnValuesPassContrast(surface: PlanSurface) {
        #expect(contrastRatio(BrandStyle.washSecondaryHex(surface.scheme), surface.card) >= 4.5, "\(surface)")
    }

    /// The trial card's secondary lines on its slate wash, which lies on the sheet's ground.
    @Test(arguments: PlanSurface.all)
    func trialCardTextPassesContrastOnItsWash(surface: PlanSurface) {
        let wash = blend(
            BrandStyle.accentHex(surface.scheme), over: surface.ground,
            opacity: BrandStyle.setFillOpacity(surface.scheme))
        #expect(contrastRatio(BrandStyle.washSecondaryHex(surface.scheme), wash) >= 4.5, "\(surface)")
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

/// Where the Plan sheet draws: the sheet's ground and its cards, with the system label colors
/// over them, on the Mac and on iPhone in each appearance. A Mac sheet draws a shade off its
/// window background, so the Mac's grounds cover both; its card is the quinary label color over
/// the ground.
struct PlanSurface: CustomStringConvertible, Sendable {
    let name: String
    let scheme: ColorScheme
    let ground: String
    let card: String
    /// The secondary label as a color and opacity.
    let secondaryInk: (String, Double)
    /// The primary label as a color and opacity.
    let primaryInk: (String, Double)

    var description: String { name }

    func secondary(over background: String) -> String {
        blend(secondaryInk.0, over: background, opacity: secondaryInk.1)
    }

    func primary(over background: String) -> String {
        blend(primaryInk.0, over: background, opacity: primaryInk.1)
    }

    static func mac(_ scheme: ColorScheme, ground: String) -> PlanSurface {
        let ink = scheme == .dark ? "#FFFFFF" : "#000000"
        return PlanSurface(
            name: "Mac \(scheme) on \(ground)", scheme: scheme, ground: ground,
            card: blend(ink, over: ground, opacity: 0.047),
            secondaryInk: (ink, scheme == .dark ? 0.549 : 0.498), primaryInk: (ink, 0.847))
    }

    static let all: [PlanSurface] = [
        mac(.light, ground: "#FFFFFF"), mac(.light, ground: "#F0F0F0"),
        mac(.dark, ground: "#1E1E1E"), mac(.dark, ground: "#282828"),
        PlanSurface(
            name: "iPhone light", scheme: .light, ground: "#F2F2F7", card: "#FFFFFF",
            secondaryInk: ("#3C3C43", 0.6), primaryInk: ("#000000", 1)),
        PlanSurface(
            name: "iPhone dark", scheme: .dark, ground: "#000000", card: "#1C1C1E",
            secondaryInk: ("#EBEBF5", 0.6), primaryInk: ("#FFFFFF", 1)),
    ]
}
