#if os(macOS)
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor
    @Suite struct MacButtonStyleTests {
        private static let filledRoles: [MacButtonStyle.Role] = [.primary, .secondary, .destructiveFilled]

        /// The primary's fill depends only on the role and the press, never on the window. A
        /// disabled filled role drops its fill for a ring; the others fade as a whole.
        @Test(arguments: [ColorScheme.light, .dark])
        func primaryFillReadsOnlyTheRoleAndThePress(scheme: ColorScheme) throws {
            let fill = try #require(
                MacButtonStyle.fillRGB(for: .primary, scheme: scheme, isPressed: false))
            #expect(fill.hex == Palette.hex(.accentFill, scheme).lowercased())
            #expect(MacButtonStyle.disabledOpacity == 0.45)
            #expect(MacButtonStyle.dropsFillWhenDisabled(.primary))
            #expect(MacButtonStyle.dropsFillWhenDisabled(.destructiveFilled))
            #expect(!MacButtonStyle.dropsFillWhenDisabled(.secondary))
        }

        /// An inactive window draws the same fills as a key one.
        @Test func styleNeverReadsWindowActiveState() throws {
            let file = SourceScan.files().first { $0.lastPathComponent == "MacButtonStyle.swift" }
            let text = SourceScan.withoutComments(try SourceScan.text(at: try #require(file)))
            #expect(!text.contains("controlActiveState"))
            #expect(!text.contains("appearsActive"))
        }

        @Test(arguments: [ColorScheme.light, .dark])
        func everyRoleLabelPassesContrastOnItsFillInEveryContainer(scheme: ColorScheme) throws {
            for container in MacContainer.allCases {
                for role in Self.filledRoles {
                    let label = MacButtonStyle.labelRGB(for: role, scheme: scheme)
                    for isPressed in [false, true] {
                        let fill = try #require(
                            MacButtonStyle.fillRGB(
                                for: role, scheme: scheme, container: container, isPressed: isPressed))
                        #expect(contrastRatio(label, fill) >= 4.5, "\(role) in \(container) pressed: \(isPressed)")
                    }
                }
            }
        }

        /// A destructive button draws nothing at rest and the danger role's subtle fill under the
        /// pointer or a press, with its red label holding 4.5:1 on that fill in every container.
        @Test(arguments: [ColorScheme.light, .dark])
        func destructiveTakesTheSubtleDangerFill(scheme: ColorScheme) throws {
            let label = MacButtonStyle.labelRGB(for: .destructive, scheme: scheme)
            for container in MacContainer.allCases {
                #expect(
                    MacButtonStyle.fillRGB(for: .destructive, scheme: scheme, container: container, isPressed: false)
                        == nil)
                let fill = try #require(
                    MacButtonStyle.fillRGB(for: .destructive, scheme: scheme, container: container, isPressed: true))
                let expected = Palette.mixHex(
                    Palette.hex(container.fill, scheme), toward: Palette.hex(.danger, scheme),
                    share: Palette.subtleOpacity)
                #expect(fill.hex == expected)
                #expect(contrastRatio(label, fill) >= 4.5, "\(container)")
            }
        }

        /// A secondary button on a `surface` card or footer takes the raised fill, lighter than
        /// the surface, never the `field` that reads gray on gray; on `pageBackground` it keeps `field`.
        @Test(arguments: [ColorScheme.light, .dark])
        func secondaryFillsContrastWithTheirContainer(scheme: ColorScheme) throws {
            for role in [MacButtonStyle.Role.secondary] {
                let onPageBackground = try #require(
                    MacButtonStyle.fillRGB(
                        for: role, scheme: scheme, container: .pageBackground, isPressed: false))
                #expect(onPageBackground.hex == Palette.hex(.field, scheme).lowercased())
                let onSurface = try #require(
                    MacButtonStyle.fillRGB(
                        for: role, scheme: scheme, container: .surface, isPressed: false))
                #expect(onSurface.hex == Palette.hex(.surfaceRaised, scheme).lowercased())
                #expect(relativeLuminance(onSurface.hex) > relativeLuminance(Palette.hex(.surface, scheme)))
            }
        }

        /// On a light card the raised fill sits close to the surface, so fields and secondary
        /// buttons take a hairline edge there; dark and the page background draw none.
        @Test func onlyALightSurfaceEdgesItsControls() {
            #expect(MacContainer.surface.strokesControls(.light))
            #expect(!MacContainer.surface.strokesControls(.dark))
            #expect(!MacContainer.pageBackground.strokesControls(.light))
            #expect(!MacContainer.pageBackground.strokesControls(.dark))
            #expect(MacButtonStyle.strokesOn(.secondary))
            for role in [MacButtonStyle.Role.primary, .plain, .quiet, .icon, .destructive, .destructiveFilled] {
                #expect(!MacButtonStyle.strokesOn(role), "\(role)")
            }
        }

        /// Plain and icon buttons draw on their container, and an icon's hover circle takes the
        /// container's control fill, so their labels pass on every one.
        @Test(arguments: [ColorScheme.light, .dark])
        func unfilledLabelsPassContrastOnEveryContainer(scheme: ColorScheme) {
            for role in [MacButtonStyle.Role.plain, .quiet, .icon, .destructive] {
                let label = MacButtonStyle.labelRGB(for: role, scheme: scheme).hex
                for container in MacContainer.allCases {
                    for background in [container.fill, container.controlFill] {
                        #expect(
                            contrastRatio(label, Palette.hex(background, scheme)) >= 4.5, "\(role) on \(background)")
                    }
                }
            }
        }

        /// A press mixes in the primary text color: darker in light mode, lighter in dark mode.
        @Test(arguments: [ColorScheme.light, .dark])
        func pressedPrimaryTakesTheHoverOverlay(scheme: ColorScheme) throws {
            let rest = try #require(
                MacButtonStyle.fillRGB(for: .primary, scheme: scheme, isPressed: false))
            let pressed = try #require(
                MacButtonStyle.fillRGB(for: .primary, scheme: scheme, isPressed: true))
            #expect(
                pressed.hex
                    == Palette.mixHex(
                        rest.hex, toward: Palette.hex(.textPrimary, scheme), share: MacButtonStyle.pressedOverlay))
            let darker = relativeLuminance(pressed.hex) < relativeLuminance(rest.hex)
            #expect(darker == (scheme == .light))
        }

        @Test func sizesFollowThePointerScale() {
            #expect(MacButtonStyle.Size.small.height == 24)
            #expect(MacButtonStyle.Size.regular.height == 28)
            #expect(MacButtonStyle.Size.large.height == 32)
        }

        /// An icon button's hover circle keeps a pointer-sized 26pt at every size.
        @Test func iconCircleIsNeverUnder26() {
            #expect(MacButtonStyle.Size.small.iconDiameter == 26)
            #expect(MacButtonStyle.Size.regular.iconDiameter == 28)
            #expect(MacButtonStyle.Size.large.iconDiameter == 32)
            #expect(PageStyle.headingControlHeight == MacButtonStyle.Size.small.iconDiameter)
        }

        /// The destructive roles take the app's one danger red, never a new one, and a filled one
        /// takes the label on a status fill.
        @Test(arguments: [ColorScheme.light, .dark])
        func destructiveRolesUseTheDangerRed(scheme: ColorScheme) throws {
            let danger = KeyColor.RGB(hex: Palette.hex(.danger, scheme))
            #expect(MacButtonStyle.labelRGB(for: .destructive, scheme: scheme) == danger)
            let filled = try #require(
                MacButtonStyle.fillRGB(for: .destructiveFilled, scheme: scheme, isPressed: false))
            #expect(filled == danger)
            #expect(
                MacButtonStyle.labelRGB(for: .destructiveFilled, scheme: scheme)
                    == KeyColor.RGB(hex: Palette.hex(.onStatus, scheme)))
        }
    }
#endif
