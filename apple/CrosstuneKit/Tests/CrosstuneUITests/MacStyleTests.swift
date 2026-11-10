#if os(macOS)
    import AppKit
    import CrosstuneDesign
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor
    struct MacStyleTests {
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

        @Test(arguments: [ColorScheme.light, .dark])
        func everyTokenResolvesToItsHex(scheme: ColorScheme) throws {
            let colors: [Palette.Token: Color] = [
                .accent: Palette.accent, .accentFill: Palette.accentFill,
                .onAccentFill: Palette.onAccentFill, .pageBackground: Palette.pageBackground, .surface: Palette.surface,
                .field: Palette.field, .surfaceRaised: Palette.surfaceRaised, .textPrimary: Palette.textPrimary,
                .textSecondary: Palette.textSecondary,
                .brandSecondary: Palette.brandSecondary, .groupedBackground: Palette.groupedBackground,
                .groupedSurface: Palette.groupedSurface, .accentTrack: Palette.accentTrack,
                .accentSelection: Palette.accentSelection, .inverseAccent: Palette.inverseAccent,
                .brand: Palette.brand, .onBrand: Palette.onBrand, .playhead: Palette.playhead, .danger: Palette.danger,
                .warning: Palette.warning, .statusKnown: Palette.statusKnown,
                .statusLearning: Palette.statusLearning, .statusUnknown: Palette.statusUnknown,
                .statusUnknownOnFill: Palette.color(.statusUnknownOnFill), .onTuner: Palette.onTuner,
                .onTunerSecondary: Palette.onTunerSecondary,
                .tunerBackground: Palette.tunerBackground(scheme),
                .onTintSecondary: Palette.onTintSecondary(scheme), .tunerClose: Palette.color(.tunerClose),
                .tunerInTuneBackground: Palette.color(.tunerInTuneBackground), .fieldHover: Palette.fieldHover,
                .textTertiary: Palette.textTertiary, .neutralFill: Palette.neutralFill,
                .warningFill: Palette.warningFill, .onWarningFill: Palette.onWarningFill, .onStatus: Palette.onStatus,
                .onRecord: Palette.onRecord, .tunerInTune: Palette.color(.tunerInTune),
                .warningFillStrong: Palette.warningFillStrong, .dangerFillStrong: Palette.dangerFillStrong,
                .onStatusStrong: Palette.onStatusStrong,
            ]
            for token in Palette.Token.allCases {
                #expect(
                    resolved(try #require(colors[token]), in: scheme) == Palette.hex(token, scheme).lowercased(),
                    "\(token)")
            }
        }

        /// The mark's second color stays apart from the accent, whatever the accent.
        @Test func brandSecondaryNeverFollowsAccent() {
            for scheme in [ColorScheme.light, .dark] {
                #expect(Palette.hex(.brandSecondary, scheme) != Palette.hex(.accent, scheme))
            }
        }

        /// A set filter's label on its accent tint, over the backgrounds a filter row sits on.
        @Test(arguments: [ColorScheme.light, .dark], [Palette.Token.pageBackground, .surface])
        func setLabelPassesContrastOnItsTint(scheme: ColorScheme, background: Palette.Token) {
            let accent = Palette.hex(.accent, scheme)
            let label = Palette.onTintIsAccent(scheme) ? accent : Palette.hex(.textPrimary, scheme)
            let tint = blend(accent, over: Palette.hex(background, scheme), opacity: Palette.tintOpacity(scheme))
            #expect(contrastRatio(label, tint) >= 4.5)
        }

        /// The dock's play is a circle that fits the dock's slot, never a frame padded to a touch target.
        @Test func dockPlayButtonFitsItsSlot() throws {
            #expect(MacStyle.dockPlayDiameter <= MacStyle.paneIconWidth)
            let file = SourceScan.url(of: "Mac/PlayerDock.swift")
            let dock = SourceScan.macOSRegions(of: SourceScan.withoutComments(try SourceScan.text(at: file)), in: file)
            #expect(dock.contains("minimumTapTarget") == false)
            // The shared play button frames itself to the touch target.
            #expect(dock.contains("RecordingPlayButton(") == false)
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
        @Test(arguments: [CGFloat(26), 34])
        func titleRoomPutsEveryTitleSizeOnTheBaseline(size: CGFloat) {
            let ascender = NSFont.systemFont(ofSize: size, weight: .bold).ascender
            #expect(
                abs(MacStyle.titleTop(size: size, container: .page) + ascender - MacStyle.columnTitleBaseline) < 0.01)
        }

        /// The undo banner is the primary text color with the page background's color for its
        /// words and the other appearance's accent for Undo, each at 4.5:1.
        @Test(arguments: [ColorScheme.light, .dark])
        func undoBannerPassesContrast(scheme: ColorScheme) {
            let fill = Palette.hex(.textPrimary, scheme)
            #expect(contrastRatio(Palette.hex(.pageBackground, scheme), fill) >= 4.5)
            #expect(contrastRatio(Palette.hex(.inverseAccent, scheme), fill) >= 4.5)
            #expect(resolved(Palette.inverseAccent, in: scheme) == Palette.hex(.inverseAccent, scheme).lowercased())
        }

        /// The Mac scrubber draws in palette roles, never a system fill.
        @Test func scrubberDrawsNoSystemFill() throws {
            let file = SourceScan.url(of: "Phone/Controls/PlaybackScrubber.swift")
            let text = SourceScan.withoutComments(try SourceScan.text(at: file))
            let track = try #require(text.range(of: "struct MacScrubberBar"))
            let body = text[track.lowerBound...]
            #expect(body.contains(".quaternary") == false)
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
