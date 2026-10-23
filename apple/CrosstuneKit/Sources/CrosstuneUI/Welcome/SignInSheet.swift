import CrosstuneAuth
import SwiftUI

/// Clerk's sign-in or sign-up flow in a sheet over the welcome screen.
struct SignInSheet: View {
    let mode: AuthMode

    var body: some View {
        #if os(macOS)
            // A dismissible AuthView sizes itself on the Mac, so the sheet takes Clerk's frame.
            SignInView(notice: nil, isDismissible: true, mode: mode, palette: .mac)
                .shellSheet()
        #else
            SignInView(notice: nil, isDismissible: true, mode: mode)
                .shellSheet()
        #endif
    }
}

#if os(macOS)
    extension AuthPalette {
        /// Clerk's flow in the Mac palette.
        static var mac: AuthPalette {
            let pressed = { (scheme: ColorScheme) in
                MacButtonStyle.fillRGB(for: .primary, scheme: scheme, isPressed: true)
                    ?? KeyColor.RGB(hex: Palette.hex(.accentFill, scheme))
            }
            return AuthPalette(
                accent: Palette.accent, accentFill: Palette.accentFill,
                accentFillPressed: Palette.dynamic(light: pressed(.light), dark: pressed(.dark)),
                onAccentFill: Palette.onAccentFill, ground: Palette.ground, surface: Palette.surface,
                ink: Palette.ink, inkSecondary: Palette.inkSecondary, hairline: Palette.hairline,
                noticeFont: MacStyle.secondary)
        }
    }
#endif
