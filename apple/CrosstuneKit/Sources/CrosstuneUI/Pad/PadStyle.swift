import SwiftUI

/// The iPad's layout tokens: the proportions and sizes its screens share.
public enum PadStyle {
    /// The practice pane's share of the Stand's width in landscape.
    public static let standPracticeShare: CGFloat = 0.6
    /// The reading pane's share of the Stand's height in portrait.
    public static let standReadingShare: CGFloat = 0.55
    /// The least share of the height the stacked reading pane keeps when practice's controls
    /// want more; at the largest text sizes the controls scroll instead.
    public static let standReadingMinShare: CGFloat = 0.25
    /// The widest the practice controls grow when practice has the Stand to itself.
    public static let standControlsMaxWidth: CGFloat = 640
    /// A scan thumbnail's height on a regular-width tune page.
    public static let scanThumbnailHeight: CGFloat = 180
    /// The content column's share of a tab's width, held between its narrowest and widest.
    public static let contentColumnShare: CGFloat = 0.36
    public static let contentColumnMinWidth: CGFloat = 320
    public static let contentColumnMaxWidth: CGFloat = 360

    /// The content column's width in a tab `width` wide.
    public static func contentColumnWidth(in width: CGFloat) -> CGFloat {
        min(max(width * contentColumnShare, contentColumnMinWidth), contentColumnMaxWidth)
    }

    /// The foot capsule's height, Record and the player alike.
    public static let footHeight: CGFloat = 52
    /// The widest the foot capsule grows once the player joins Record.
    public static let footMaxWidth: CGFloat = 560
    /// The least room between the foot capsule and the window's sides.
    public static let footSideMargin: CGFloat = 16
    /// The room on each side of Record's dot and name inside the capsule.
    public static let footRecordPadding: CGFloat = 20
    /// The gap between Record's dot and its name.
    public static let footRecordSpacing: CGFloat = 8
    /// How far the divider between Record and the player stops short of the capsule's top and
    /// bottom.
    public static let footDividerInset: CGFloat = 10
    /// The text sizes the foot capsule scales through; its height is fixed, so larger text would spill out.
    public static let footTextSizes = ...DynamicTypeSize.accessibility1
    /// The gap below the foot capsule and between it and the last row above.
    public static let footInset: CGFloat = 8
    /// The room every column leaves under its last row for the foot capsule.
    public static let footClearance: CGFloat = footHeight + 2 * footInset
}
