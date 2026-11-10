#if os(macOS)
    import CrosstuneDesign
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor
    @Suite struct MacButtonStyleTests {
        private static let filledRoles: [MacButtonStyle.Role] = [.primary, .secondary, .destructiveFilled]

        /// The primary's fill depends only on the role and the press, never on the window.
        @Test(arguments: [ColorScheme.light, .dark])
        func primaryFillReadsOnlyTheRoleAndThePress(scheme: ColorScheme) throws {
            let fill = try #require(
                MacButtonStyle.fillRGB(for: .primary, scheme: scheme, state: .rest))
            #expect(fill.hex == Palette.hex(.accentFill, scheme).lowercased())
        }

        /// An inactive window draws the same fills as a key one.
        @Test func styleNeverReadsWindowActiveState() throws {
            let file = SourceScan.files().first { $0.lastPathComponent == "MacButtonStyle.swift" }
            let text = SourceScan.withoutComments(try SourceScan.text(at: try #require(file)))
            #expect(!text.contains("controlActiveState"))
            #expect(!text.contains("appearsActive"))
        }

        private static let states: [MacPressState] = [.rest, .hover, .pressed]

        private static func rgb(_ token: Palette.Token, _ scheme: ColorScheme) -> KeyColor.RGB {
            KeyColor.RGB(hex: Palette.hex(token, scheme))
        }

        @Test(arguments: [ColorScheme.light, .dark])
        func everyRoleLabelPassesContrastOnItsFillInEveryContainer(scheme: ColorScheme) throws {
            for container in MacContainer.allCases {
                for role in Self.filledRoles + [.destructive] {
                    let label = MacButtonStyle.labelRGB(for: role, scheme: scheme)
                    for state in Self.states {
                        let fill = try #require(
                            MacButtonStyle.fillRGB(for: role, scheme: scheme, container: container, state: state))
                        #expect(contrastRatio(label, fill) >= 4.5, "\(role) in \(container) \(state)")
                    }
                }
            }
        }

        /// Tinted takes the tint over its container under the tint's label, and steps to
        /// `tintStrong` under the pointer and a press, never an overlay on the tint.
        @Test(arguments: [ColorScheme.light, .dark])
        func tintedFillsWithTheTint(scheme: ColorScheme) throws {
            let accent = Self.rgb(.accent, scheme)
            for container in MacContainer.allCases {
                let base = Self.rgb(container.fill, scheme)
                for state in Self.states {
                    let fill = try #require(
                        MacButtonStyle.fillRGB(for: .secondary, scheme: scheme, container: container, state: state))
                    let opacity = state == .rest ? Palette.tintOpacity(scheme) : Palette.tintStrongOpacity(scheme)
                    #expect(fill.hex == blend(accent.hex, over: base.hex, opacity: opacity), "\(container) \(state)")
                }
            }
            let onTint: Palette.Token = Palette.onTintIsAccent(scheme) ? .accent : .textPrimary
            #expect(MacButtonStyle.labelRGB(for: .secondary, scheme: scheme) == Self.rgb(onTint, scheme))
        }

        /// A destructive Text button draws its words in `danger`, readable on every container
        /// it sits on, since Text has no fill of its own.
        @Test(arguments: [ColorScheme.light, .dark])
        func destructiveTextIsDangerOnEveryContainer(scheme: ColorScheme) {
            for role in [MacButtonStyle.Role.plain] {
                let label = MacButtonStyle.labelRGB(for: role, destructive: true, scheme: scheme)
                #expect(label == Self.rgb(.danger, scheme), "\(role)")
                for container in MacContainer.allCases {
                    #expect(
                        contrastRatio(label, Self.rgb(container.fill, scheme)) >= 4.5, "\(role) on \(container)")
                }
            }
        }

        /// Plain and quiet are one Text look: the accent, with no fill in any state.
        @Test(arguments: [ColorScheme.light, .dark])
        func textRolesShareOneLook(scheme: ColorScheme) {
            let accent = Self.rgb(.accent, scheme)
            for role in [MacButtonStyle.Role.plain] {
                #expect(MacButtonStyle.labelRGB(for: role, scheme: scheme) == accent, "\(role)")
                for state in Self.states {
                    #expect(MacButtonStyle.fillRGB(for: role, scheme: scheme, state: state) == nil, "\(role) \(state)")
                }
            }
        }

        /// Tinted destructive sits on the container's control fill, with its edge, and takes the
        /// danger role's subtle fill under the pointer and a press, where an overlay would leave
        /// its red label short of 4.5:1.
        @Test(arguments: [ColorScheme.light, .dark])
        func destructiveSitsOnTheControlFill(scheme: ColorScheme) throws {
            for container in MacContainer.allCases {
                let rest = try #require(
                    MacButtonStyle.fillRGB(for: .destructive, scheme: scheme, container: container, state: .rest))
                #expect(rest == Self.rgb(container.controlFill, scheme), "\(container)")
                let subtle = blend(
                    Palette.hex(.danger, scheme), over: Palette.hex(container.fill, scheme),
                    opacity: Palette.subtleOpacity)
                for state in [MacPressState.hover, .pressed] {
                    let fill = try #require(
                        MacButtonStyle.fillRGB(for: .destructive, scheme: scheme, container: container, state: state))
                    #expect(fill.hex == subtle, "\(container) \(state)")
                }
            }
        }

        /// A filled role lays the hover overlay under the pointer and the pressed overlay on a
        /// press, each straight over the rest fill; an icon's circle takes the pressed overlay
        /// on the control fill.
        @Test(arguments: [ColorScheme.light, .dark])
        func pressIsTheOverlayNotAMix(scheme: ColorScheme) throws {
            let text = Palette.hex(.textPrimary, scheme)
            for container in MacContainer.allCases {
                let rests: [(MacButtonStyle.Role, String)] = [
                    (.primary, Palette.hex(.accentFill, scheme)),
                    (.destructiveFilled, Palette.hex(.danger, scheme)),
                ]
                for (role, rest) in rests {
                    func fill(_ state: MacPressState) throws -> String {
                        try #require(
                            MacButtonStyle.fillRGB(for: role, scheme: scheme, container: container, state: state)
                        ).hex
                    }
                    #expect(try fill(.rest) == rest.lowercased(), "\(role)")
                    #expect(
                        try fill(.hover) == blend(text, over: rest, opacity: Palette.hoverOverlayOpacity), "\(role)")
                    #expect(
                        try fill(.pressed) == blend(text, over: rest, opacity: Palette.pressedOverlayOpacity),
                        "\(role)")
                }
            }
            for container in MacContainer.allCases {
                let control = Palette.hex(container.controlFill, scheme)
                let hover = MacButtonStyle.fillRGB(for: .icon, scheme: scheme, container: container, state: .hover)
                let pressed = MacButtonStyle.fillRGB(
                    for: .icon, scheme: scheme, container: container, state: .pressed)
                #expect(hover?.hex == control.lowercased(), "\(container)")
                #expect(
                    pressed?.hex == blend(text, over: control, opacity: Palette.pressedOverlayOpacity), "\(container)")
            }
            #expect(
                MacButtonStyle.fillRGB(for: .primary, scheme: scheme, state: .pressed)
                    == MacButtonStyle.fillRGB(for: .primary, scheme: scheme, state: .pressed))
        }

        /// A disabled Filled button, plain or destructive, drops its fill for the outline; every
        /// other role fades as a whole.
        @Test func disabledFilledDrawsTheOutline() {
            for role in MacButtonStyle.Role.allCases {
                let filled = role == .primary || role == .destructiveFilled
                #expect(MacButtonStyle.dropsFillWhenDisabled(role) == filled, "\(role)")
            }
        }

        /// A toggle that is on shows it in shape: the tint circle at rest, `tintStrong` under
        /// the pointer. Off, or not a toggle, draws no circle at rest.
        @Test(arguments: [ColorScheme.light, .dark])
        func aToggleOnShowsInShape(scheme: ColorScheme) throws {
            let accent = Palette.hex(.accent, scheme)
            for container in MacContainer.allCases {
                let base = Palette.hex(container.fill, scheme)
                for state in Self.states {
                    let on = try #require(
                        MacButtonStyle.iconFillRGB(isOn: true, state: state, scheme: scheme, container: container))
                    let opacity = state == .rest ? Palette.tintOpacity(scheme) : Palette.tintStrongOpacity(scheme)
                    #expect(on.hex == blend(accent, over: base, opacity: opacity), "\(container) \(state)")
                }
                for isOn in [false, nil] as [Bool?] {
                    #expect(
                        MacButtonStyle.iconFillRGB(isOn: isOn, state: .rest, scheme: scheme, container: container)
                            == nil)
                }
            }
        }

        /// An icon's glyph holds 3:1 on whatever it sits on in every state, on or off.
        @Test(arguments: [ColorScheme.light, .dark])
        func iconGlyphPassesContrastInEveryState(scheme: ColorScheme) {
            for container in MacContainer.allCases {
                for isOn in [true, false, nil] as [Bool?] {
                    for state in Self.states {
                        let fill =
                            MacButtonStyle.iconFillRGB(isOn: isOn, state: state, scheme: scheme, container: container)
                            ?? Self.rgb(container.fill, scheme)
                        let glyph = MacButtonStyle.iconLabelRGB(isOn: isOn, state: state, scheme: scheme)
                        let name = "\(container) on: \(String(describing: isOn)) \(state)"
                        #expect(contrastRatio(glyph, fill) >= 3, "\(name)")
                    }
                }
            }
        }

        /// An icon button's circle keeps a pointer-sized 26pt at every size, and a section
        /// heading's controls line up with the small one.
        @Test func iconCircleIsNeverUnder26() {
            for size in [MacButtonStyle.Size.small, .regular, .large] {
                #expect(size.iconDiameter >= 26, "\(size)")
            }
            #expect(PageStyle.headingControlHeight == MacButtonStyle.Size.small.iconDiameter)
        }

        /// On a light card the raised fill sits close to the surface, so fields and controls on
        /// the control fill take a hairline edge there; dark and the page background draw none.
        @Test func onlyALightSurfaceEdgesItsControls() {
            #expect(MacContainer.surface.strokesControls(.light))
            #expect(!MacContainer.surface.strokesControls(.dark))
            #expect(!MacContainer.pageBackground.strokesControls(.light))
            #expect(!MacContainer.pageBackground.strokesControls(.dark))
            for role in MacButtonStyle.Role.allCases {
                #expect(MacButtonStyle.strokesOn(role) == (role == .destructive), "\(role)")
            }
        }

        /// Text and icon buttons draw on their container, and an icon's hover circle takes the
        /// container's control fill, so their labels pass on every one.
        @Test(arguments: [ColorScheme.light, .dark])
        func unfilledLabelsPassContrastOnEveryContainer(scheme: ColorScheme) {
            for role in [MacButtonStyle.Role.plain, .icon] {
                let label = MacButtonStyle.labelRGB(for: role, scheme: scheme).hex
                for container in MacContainer.allCases {
                    for background in [container.fill, container.controlFill] {
                        #expect(
                            contrastRatio(label, Palette.hex(background, scheme)) >= 4.5, "\(role) on \(background)")
                    }
                }
            }
        }

        /// The destructive roles take the app's one danger red, never a new one, and a filled one
        /// takes the label on a status fill.
        @Test(arguments: [ColorScheme.light, .dark])
        func destructiveRolesUseTheDangerRed(scheme: ColorScheme) throws {
            let danger = KeyColor.RGB(hex: Palette.hex(.danger, scheme))
            #expect(MacButtonStyle.labelRGB(for: .destructive, scheme: scheme) == danger)
            let filled = try #require(
                MacButtonStyle.fillRGB(for: .destructiveFilled, scheme: scheme, state: .rest))
            #expect(filled == danger)
            #expect(
                MacButtonStyle.labelRGB(for: .destructiveFilled, scheme: scheme)
                    == KeyColor.RGB(hex: Palette.hex(.onStatus, scheme)))
        }
    }
#endif
