import SwiftUI
import Testing

@testable import CrosstuneUI

#if os(macOS)
    import AppKit
#else
    import UIKit
#endif

@MainActor
@Suite struct BrandStyleTests {
    /// Every filled control off the Mac fills with the accent fill, so its white label reads.
    @Test(arguments: [ColorScheme.light, .dark])
    func theLabelOnTheAccentFillPassesContrast(scheme: ColorScheme) {
        #expect(contrastRatio(Palette.hex(.onAccentFill, scheme), Palette.hex(.accentFill, scheme)) >= 4.5)
    }

    /// The system's prominent styles draw their own fill and label, so every prominent button
    /// goes through the accent styles that color them.
    @Test func everyProminentButtonUsesTheAccentStyle() throws {
        let sources = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "Sources/CrosstuneUI", directoryHint: .isDirectory)
        let files =
            FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil)?
            .compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" } ?? []
        #expect(!files.isEmpty)
        let violations = try files.filter { file in
            let source = try String(contentsOf: file, encoding: .utf8)
            return source.contains(".borderedProminent") || source.contains(".glassProminent")
        }.map(\.lastPathComponent).filter { $0 != "AccentProminent.swift" }.sorted()
        #expect(violations.isEmpty, "System prominent styles outside AccentProminent: \(violations)")
    }

    /// A set filter's label, the accent in light mode and ink in dark mode, on its wash over
    /// every ground and card a filter sits on, on every platform.
    @Test(arguments: [ColorScheme.light, .dark])
    func setFilterLabelPassesContrastOnItsWash(scheme: ColorScheme) {
        let accent = Palette.hex(.accent, scheme)
        let label = Palette.hex(BrandStyle.setLabelIsAccent(scheme) ? .accent : .ink, scheme)
        let grounds: [Palette.Token] = [.ground, .surface, .groupedPage, .groupedCard]
        for ground in grounds {
            let wash = blend(accent, over: Palette.hex(ground, scheme), opacity: BrandStyle.setFillOpacity(scheme))
            #expect(contrastRatio(label, wash) >= 4.5, "\(scheme) on \(ground)")
        }
    }

    /// Coral and its ink are fixed colors, so the Premium tab and the Save badge read the same
    /// in both appearances.
    @Test func inkOnCoralPassesContrast() {
        #expect(contrastRatio(BrandStyle.onCoralHex, BrandStyle.coralHex) >= 4.5)
    }

    /// The Premium column's checks and values on the column's wash over the card.
    @Test(arguments: PlanSurface.phone)
    func premiumColumnPassesContrastOnItsWash(surface: PlanSurface) {
        let wash = blend(
            Palette.hex(.accent, surface.scheme), over: surface.card, opacity: BrandStyle.setFillOpacity(surface.scheme)
        )
        let ink = Palette.hex(BrandStyle.setLabelIsAccent(surface.scheme) ? .accent : .ink, surface.scheme)
        #expect(contrastRatio(ink, wash) >= 3, "check, \(surface)")
        #expect(contrastRatio(ink, wash) >= 4.5, "value, \(surface)")
    }

    /// A feature tile's symbol, in the set filter's label color on its wash over the card.
    @Test(arguments: PlanSurface.phone)
    func featureTileGlyphPassesContrast(surface: PlanSurface) {
        let wash = blend(
            Palette.hex(.accent, surface.scheme), over: surface.card, opacity: BrandStyle.setFillOpacity(surface.scheme)
        )
        let ink = Palette.hex(BrandStyle.setLabelIsAccent(surface.scheme) ? .accent : .ink, surface.scheme)
        #expect(contrastRatio(ink, wash) >= 3, "\(surface)")
    }

    /// The Free column's checks, minus marks, and values, in secondary ink on the card.
    @Test(arguments: PlanSurface.phone)
    func freeColumnPassesContrast(surface: PlanSurface) {
        #expect(contrastRatio(Palette.hex(.inkSecondary, surface.scheme), surface.card) >= 4.5, "\(surface)")
    }

    /// The trial card's secondary lines on its accent wash, which lies on the sheet's ground.
    @Test(arguments: PlanSurface.phone)
    func trialCardTextPassesContrastOnItsWash(surface: PlanSurface) {
        let wash = blend(
            Palette.hex(.accent, surface.scheme), over: surface.ground,
            opacity: BrandStyle.setFillOpacity(surface.scheme))
        #expect(contrastRatio(BrandStyle.washSecondaryHex(surface.scheme), wash) >= 4.5, "\(surface)")
    }

    #if os(macOS)
        /// On the Mac the Premium column is a coral wash over the card, which is `surface`, with
        /// its checks and values in ink.
        @Test(arguments: [ColorScheme.light, .dark])
        func premiumColumnInkPassesContrastOnCoralWash(scheme: ColorScheme) {
            let card = Palette.hex(.surface, scheme)
            let wash = blend(BrandStyle.coralHex, over: card, opacity: PlanComparison.macPremiumWashOpacity)
            #expect(contrastRatio(Palette.hex(.ink, scheme), wash) >= 4.5)
            // The wash must read as coral, not vanish into the card.
            #expect(PlanComparison.macPremiumWashOpacity >= 0.10)
            #expect(PlanComparison.macPremiumWashOpacity <= 0.12)
        }

        /// The Free column's checks, dashes, and values in secondary ink on the card, and a
        /// feature tile's glyph in secondary ink on its field tile.
        @Test(arguments: [ColorScheme.light, .dark])
        func macPlanSecondaryInkPassesContrast(scheme: ColorScheme) {
            let secondary = Palette.hex(.inkSecondary, scheme)
            #expect(contrastRatio(secondary, Palette.hex(.surface, scheme)) >= 4.5)
            #expect(contrastRatio(secondary, Palette.hex(.field, scheme)) >= 3)
        }
    #endif

    @Test func statusGlyphColorsAreTheStatusColors() {
        #expect(StatusStyle.dot("known") == .filled(StatusStyle.known))
        #expect(StatusStyle.dot("learning") == .filled(.orange))
        #expect(StatusStyle.dot("want_to_learn") == .ring)
        #expect(StatusBar.color("want_to_learn") == StatusStyle.unknown)
    }

    @Test func statusGlyphShapes() {
        #expect(StatusGlyph.symbol(for: "known") == "checkmark.circle.fill")
        #expect(StatusGlyph.symbol(for: "learning") == "circle.lefthalf.filled")
        #expect(StatusGlyph.symbol(for: "want_to_learn") == "circle")
        #expect(StatusGlyph.symbol(for: "bogus") == "circle")
    }

    @Test(arguments: [ColorScheme.light, .dark])
    func brandAccentIsThePaletteAccent(scheme: ColorScheme) {
        #expect(hex(of: BrandStyle.accent, scheme) == Palette.hex(.accent, scheme).lowercased())
        #expect(hex(of: Palette.onAccentFill, scheme) == "#ffffff")
        #expect(
            hex(of: BrandStyle.setLabel(scheme), scheme)
                == Palette.hex(scheme == .dark ? .ink : .accent, scheme).lowercased())
    }

    private func hex(of color: Color, _ scheme: ColorScheme) -> String? {
        #if os(macOS)
            var resolved: String?
            NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)?.performAsCurrentDrawingAppearance {
                resolved = NSColor(color).usingColorSpace(.sRGB).map {
                    KeyColor.RGB(
                        red: Double($0.redComponent), green: Double($0.greenComponent),
                        blue: Double($0.blueComponent)
                    ).hex
                }
            }
            return resolved
        #else
            let traits = UITraitCollection(userInterfaceStyle: scheme == .dark ? .dark : .light)
            var (red, green, blue, alpha): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
            guard UIColor(color).resolvedColor(with: traits).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
            else { return nil }
            return KeyColor.RGB(red: Double(red), green: Double(green), blue: Double(blue)).hex
        #endif
    }
}

/// Where the Plan sheet draws on iPhone and iPad in each appearance: the grouped page and the
/// card on it. The Mac draws its own washes and cards, which its own tests measure.
struct PlanSurface: CustomStringConvertible, Sendable {
    let scheme: ColorScheme

    var description: String { "iPhone \(scheme)" }
    var ground: String { Palette.hex(.groupedPage, scheme) }
    var card: String { Palette.hex(.groupedCard, scheme) }

    static let phone = [PlanSurface(scheme: .light), PlanSurface(scheme: .dark)]
}
