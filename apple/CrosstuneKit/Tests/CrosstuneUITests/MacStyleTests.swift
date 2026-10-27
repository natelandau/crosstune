#if os(macOS)
    import AppKit
    import CrosstuneDesign
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

        /// Primary and secondary text on every background a Mac view draws on, the accent as text
        /// on the window, and the label on an accent fill.
        @Test(arguments: [ColorScheme.light, .dark])
        func paletteTextPassesContrast(scheme: ColorScheme) {
            let hex = { Palette.hex($0, scheme) }
            for background in [Palette.Token.pageBackground, .surface, .field, .surfaceRaised] {
                #expect(contrastRatio(hex(.textPrimary), hex(background)) >= 4.5, "primary on \(background)")
                #expect(contrastRatio(hex(.textSecondary), hex(background)) >= 4.5, "secondary on \(background)")
            }
            #expect(contrastRatio(hex(.accent), hex(.pageBackground)) >= 4.5)
            #expect(contrastRatio(hex(.onAccentFill), hex(.accentFill)) >= 4.5)
        }

        @Test func pageGlyphsHangInsideThePageMargin() {
            #expect(MacStyle.pageGlyphColumn > 0)
            #expect(MacStyle.pageGlyphColumn < MacStyle.pageMargin)
        }

        @Test func accentHoldsItsValueInEachAppearance() {
            #expect(resolved(Palette.accent, in: .light) == "#1f5f9e")
            #expect(resolved(Palette.accent, in: .dark) == "#6aa6e6")
        }

        @Test(arguments: [ColorScheme.light, .dark])
        func everyTokenResolvesToItsHex(scheme: ColorScheme) {
            let colors: [Palette.Token: Color] = [
                .accent: Palette.accent, .accentFill: Palette.accentFill,
                .onAccentFill: Palette.onAccentFill, .pageBackground: Palette.pageBackground, .surface: Palette.surface,
                .field: Palette.field, .surfaceRaised: Palette.surfaceRaised, .textPrimary: Palette.textPrimary,
                .textSecondary: Palette.textSecondary,
                .brandSecondary: Palette.brandSecondary, .groupedBackground: Palette.groupedBackground,
                .groupedSurface: Palette.groupedSurface, .accentTrack: Palette.accentTrack,
                .accentSelection: Palette.accentSelection, .inverseAccent: Palette.inverseAccent,
                .brand: Palette.brand, .onBrand: Palette.onBrand, .danger: Palette.danger,
                .warning: Palette.warning, .statusKnown: Palette.statusKnown,
                .statusLearning: Palette.statusLearning, .statusUnknown: Palette.statusUnknown,
                .statusUnknownOnFill: Palette.color(.statusUnknownOnFill), .onPractice: Palette.onPractice,
                .onPracticeSecondary: Palette.onPracticeSecondary,
                .practiceBackground: Palette.practiceBackground(scheme),
                .onTintSecondary: Palette.onTintSecondary(scheme), .tunerClose: Palette.color(.tunerClose),
                .tunerInTuneBackground: Palette.color(.tunerInTuneBackground), .fieldHover: Palette.fieldHover,
                .textTertiary: Palette.textTertiary, .neutralFill: Palette.neutralFill,
                .warningFill: Palette.warningFill, .onWarningFill: Palette.onWarningFill, .onStatus: Palette.onStatus,
                .onRecord: Palette.onRecord, .tunerInTune: Palette.color(.tunerInTune),
                .warningFillStrong: Palette.warningFillStrong, .dangerFillStrong: Palette.dangerFillStrong,
                .onStatusStrong: Palette.onStatusStrong,
            ]
            for token in Palette.Token.allCases {
                #expect(resolved(colors[token]!, in: scheme) == Palette.hex(token, scheme).lowercased(), "\(token)")
            }
        }

        /// Reduce Transparency's fill is the sidebar's surface, with no tint over it.
        @Test func opaqueGlassFillsWithSurface() throws {
            let file = SourceScan.url(of: "Mac/MacStyle.swift")
            let text = SourceScan.withoutComments(try SourceScan.text(at: file))
            #expect(text.contains("content.background(Palette.surface, in: shape)"))
        }

        /// The mark's C stays slate on light, whatever the accent.
        @Test func brandSecondaryNeverFollowsAccent() {
            #expect(Palette.hex(.brandSecondary, .light) == "#4F5D75")
            #expect(Palette.hex(.brandSecondary, .dark) == "#FFFFFF")
            for scheme in [ColorScheme.light, .dark] {
                #expect(Palette.hex(.brandSecondary, scheme) != Palette.hex(.accent, scheme))
            }
        }

        /// A label on an accent fill is white in both appearances, since dark mode's fill is the
        /// deeper accent fill, never the accent itself.
        @Test(arguments: [ColorScheme.light, .dark])
        func onAccentIsTheLabelOnAnAccentFill(scheme: ColorScheme) {
            #expect(resolved(Palette.onAccentFill, in: scheme) == "#ffffff")
            #expect(contrastRatio(Palette.hex(.onAccentFill, scheme), Palette.hex(.accentFill, scheme)) >= 4.5)
        }

        /// The border is a low opacity of a dark slate on light and a near white on dark.
        @Test func borderHoldsItsValues() {
            #expect(Palette.borderLight.rgb.hex == "#1e2837")
            #expect(Palette.borderLight.alpha == 0.12)
            #expect(Palette.borderDark.rgb.hex == "#e6f0ff")
            #expect(Palette.borderDark.alpha == 0.10)
        }

        /// A set filter's label on its accent tint, over the backgrounds a filter row sits on.
        @Test(arguments: [ColorScheme.light, .dark])
        func setLabelPassesContrastOnItsTint(scheme: ColorScheme) {
            let accent = Palette.hex(.accent, scheme)
            let label = Palette.onTintIsAccent(scheme) ? accent : Palette.hex(.textPrimary, scheme)
            for background in [Palette.Token.pageBackground, .surface] {
                let tint = blend(accent, over: Palette.hex(background, scheme), opacity: Palette.tintOpacity(scheme))
                #expect(contrastRatio(label, tint) >= 4.5, "\(scheme) on \(background)")
            }
        }

        /// The dock's play is a circle that fits the dock's slot, never a frame padded to a touch target.
        @Test func dockPlayButtonFitsItsSlot() throws {
            #expect(MacStyle.dockPlayDiameter == 28)
            #expect(MacStyle.dockPlayDiameter <= MacStyle.paneIconWidth)
            let file = SourceScan.url(of: "Mac/PlayerDock.swift")
            let dock = SourceScan.macOSRegions(of: SourceScan.withoutComments(try SourceScan.text(at: file)), in: file)
            #expect(!dock.contains("minimumTapTarget"))
            // The shared play button frames itself to the touch target.
            #expect(!dock.contains("RecordingPlayButton("))
            #expect(dock.contains("MacStyle.dockPlayDiameter"))
        }

        /// Catalog, a list, Recordings, and the tune page set their titles on one baseline.
        @Test(arguments: [
            "Mac/ColumnTitle.swift", "Mac/MacListTitle.swift", "Recordings/RecordingsScreen.swift",
            "Tune/TuneHeader.swift",
        ])
        func everyColumnUsesTheOneTitleBaseline(path: String) throws {
            let file = SourceScan.url(of: path)
            let text = SourceScan.withoutComments(try SourceScan.text(at: file))
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

        /// The undo banner is the primary text color with the page background's color for its
        /// words and the other appearance's accent for Undo, each at 4.5:1.
        @Test(arguments: [ColorScheme.light, .dark])
        func undoBannerPassesContrast(scheme: ColorScheme) {
            #expect(MacStyle.undoBannerHeight == 36)
            let fill = Palette.hex(.textPrimary, scheme)
            #expect(contrastRatio(Palette.hex(.pageBackground, scheme), fill) >= 4.5)
            #expect(contrastRatio(Palette.hex(.inverseAccent, scheme), fill) >= 4.5)
            #expect(resolved(Palette.inverseAccent, in: scheme) == Palette.hex(.inverseAccent, scheme).lowercased())
        }

        /// A sidebar glyph is secondary text at rest and white on the emphasized selection; no
        /// sidebar glyph or control takes the accent or the brand color at rest.
        @Test func sidebarGlyphsAreSecondaryAtRest() throws {
            #expect(MacSidebarLabel.symbolColor(emphasized: false) == .textSecondary)
            #expect(MacSidebarLabel.symbolColor(emphasized: true) == .onAccentFill)
            for path in ["Mac/MacSidebar.swift", "Shell/SidebarSectionHeader.swift"] {
                let file = SourceScan.url(of: path)
                let text = SourceScan.withoutComments(try SourceScan.text(at: file))
                #expect(!text.contains(".tint"), "\(path)")
                #expect(!text.contains("Palette.brand"), "\(path)")
                #expect(!text.contains("plus.circle"), "\(path)")
            }
        }

        /// The dock's scrubber: a border track, a tertiary text fill, and a brand thumb.
        @Test func scrubberDrawsInTokens() throws {
            let file = SourceScan.url(of: "Mac/PlayerDock.swift")
            let text = SourceScan.withoutComments(try SourceScan.text(at: file))
            let track = try #require(text.range(of: "struct ScrubberTrack"))
            let body = text[track.lowerBound...]
            #expect(body.contains("Palette.border"))
            #expect(body.contains("Palette.textTertiary"))
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
