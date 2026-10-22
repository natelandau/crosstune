import ClerkKitUI
import SwiftUI

/// The colors a platform hands Clerk's sign-in, so the flow wears the app's palette while only
/// this module knows Clerk's theme.
public struct AuthPalette: Sendable {
    /// Focus rings and a focused field's border.
    public var accent: Color
    /// The primary button.
    public var accentFill: Color
    /// The primary button while pressed.
    public var accentFillPressed: Color
    public var onAccentFill: Color
    /// The sheet behind the flow.
    public var ground: Color
    /// Fields and muted panels.
    public var surface: Color
    public var ink: Color
    public var inkSecondary: Color
    /// The edge of a button that sits on the ground, such as a social sign-in.
    public var hairline: Color
    /// A notice over the flow, such as why the session ended.
    public var noticeFont: Font

    public init(
        accent: Color, accentFill: Color, accentFillPressed: Color, onAccentFill: Color, ground: Color,
        surface: Color, ink: Color, inkSecondary: Color, hairline: Color, noticeFont: Font
    ) {
        self.accent = accent
        self.accentFill = accentFill
        self.accentFillPressed = accentFillPressed
        self.onAccentFill = onAccentFill
        self.ground = ground
        self.surface = surface
        self.ink = ink
        self.inkSecondary = inkSecondary
        self.hairline = hairline
        self.noticeFont = noticeFont
    }
}

extension ClerkTheme {
    /// Clerk's theme in `palette`. Clerk draws a 4pt halo in the input border around a focused
    /// field, so that border is clear and focus shows as the accent border alone. Its buttons
    /// draw flat with a hairline edge and no shadow. Pressed is set rather than derived, since
    /// Clerk derives it from one appearance's resolved color.
    public static func crosstune(_ palette: AuthPalette) -> ClerkTheme {
        var colors = Colors(
            primary: palette.accentFill, background: palette.ground, input: palette.surface,
            foreground: palette.ink, mutedForeground: palette.inkSecondary,
            primaryForeground: palette.onAccentFill, inputForeground: palette.ink, neutral: palette.ink,
            ring: palette.accent, muted: palette.surface, secondaryButtonBackground: palette.surface,
            shadow: .clear, border: palette.ink)
        colors.primaryPressed = palette.accentFillPressed
        // The initializer's border is only the base Clerk fades for each derived edge, so the
        // edges that should read as a hairline are set outright.
        colors.border = palette.hairline
        colors.buttonBorder = palette.hairline
        colors.inputBorder = .clear
        colors.inputBorderFocused = palette.accent
        return ClerkTheme(colors: colors, design: Design(borderRadius: 8))
    }
}
