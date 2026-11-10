#if os(macOS)
    import CrosstuneDesign
    import Foundation
    import SwiftUI
    import Testing

    @testable import CrosstuneUI

    @MainActor
    struct MacButtonStyleTests {
        private static let filledRoles: [MacButtonStyle.Role] = [.primary, .secondary, .destructiveFilled]

        /// An inactive window draws the same fills as a key one.
        @Test func styleNeverReadsWindowActiveState() throws {
            let file = SourceScan.files().first { $0.lastPathComponent == "MacButtonStyle.swift" }
            let text = SourceScan.withoutComments(try SourceScan.text(at: try #require(file)))
            #expect(text.contains("controlActiveState") == false)
            #expect(text.contains("appearsActive") == false)
        }

        private static let states: [MacPressState] = [.rest, .hover, .pressed]

        private static func rgb(_ token: Palette.Token, _ scheme: ColorScheme) -> KeyColor.RGB {
            KeyColor.RGB(hex: Palette.hex(token, scheme))
        }

        @Test(arguments: [ColorScheme.light, .dark], MacContainer.allCases)
        func everyRoleLabelPassesContrastOnItsFillInEveryContainer(
            scheme: ColorScheme, container: MacContainer
        ) throws {
            for role in Self.filledRoles + [.destructive] {
                let label = MacButtonStyle.labelRGB(for: role, scheme: scheme)
                for state in Self.states {
                    let fill = try #require(
                        MacButtonStyle.fillRGB(for: role, scheme: scheme, container: container, state: state))
                    #expect(contrastRatio(label, fill) >= 4.5, "\(role) \(state)")
                }
            }
        }

        /// A destructive Text button's words read on every container it sits on, since Text has
        /// no fill of its own.
        @Test(arguments: [ColorScheme.light, .dark])
        func destructiveTextPassesContrastOnEveryContainer(scheme: ColorScheme) {
            for role in [MacButtonStyle.Role.plain] {
                let label = MacButtonStyle.labelRGB(for: role, destructive: true, scheme: scheme)
                for container in MacContainer.allCases {
                    #expect(
                        contrastRatio(label, Self.rgb(container.fill, scheme)) >= 4.5, "\(role) on \(container)")
                }
            }
        }

        /// A disabled Filled button, plain or destructive, drops its fill for the outline; every
        /// other role fades as a whole.
        @Test func disabledFilledDrawsTheOutline() {
            for role in MacButtonStyle.Role.allCases {
                let filled = role == .primary || role == .destructiveFilled
                #expect(MacButtonStyle.dropsFillWhenDisabled(role) == filled, "\(role)")
            }
        }

        /// A toggle that is on shows it in shape: a circle in every state. Off, or not a toggle,
        /// draws no circle at rest.
        @Test(arguments: [ColorScheme.light, .dark], MacContainer.allCases)
        func aToggleOnShowsInShape(scheme: ColorScheme, container: MacContainer) {
            for state in Self.states {
                #expect(
                    MacButtonStyle.iconFillRGB(isOn: true, state: state, scheme: scheme, container: container) != nil,
                    "\(state)")
            }
            for isOn in [false, nil] as [Bool?] {
                #expect(
                    MacButtonStyle.iconFillRGB(isOn: isOn, state: .rest, scheme: scheme, container: container)
                        == nil)
            }
        }

        /// An icon's glyph holds 3:1 on whatever it sits on in every state, on or off.
        @Test(arguments: [ColorScheme.light, .dark], MacContainer.allCases)
        func iconGlyphPassesContrastInEveryState(scheme: ColorScheme, container: MacContainer) {
            for isOn in [true, false, nil] as [Bool?] {
                for state in Self.states {
                    let fill =
                        MacButtonStyle.iconFillRGB(isOn: isOn, state: state, scheme: scheme, container: container)
                        ?? Self.rgb(container.fill, scheme)
                    let glyph = MacButtonStyle.iconLabelRGB(isOn: isOn, state: state, scheme: scheme)
                    let name = "on: \(String(describing: isOn)) \(state)"
                    #expect(contrastRatio(glyph, fill) >= 3, "\(name)")
                }
            }
        }

        /// An icon button's circle keeps a pointer-sized 26pt at every size.
        @Test func iconCircleIsNeverUnder26() {
            for size in [MacButtonStyle.Size.small, .regular, .large] {
                #expect(size.iconDiameter >= 26, "\(size)")
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
    }
#endif
