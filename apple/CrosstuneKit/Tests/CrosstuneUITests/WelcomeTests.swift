import CrosstuneAuth
import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct WelcomeTests {
    @Test func theHeadlineNamesTheDevice() {
        #expect(WelcomeCopy.headline(for: .phone) == "The tune list in your case, rebuilt for your phone.")
        #expect(WelcomeCopy.headline(for: .pad) == "The tune list in your case, rebuilt for your iPad.")
        #expect(WelcomeCopy.headline(for: .mac) == "The tune list in your case, rebuilt for your Mac.")
    }

    @Test func createAccountLeadsAndSignInFollows() {
        #expect(WelcomeButton.allCases.map(\.label) == [WelcomeCopy.createAccount, WelcomeCopy.signIn])
        #expect(WelcomeButton.allCases.filter(\.isProminent).map(\.label) == [WelcomeCopy.createAccount])
        #expect(WelcomeButton.allCases.filter { !$0.isProminent }.map(\.label) == [WelcomeCopy.signIn])
    }

    @Test func eachButtonOpensItsOwnFlow() {
        #expect(WelcomeButton.createAccount.mode == .signUp)
        #expect(WelcomeButton.signIn.mode == .signIn)
    }

    @Test func thePictureYieldsAtAccessibilitySizes() {
        #expect(WelcomeLayout.showsPicture(.large))
        #expect(WelcomeLayout.showsPicture(.xxxLarge))
        #expect(!WelcomeLayout.showsPicture(.accessibility1))
        #expect(!WelcomeLayout.showsPicture(.accessibility5))
    }
}

#if os(macOS)
    import AppKit
    import ClerkKitUI

    @MainActor
    @Suite struct MacClerkThemeTests {
        /// `color`'s sRGB hex and alpha as drawn in `appearance`.
        private func resolved(_ color: Color, in appearance: NSAppearance.Name) -> (hex: String, alpha: Double)? {
            var result: (String, Double)?
            NSAppearance(named: appearance)?.performAsCurrentDrawingAppearance {
                result = NSColor(color).usingColorSpace(.sRGB).map {
                    (
                        KeyColor.RGB(
                            red: Double($0.redComponent), green: Double($0.greenComponent),
                            blue: Double($0.blueComponent)
                        ).hex, Double($0.alphaComponent)
                    )
                }
            }
            return result
        }

        @Test(arguments: [(NSAppearance.Name.aqua, ColorScheme.light), (.darkAqua, .dark)])
        func clerkThemeUsesMacTokens(appearance: NSAppearance.Name, scheme: ColorScheme) {
            let theme = ClerkTheme.crosstune(.mac)
            let colors = theme.colors
            let expected: [(Color, Palette.Token, String)] = [
                (colors.primary, .accentFill, "primary"), (colors.ring, .accent, "ring"),
                (colors.inputBorderFocused, .accent, "inputBorderFocused"), (colors.background, .ground, "background"),
                (colors.input, .surface, "input"), (colors.muted, .surface, "muted"),
                (colors.foreground, .ink, "foreground"), (colors.neutral, .ink, "neutral"),
                (colors.inputForeground, .ink, "inputForeground"),
                (colors.mutedForeground, .inkSecondary, "mutedForeground"),
                (colors.primaryForeground, .onAccentFill, "primaryForeground"),
            ]
            for (color, token, name) in expected {
                #expect(resolved(color, in: appearance)?.hex == Palette.hex(token, scheme).lowercased(), "\(name)")
            }
            // The 4pt halo Clerk draws around a field is the input border; it stays clear.
            #expect(resolved(colors.inputBorder, in: appearance)?.alpha == 0)
            // Pressed follows the Mac primary button's pressed fill in each appearance.
            let pressed = MacButtonStyle.fillRGB(for: .primary, scheme: scheme, isPressed: true)
            #expect(resolved(colors.primaryPressed, in: appearance)?.hex == pressed?.hex)
            #expect(theme.design.borderRadius == 8)
        }
    }
#endif
