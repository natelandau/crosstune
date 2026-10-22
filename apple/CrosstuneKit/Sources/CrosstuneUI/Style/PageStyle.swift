import SwiftUI

/// The type and spacing a document page (a tune, a recording) draws with. The Mac uses fixed
/// point sizes; iPhone uses text styles so type follows Dynamic Type.
enum PageStyle {
    #if os(macOS)
        static let body = MacStyle.body
        static let secondary = MacStyle.secondary
        static let sectionHeading = MacStyle.sectionHeading
        /// The space above a group's heading in a list of recordings.
        static let groupHeadingTop: CGFloat = 8
        static let pageTitle = MacStyle.pageTitle
        static let pageTitleTracking = MacStyle.pageTitleTracking
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
        static let headingControlHeight = MacButtonStyle.Size.small.iconDiameter
        /// A Mac sheet closes with its button and Escape, never a swipe.
        static let practiceClosesBySwipe = false
        /// The key grid spreads across the row whenever it fits, rather than hugging the
        /// leading edge.
        static let keyGridSpreads = true
        /// A Mac sheet keeps its actions in its form, with the platform's own buttons.
        static let pinsSheetActions = false
        /// The tune page's key pill names the mode too, "D major", so key and mode never part.
        static let keyPillHoldsMode = true
        /// A tune page's section, heading and controls included, keeps a readable measure.
        static let sectionMaxWidth = MacStyle.pageRowMaxWidth
    #else
        static let body = Font.body
        static let secondary = Font.subheadline
        static let sectionHeading = Font.title3.weight(.semibold)
        static let groupHeadingTop: CGFloat = 0
        static let pageTitle = Font.largeTitle.bold()
        static let pageTitleTracking: CGFloat = 0
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
        /// A heading control's frame is its whole hit area, since a menu takes taps only there.
        static let headingControlHeight = minimumTapTarget
        static let practiceClosesBySwipe = true
        /// The key grid keeps its natural width and scrolls sideways once it outgrows the row.
        static let keyGridSpreads = false
        /// A sheet's actions pin to its bottom edge, a full-width primary over centered
        /// secondaries, and Close is the system close button.
        static let pinsSheetActions = true
        /// The key pill shows the key alone and the mode leads the facet line.
        static let keyPillHoldsMode = false
        static let sectionMaxWidth = CGFloat.infinity
    #endif

    /// The space between lines of tokens drawn at ``smallControlHeight``: at least `base`, and
    /// enough that their hit areas, reaching to ``minTarget``, meet without overlapping.
    static func tokenLineGap(_ base: CGFloat) -> CGFloat {
        max(base, minTarget - smallControlHeight)
    }
}
