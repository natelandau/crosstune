#if os(macOS)
    import AppKit
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor
    @Suite struct MacStyleTests {
        /// `color` as `#rrggbb` once drawn in `scheme`.
        private func resolved(_ color: Color, in scheme: ColorScheme) -> String? {
            var hex: String?
            NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)?.performAsCurrentDrawingAppearance {
                hex = NSColor(color).usingColorSpace(.sRGB).map {
                    KeyColor.RGB(
                        red: Double($0.redComponent), green: Double($0.greenComponent), blue: Double($0.blueComponent)
                    ).hex
                }
            }
            return hex
        }

        /// Ink and secondary ink on every ground a Mac view draws on, the accent as text on the
        /// window, and the label on an accent fill.
        @Test(arguments: [ColorScheme.light, .dark])
        func paletteTextPassesContrast(scheme: ColorScheme) {
            let hex = { MacPalette.hex($0, scheme) }
            for ground in [MacPalette.Token.ground, .surface, .field, .raised] {
                #expect(contrastRatio(hex(.ink), hex(ground)) >= 4.5, "ink on \(ground)")
                #expect(contrastRatio(hex(.inkSecondary), hex(ground)) >= 4.5, "secondary ink on \(ground)")
            }
            #expect(contrastRatio(hex(.accent), hex(.ground)) >= 4.5)
            #expect(contrastRatio(hex(.onAccentFill), hex(.accentFill)) >= 4.5)
        }

        @Test func pageGlyphsHangInsideThePageMargin() {
            #expect(MacStyle.pageGlyphColumn > 0)
            #expect(MacStyle.pageGlyphColumn < MacStyle.pageMargin)
        }

        @Test func accentIsHarborInEachAppearance() {
            #expect(resolved(MacStyle.accent, in: .light) == "#1f5f9e")
            #expect(resolved(MacStyle.accent, in: .dark) == "#6aa6e6")
        }

        @Test(arguments: [ColorScheme.light, .dark])
        func everyTokenResolvesToItsHex(scheme: ColorScheme) {
            let colors: [MacPalette.Token: Color] = [
                .accent: MacPalette.accent, .accentFill: MacPalette.accentFill,
                .onAccentFill: MacPalette.onAccentFill, .ground: MacPalette.ground, .surface: MacPalette.surface,
                .field: MacPalette.field, .raised: MacPalette.raised, .ink: MacPalette.ink,
                .inkSecondary: MacPalette.inkSecondary,
                .markInk: MacPalette.markInk,
            ]
            for token in MacPalette.Token.allCases {
                #expect(resolved(colors[token]!, in: scheme) == MacPalette.hex(token, scheme).lowercased(), "\(token)")
            }
        }

        /// Reduce Transparency's fill is the sidebar's surface, with no wash over it.
        @Test(arguments: [ColorScheme.light, .dark])
        func opaqueGlassFillsWithSurface(scheme: ColorScheme) {
            #expect(resolved(MacGlassMode.opaqueFill, in: scheme) == MacPalette.hex(.surface, scheme).lowercased())
        }

        /// The mark's C stays slate on light, whatever the accent.
        @Test func markInkNeverFollowsAccent() {
            #expect(MacPalette.hex(.markInk, .light) == "#4F5D75")
            #expect(MacPalette.hex(.markInk, .dark) == "#FFFFFF")
            for scheme in [ColorScheme.light, .dark] {
                #expect(MacPalette.hex(.markInk, scheme) != MacPalette.hex(.accent, scheme))
            }
        }

        /// A label on an accent fill is white in both appearances, since dark mode's fill is the
        /// deeper accent fill, never the accent itself.
        @Test(arguments: [ColorScheme.light, .dark])
        func onAccentIsTheLabelOnAnAccentFill(scheme: ColorScheme) {
            #expect(resolved(MacPalette.onAccentFill, in: scheme) == "#ffffff")
            #expect(contrastRatio(MacPalette.hex(.onAccentFill, scheme), MacPalette.hex(.accentFill, scheme)) >= 4.5)
        }

        /// The hairline is ink at a low opacity: dark slate on light, near white on dark.
        @Test func hairlineHoldsItsValues() {
            #expect(MacPalette.hairlineLight.rgb.hex == "#1e2837")
            #expect(MacPalette.hairlineLight.alpha == 0.12)
            #expect(MacPalette.hairlineDark.rgb.hex == "#e6f0ff")
            #expect(MacPalette.hairlineDark.alpha == 0.10)
        }

        /// A set filter's label on its accent wash, over the grounds a filter row sits on.
        @Test(arguments: [ColorScheme.light, .dark])
        func setLabelPassesContrastOnItsWash(scheme: ColorScheme) {
            let accent = MacPalette.hex(.accent, scheme)
            let label = MacStyle.setLabelIsAccent(scheme) ? accent : MacPalette.hex(.ink, scheme)
            for ground in [MacPalette.Token.ground, .surface] {
                let wash = blend(accent, over: MacPalette.hex(ground, scheme), opacity: MacStyle.setFillOpacity(scheme))
                #expect(contrastRatio(label, wash) >= 4.5, "\(scheme) on \(ground)")
            }
        }

        /// The dock's play is a disc that fits the dock's slot, never a frame padded to a touch target.
        @Test func dockPlayButtonFitsItsSlot() throws {
            #expect(MacStyle.dockPlayDiameter == 28)
            #expect(MacStyle.dockPlayDiameter <= MacStyle.paneIconWidth)
            let file = SourceScan.sources.appending(path: "Mac/PlayerDock.swift")
            let dock = SourceScan.macOSRegions(of: SourceScan.withoutComments(try SourceScan.text(at: file)), in: file)
            #expect(!dock.contains("minimumTapTarget"))
            // The shared play button frames itself to the touch target.
            #expect(!dock.contains("RecordingPlayButton("))
            #expect(dock.contains("MacStyle.dockPlayDiameter"))
        }

        /// Catalog, a list, Recordings, and the tune page set their titles on one baseline.
        @Test(arguments: [
            "Mac/ColumnTitle.swift", "Mac/MacListTitle.swift", "Recordings/RecordingsScreen.swift",
            "Tune/TunePage.swift",
        ])
        func everyColumnUsesTheOneTitleBaseline(path: String) throws {
            let file = SourceScan.sources.appending(path: path)
            var text = SourceScan.withoutComments(try SourceScan.text(at: file))
            if path == "Tune/TunePage.swift" {
                let header = try #require(text.range(of: "struct TunePageHeader"))
                text = String(text[header.lowerBound...])
            }
            #expect(SourceScan.macOSRegions(of: text, in: file).contains("columnTitleBaseline"))
        }

        /// The baseline holds whatever the title's size: the column's 26 points or the page's 34.
        @Test func titleRoomPutsEveryTitleSizeOnTheBaseline() {
            for size: CGFloat in [26, 34] {
                let ascender = NSFont.systemFont(ofSize: size, weight: .bold).ascender
                #expect(
                    abs(MacStyle.titleTop(size: size, container: .page) + ascender - MacStyle.columnTitleBaseline)
                        < 0.01)
            }
        }

        /// The undo banner is ink with the ground's color for its words and the other
        /// appearance's accent for Undo, each at 4.5:1.
        @Test(arguments: [ColorScheme.light, .dark])
        func undoBannerPassesContrast(scheme: ColorScheme) {
            #expect(MacStyle.undoBannerHeight == 36)
            let fill = MacPalette.hex(.ink, scheme)
            #expect(contrastRatio(MacPalette.hex(.ground, scheme), fill) >= 4.5)
            #expect(contrastRatio(MacStyle.undoActionHex(scheme), fill) >= 4.5)
            #expect(resolved(MacStyle.undoAction, in: scheme) == MacStyle.undoActionHex(scheme).lowercased())
        }

        /// A sidebar glyph is secondary ink at rest and white on the emphasized selection; no
        /// sidebar glyph or control takes the accent or coral at rest.
        @Test func sidebarGlyphsAreSecondaryAtRest() throws {
            #expect(MacSidebarLabel.symbolInk(emphasized: false) == .inkSecondary)
            #expect(MacSidebarLabel.symbolInk(emphasized: true) == .onAccentFill)
            for path in ["Mac/MacSidebar.swift", "Shell/SidebarSectionHeader.swift"] {
                let file = SourceScan.sources.appending(path: path)
                let text = SourceScan.withoutComments(try SourceScan.text(at: file))
                #expect(!text.contains(".tint"), "\(path)")
                #expect(!text.contains("coral"), "\(path)")
                #expect(!text.contains("plus.circle"), "\(path)")
            }
        }

        /// The dock's scrubber: a hairline track, ink fill, coral knob.
        @Test func scrubberDrawsInTokens() throws {
            let file = SourceScan.sources.appending(path: "Mac/PlayerDock.swift")
            let text = SourceScan.withoutComments(try SourceScan.text(at: file))
            let track = try #require(text.range(of: "struct ScrubberTrack"))
            let body = text[track.lowerBound...]
            #expect(body.contains("MacPalette.hairline"))
            #expect(body.contains("MacPalette.ink.opacity(ScrubberTrack.fillOpacity)"))
            #expect(!body.contains(".quaternary"))
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
    }
#endif
