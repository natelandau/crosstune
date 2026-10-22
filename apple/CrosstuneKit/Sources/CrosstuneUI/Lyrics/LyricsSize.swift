import CoreGraphics

/// The reading view's own text scale: an absolute size for a phone propped on a music stand, not
/// a multiplier on the app's Dynamic Type setting, which sets the distance for reading in the
/// hand. Stored per device, like ``Appearance``, since it needs no account.
public enum LyricsSize {
    public static let steps = 6
    public static let defaultStep = 4
    public static let storageKey = "crosstune.lyricsSize"

    /// Each step's base point size, before Dynamic Type scales it further.
    private static let points: [CGFloat] = [18, 22, 26, 32, 38, 44]

    public static func clamp(_ step: Int) -> Int {
        min(steps, max(1, step))
    }

    /// Whether a smaller step is left below `step`.
    public static func canShrink(_ step: Int) -> Bool { clamp(step) > 1 }

    /// Whether a larger step is left above `step`.
    public static func canGrow(_ step: Int) -> Bool { clamp(step) < steps }

    public static func pointSize(for step: Int) -> CGFloat {
        points[clamp(step) - 1]
    }
}
