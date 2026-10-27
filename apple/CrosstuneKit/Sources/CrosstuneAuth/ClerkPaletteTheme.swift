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
    public var pageBackground: Color
    /// Fields and muted panels.
    public var surface: Color
    public var textPrimary: Color
    public var textSecondary: Color
    /// The edge of a button that sits on the page background, such as a social sign-in.
    public var border: Color
    /// A notice over the flow, such as why the session ended.
    public var noticeFont: Font

    public init(
        accent: Color, accentFill: Color, accentFillPressed: Color, onAccentFill: Color,
        pageBackground: Color, surface: Color, textPrimary: Color, textSecondary: Color, border: Color,
        noticeFont: Font
    ) {
        self.accent = accent
        self.accentFill = accentFill
        self.accentFillPressed = accentFillPressed
        self.onAccentFill = onAccentFill
        self.pageBackground = pageBackground
        self.surface = surface
        self.textPrimary = textPrimary
        self.textSecondary = textSecondary
        self.border = border
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
            primary: palette.accentFill, background: palette.pageBackground, input: palette.surface,
            foreground: palette.textPrimary, mutedForeground: palette.textSecondary,
            primaryForeground: palette.onAccentFill, inputForeground: palette.textPrimary, neutral: palette.textPrimary,
            ring: palette.accent, muted: palette.surface, secondaryButtonBackground: palette.surface,
            shadow: .clear, border: palette.textPrimary)
        colors.primaryPressed = palette.accentFillPressed
        // The initializer's border is only the base Clerk fades for each derived edge, so the
        // edges that should read as a hairline are set outright.
        colors.border = palette.border
        colors.buttonBorder = palette.border
        colors.inputBorder = .clear
        colors.inputBorderFocused = palette.accent
        return ClerkTheme(colors: colors, design: Design(borderRadius: 8))
    }
}
