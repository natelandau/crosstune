import SwiftUI

/// The type and spacing a document page (a tune, a recording) draws with. The Mac uses fixed
/// point sizes; iPhone uses text styles so type follows Dynamic Type.
enum PageStyle {
    #if os(macOS)
        static let body = MacStyle.body
        static let secondary = MacStyle.secondary
        static let sectionHeading = MacStyle.sectionHeading
        static let pageTitle = MacStyle.pageTitle
        static let sectionGap = MacStyle.sectionGap
        static let headingGap = MacStyle.headingGap
        static let smallControlHeight = MacStyle.smallControlHeight
        static let filterControlHeight = MacStyle.smallControlHeight
        /// A pointer needs no hit area past a control's drawn edge.
        static let minTarget: CGFloat = 0
        static let pullDownChevron = Font.system(size: 9, weight: .semibold)
        static let popoverArrowEdge = Edge.bottom
        static let pageMargin = MacStyle.pageMargin
        static let pageMaxWidth = MacStyle.pageMaxWidth
        /// A window has no bar title over the page, so a page with no title of its own heads itself.
        static let pageHeadsItself = true
        /// How far below its place a page's title starts as the page arrives.
        static let titleRise: CGFloat = 6
        /// The Mac allows only a few signature moments, so its filters and handles stay still.
        static let animatesPhoneMotion = false
        static let headingControlsUseGlass = true
        static let headingControlHeight = MacStyle.smallControlHeight
        /// A Mac sheet closes with its button and Escape, never a swipe.
        static let practiceClosesBySwipe = false
        /// The key grid spreads across the row whenever it fits, rather than hugging the
        /// leading edge.
        static let keyGridSpreads = true
        /// AppKit draws a prominent button's fill, gray in an inactive window, so its label
        /// keeps the system's color.
        static let prominentLabelOnSlate = false
    #else
        static let body = Font.body
        static let secondary = Font.subheadline
        static let sectionHeading = Font.title3.weight(.semibold)
        static let pageTitle = Font.largeTitle.bold()
        static let sectionGap: CGFloat = 28
        static let headingGap: CGFloat = 8
        static let smallControlHeight: CGFloat = 32
        static let filterControlHeight = PhoneStyle.filterControlHeight
        static let minTarget = minimumTapTarget
        static let pullDownChevron = Font.caption2.weight(.semibold)
        /// The popover opens below its control, where a phone has the most room.
        static let popoverArrowEdge = Edge.top
        static let pageMargin: CGFloat = 20
        static let pageMaxWidth: CGFloat = 680
        /// The navigation bar carries the title of a pushed page.
        static let pageHeadsItself = false
        /// The pushed page arrives by its own transition, so its title needs no rise.
        static let titleRise: CGFloat = 0
        static let animatesPhoneMotion = true
        /// A heading's controls draw as plain tinted glyphs and words: a menu draws any glass in
        /// its label at the label's full frame, so glass would not stay smaller than the frame
        /// that takes the taps.
        static let headingControlsUseGlass = false
        /// A heading control's frame is its whole hit area, since a menu takes taps only there.
        static let headingControlHeight = minimumTapTarget
        static let practiceClosesBySwipe = true
        /// The key grid keeps its natural width and scrolls sideways once it outgrows the row.
        static let keyGridSpreads = false
        static let prominentLabelOnSlate = true
    #endif

    /// The space between lines of tokens drawn at ``smallControlHeight``: at least `base`, and
    /// enough that their hit areas, reaching to ``minTarget``, meet without overlapping.
    static func tokenLineGap(_ base: CGFloat) -> CGFloat {
        max(base, minTarget - smallControlHeight)
    }
}
