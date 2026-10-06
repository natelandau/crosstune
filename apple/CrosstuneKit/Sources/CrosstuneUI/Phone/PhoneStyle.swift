import SwiftUI

/// The iPhone's practice ground, waveform, and control sizes.
public enum PhoneStyle {
    public static let practiceGroundLight = "#2D3142"
    public static let practiceGroundDark = "#1E212C"
    public static let waveUnplayed = "#BFC0C0"
    public static let wavePlayed = "#FFFFFF"

    /// The practice screen's jet-colored ground in `scheme`.
    public static func practiceGround(_ scheme: ColorScheme) -> Color {
        BrandStyle.color(hex: scheme == .dark ? practiceGroundDark : practiceGroundLight)
    }

    public static let transportPlayDiameter: CGFloat = 72
    public static let stopDiameter: CGFloat = 80
    public static let filterControlHeight: CGFloat = 32
    /// The widest a line of lyrics runs, so a long line stays easy to follow across.
    public static let lyricsMaxWidth: CGFloat = 600
    /// The smallest tap target.
    public static let minTarget: CGFloat = 44
    /// How far a horizontal drag must travel to skip.
    public static let swipeSkipThreshold: CGFloat = 60
    /// How long a new take stays highlighted.
    public static let newTakeHighlight: Duration = .milliseconds(1500)
}
