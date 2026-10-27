#if os(macOS)
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor
    @Suite struct MacButtonStyleTests {
        private static let filledRoles: [MacButtonStyle.Role] = [
            .primary, .secondary, .destructive, .destructiveFilled,
        ]

        /// A disabled primary keeps the accent fill, which nothing but the role and the press
        /// decides, and fades as a whole, so it never reads as a gray button.
        @Test(arguments: [ColorScheme.light, .dark])
        func primaryKeepsItsFillWhenInactiveAndDisabled(scheme: ColorScheme) throws {
            let disabled = try #require(
                MacButtonStyle.fillRGB(for: .primary, scheme: scheme, isPressed: false))
            #expect(disabled.hex == Palette.hex(.accentFill, scheme).lowercased())
            #expect(MacButtonStyle.disabledOpacity == 0.45)
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

        /// A secondary button on a `surface` card or footer takes the raised fill, lighter than
        /// the surface, never the `field` that reads gray on gray; on `pageBackground` it keeps `field`.
        @Test(arguments: [ColorScheme.light, .dark])
        func secondaryFillsContrastWithTheirContainer(scheme: ColorScheme) throws {
            for role in [MacButtonStyle.Role.secondary, .destructive] {
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
            #expect(MacButtonStyle.strokesOn(.secondary) && MacButtonStyle.strokesOn(.destructive))
            for role in [MacButtonStyle.Role.primary, .plain, .quiet, .icon, .destructiveFilled] {
                #expect(!MacButtonStyle.strokesOn(role), "\(role)")
            }
        }

        /// Plain and icon buttons draw on their container, and an icon's hover circle takes the
        /// container's control fill, so their labels pass on every one.
        @Test(arguments: [ColorScheme.light, .dark])
        func unfilledLabelsPassContrastOnEveryContainer(scheme: ColorScheme) {
            for role in [MacButtonStyle.Role.plain, .quiet, .icon] {
                let label = MacButtonStyle.labelRGB(for: role, scheme: scheme).hex
                for container in MacContainer.allCases {
                    for background in [container.fill, container.controlFill] {
                        #expect(
                            contrastRatio(label, Palette.hex(background, scheme)) >= 4.5, "\(role) on \(background)")
                    }
                }
            }
        }

        @Test(arguments: [ColorScheme.light, .dark])
        func pressedPrimaryDarkens(scheme: ColorScheme) throws {
            let rest = try #require(
                MacButtonStyle.fillRGB(for: .primary, scheme: scheme, isPressed: false))
            let pressed = try #require(
                MacButtonStyle.fillRGB(for: .primary, scheme: scheme, isPressed: true))
            #expect(
                contrastRatio(pressed, KeyColor.RGB(hex: "#000000")) < contrastRatio(rest, KeyColor.RGB(hex: "#000000"))
            )
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

        /// The destructive roles take the app's one danger red, never a new one.
        @Test(arguments: [ColorScheme.light, .dark])
        func destructiveRolesUseTheDangerRed(scheme: ColorScheme) throws {
            #expect(
                MacButtonStyle.labelRGB(for: .destructive, scheme: scheme) == StatusCapsuleColors.danger(scheme).text)
            let filled = try #require(
                MacButtonStyle.fillRGB(for: .destructiveFilled, scheme: scheme, isPressed: false))
            #expect(filled == StatusCapsuleColors.danger(.light).text)
        }
    }
#endif
