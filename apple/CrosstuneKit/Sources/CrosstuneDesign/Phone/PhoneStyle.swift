import SwiftUI

/// The iPhone's practice control sizes and timings.
public enum PhoneStyle {
    public static let transportPlayDiameter: CGFloat = 72
    public static let stopDiameter: CGFloat = 80
    public static let filterControlHeight: CGFloat = 32
    /// The widest a line of lyrics runs, so a long line stays easy to follow across.
    public static let lyricsMaxWidth: CGFloat = 600
    /// How far a horizontal drag must travel to skip.
    public static let swipeSkipThreshold: CGFloat = 60
    /// How long a new recording stays highlighted.
    public static let newRecordingHighlight: Duration = .milliseconds(1500)
}
