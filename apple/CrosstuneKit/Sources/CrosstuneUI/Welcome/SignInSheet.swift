import CrosstuneAuth
import SwiftUI

/// Clerk's sign-in or sign-up flow in a sheet over the welcome screen.
struct SignInSheet: View {
    let mode: AuthMode

    private var notice: String? { mode == .signUp ? WelcomeCopy.emailNotice : nil }

    var body: some View {
        #if os(macOS)
            // A dismissible AuthView sizes itself on the Mac, so the sheet sets no frame: a
            // narrower one clips the flow.
            SignInView(notice: notice, isDismissible: true, mode: mode, palette: .mac)
                .shellSheet()
        #else
            SignInView(notice: notice, isDismissible: true, mode: mode)
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
                onAccentFill: Palette.onAccentFill, pageBackground: Palette.pageBackground,
                surface: Palette.surface, textPrimary: Palette.textPrimary, textSecondary: Palette.textSecondary,
                border: Palette.border,
                noticeFont: MacStyle.secondary)
        }
    }
#endif
