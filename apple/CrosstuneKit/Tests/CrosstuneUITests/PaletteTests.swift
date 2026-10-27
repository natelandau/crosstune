import SwiftUI
import Testing

@testable import CrosstuneUI

#if os(macOS)
    import AppKit
#else
    import UIKit
#endif

@MainActor
@Suite struct PaletteTests {
    /// The system draws a swipe action's label white, so every swipe fill holds 4.5:1 under it.
    @Test(arguments: [ColorScheme.light, .dark])
    func whiteSwipeLabelPassesContrastOnEverySwipeFill(scheme: ColorScheme) {
        #expect(Palette.hex(.onStatusStrong, scheme) == "#FFFFFF")
        for fill in Palette.swipeFills {
            #expect(
                contrastRatio(Palette.hex(.onStatusStrong, scheme), Palette.hex(fill, scheme)) >= 4.5, "\(fill)")
        }
    }

    /// A recording row's swipe actions take only the swipe fills.
    @Test func recordingSwipeActionsTakeOnlyTheSwipeFills() {
        let actions: [RecordingRowAction] = [
            .edit, .addToTune, .removeFromTune, .goToTune, .pin, .openOrigin(site: "YouTube"), .delete,
        ]
        for action in actions {
            #expect(Palette.swipeFills.contains(RecordingRowHandlers.swipeFill(action)), "\(action)")
        }
    }

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

    /// A set filter's label, the accent in light mode and the primary text color in dark mode,
    /// on its tint over every background and card a filter sits on, on every platform.
    @Test(arguments: [ColorScheme.light, .dark])
    func setFilterLabelPassesContrastOnItsTint(scheme: ColorScheme) {
        let accent = Palette.hex(.accent, scheme)
        let label = Palette.hex(Palette.onTintIsAccent(scheme) ? .accent : .textPrimary, scheme)
        let backgrounds: [Palette.Token] = [.pageBackground, .surface, .groupedBackground, .groupedSurface]
        for background in backgrounds {
            let tint = blend(accent, over: Palette.hex(background, scheme), opacity: Palette.tintOpacity(scheme))
            #expect(contrastRatio(label, tint) >= 4.5, "\(scheme) on \(background)")
        }
    }

    /// The brand color and the text on it are the same in both appearances, so the Premium tab
    /// and the Save badge read the same in both.
    @Test func onBrandPassesContrastOnBrand() {
        #expect(contrastRatio(Palette.hex(.onBrand, .light), Palette.hex(.brand, .light)) >= 4.5)
    }

    /// The Premium column's checks and values on the column's strong tint over the card.
    @Test(arguments: PlanSurface.phone)
    func premiumColumnPassesContrastOnItsTint(surface: PlanSurface) {
        let tint = blend(
            Palette.hex(.accent, surface.scheme), over: surface.card, opacity: Palette.tintStrongOpacity(surface.scheme)
        )
        let label = Palette.hex(Palette.onTintIsAccent(surface.scheme) ? .accent : .textPrimary, surface.scheme)
        #expect(contrastRatio(label, tint) >= 3, "check, \(surface)")
        #expect(contrastRatio(label, tint) >= 4.5, "value, \(surface)")
    }

    /// A feature tile's symbol, in the set filter's label color on its tint over the card.
    @Test(arguments: PlanSurface.phone)
    func featureTileGlyphPassesContrast(surface: PlanSurface) {
        let tint = blend(
            Palette.hex(.accent, surface.scheme), over: surface.card, opacity: Palette.tintOpacity(surface.scheme)
        )
        let symbol = Palette.hex(Palette.onTintIsAccent(surface.scheme) ? .accent : .textPrimary, surface.scheme)
        #expect(contrastRatio(symbol, tint) >= 3, "\(surface)")
    }

    /// The Free column's checks, minus marks, and values, in secondary text on the card.
    @Test(arguments: PlanSurface.phone)
    func freeColumnPassesContrast(surface: PlanSurface) {
        #expect(contrastRatio(Palette.hex(.textSecondary, surface.scheme), surface.card) >= 4.5, "\(surface)")
    }

    /// The trial card's secondary lines on its accent tint, which lies on the sheet's background.
    @Test(arguments: PlanSurface.phone)
    func trialCardTextPassesContrastOnItsTint(surface: PlanSurface) {
        let tint = blend(
            Palette.hex(.accent, surface.scheme), over: surface.page,
            opacity: Palette.tintOpacity(surface.scheme))
        #expect(contrastRatio(Palette.hex(.onTintSecondary, surface.scheme), tint) >= 4.5, "\(surface)")
    }

    #if os(macOS)
        /// On the Mac the Premium column is the strong tint over the card, which is `surface`,
        /// with its checks and values in the label on a tint.
        @Test(arguments: [ColorScheme.light, .dark])
        func premiumColumnTextPassesContrastOnStrongTint(scheme: ColorScheme) {
            let card = Palette.hex(.surface, scheme)
            let tint = blend(Palette.hex(.accent, scheme), over: card, opacity: Palette.tintStrongOpacity(scheme))
            let label = Palette.hex(Palette.onTintIsAccent(scheme) ? .accent : .textPrimary, scheme)
            #expect(contrastRatio(label, tint) >= 4.5)
        }

        /// The Free column's checks, dashes, and values in secondary text on the card, and a
        /// feature tile's glyph in secondary text on its field tile.
        @Test(arguments: [ColorScheme.light, .dark])
        func macPlanSecondaryTextPassesContrast(scheme: ColorScheme) {
            let secondary = Palette.hex(.textSecondary, scheme)
            #expect(contrastRatio(secondary, Palette.hex(.surface, scheme)) >= 4.5)
            #expect(contrastRatio(secondary, Palette.hex(.field, scheme)) >= 3)
        }
    #endif

    @Test func statusGlyphColorsAreTheStatusColors() {
        #expect(StatusStyle.dot("known") == .filled(Palette.statusKnown))
        #expect(StatusStyle.dot("learning") == .filled(Palette.statusLearning))
        #expect(StatusStyle.dot("want_to_learn") == .ring)
        #expect(StatusBar.color("want_to_learn") == Palette.statusUnknown)
    }

    @Test func statusGlyphShapes() {
        #expect(StatusGlyph.symbol(for: "known") == "checkmark.circle.fill")
        #expect(StatusGlyph.symbol(for: "learning") == "circle.lefthalf.filled")
        #expect(StatusGlyph.symbol(for: "want_to_learn") == "circle")
        #expect(StatusGlyph.symbol(for: "bogus") == "circle")
    }

    @Test(arguments: [ColorScheme.light, .dark])
    func brandAccentIsThePaletteAccent(scheme: ColorScheme) {
        #expect(hex(of: Palette.accent, scheme) == Palette.hex(.accent, scheme).lowercased())
        #expect(hex(of: Palette.onAccentFill, scheme) == "#ffffff")
        #expect(
            hex(of: Palette.onTint(scheme), scheme)
                == Palette.hex(scheme == .dark ? .textPrimary : .accent, scheme).lowercased())
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
/// card on it. The Mac draws its own tints and cards, which its own tests measure.
struct PlanSurface: CustomStringConvertible, Sendable {
    let scheme: ColorScheme

    var description: String { "iPhone \(scheme)" }
    var page: String { Palette.hex(.groupedBackground, scheme) }
    var card: String { Palette.hex(.groupedSurface, scheme) }

    static let phone = [PlanSurface(scheme: .light), PlanSurface(scheme: .dark)]
}
