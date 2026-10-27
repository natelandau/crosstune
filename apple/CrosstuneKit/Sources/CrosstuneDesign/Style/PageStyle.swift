import SwiftUI

/// The type and spacing a document page (a tune, a recording) draws with. The Mac uses fixed
/// point sizes; iPhone uses text styles so type follows Dynamic Type.
package enum PageStyle {
    #if os(macOS)
        package static let body = MacStyle.body
        package static let secondary = MacStyle.secondary
        package static let sectionHeading = MacStyle.sectionHeading
        /// The space above a group's heading in a list of recordings.
        package static let groupHeadingTop: CGFloat = 8
        package static let pageTitle = MacStyle.pageTitle
        package static let pageTitleTracking = MacStyle.pageTitleTracking
        package static let sectionGap = MacStyle.sectionGap
        package static let headingGap = MacStyle.headingGap
        package static let smallControlHeight = MacStyle.smallControlHeight
        package static let filterControlHeight = MacStyle.smallControlHeight
        /// A pointer needs no hit area past a control's drawn edge.
        package static let minTarget: CGFloat = 0
        package static let pullDownChevron = Font.system(size: 9, weight: .semibold)
        package static let popoverArrowEdge = Edge.bottom
        package static let pageMargin = MacStyle.pageMargin
        package static let pageMaxWidth = MacStyle.pageMaxWidth
        /// A window has no bar title over the page, so a page with no title of its own heads itself.
        package static let pageHeadsItself = true
        /// How far below its place a page's title starts as the page arrives.
        package static let titleRise: CGFloat = 6
        /// The Mac allows only a few signature moments, so its filters and handles stay still.
        package static let animatesPhoneMotion = false
        package static let headingControlHeight = MacButtonStyle.Size.small.iconDiameter
        /// A Mac sheet closes with its button and Escape, never a swipe.
        package static let practiceClosesBySwipe = false
        /// The key grid spreads across the row whenever it fits, rather than hugging the
        /// leading edge.
        package static let keyGridSpreads = true
        /// A Mac sheet keeps its actions in its form, with the platform's own buttons.
        package static let pinsSheetActions = false
        /// A tune page's section, heading and controls included, keeps a readable measure.
        package static let sectionMaxWidth = MacStyle.pageRowMaxWidth
        /// An attribute row on the tune page, a list row's height with a list row's rounded tint.
        package static let attributeRowHeight = MacStyle.rowHeight
        package static let attributeRowRadius = MacStyle.rowRadius
        /// A surface on the page: a card, the notes field, or the start card's outline.
        package static let surfaceRadius = MacForm.cardRadius
        package static let attributesCardRadius = surfaceRadius
        package static let startCardPadding: CGFloat = 16
        /// Where an attributes card's row text starts from the card's edge.
        package static let attributesCardInset = MacForm.rowInset
        /// A line of text that acts as a button, such as a group's label that opens its tune.
        package static let lineButtonHeight = MacStyle.smallControlHeight
        /// The label over one group of rows.
        package static let groupLabel = MacStyle.secondary.weight(.semibold)
        /// A list's count and sort line.
        package static let listHeaderHeight = MacStyle.headerRowHeight
        package static let listHeaderInsets = MacStyle.columnRowInsets()
        /// Where the practice screen's loop name sits in its row.
        package static let loopSwitcherAlignment = Alignment.leading
    #else
        package static let body = Font.body
        package static let secondary = Font.subheadline
        package static let sectionHeading = Font.title3.weight(.semibold)
        package static let groupHeadingTop: CGFloat = 0
        package static let pageTitle = Font.largeTitle.bold()
        package static let pageTitleTracking: CGFloat = 0
        package static let sectionGap: CGFloat = 28
        package static let headingGap: CGFloat = 8
        package static let smallControlHeight: CGFloat = 32
        package static let filterControlHeight = PhoneStyle.filterControlHeight
        package static let minTarget = minimumTapTarget
        package static let pullDownChevron = Font.caption2.weight(.semibold)
        /// The popover opens below its control, where a phone has the most room.
        package static let popoverArrowEdge = Edge.top
        package static let pageMargin: CGFloat = 20
        package static let pageMaxWidth: CGFloat = 680
        /// The navigation bar carries the title of a pushed page.
        package static let pageHeadsItself = false
        /// The pushed page arrives by its own transition, so its title needs no rise.
        package static let titleRise: CGFloat = 0
        package static let animatesPhoneMotion = true
        /// A heading control's frame is its whole hit area, since a menu takes taps only there.
        package static let headingControlHeight = minimumTapTarget
        package static let practiceClosesBySwipe = true
        /// The key grid keeps its natural width and scrolls sideways once it outgrows the row.
        package static let keyGridSpreads = false
        /// A sheet's actions pin to its bottom edge, a full-width primary over centered
        /// secondaries, and Close is the system close button.
        package static let pinsSheetActions = true
        package static let sectionMaxWidth = CGFloat.infinity
        package static let attributeRowHeight = minimumTapTarget
        package static let attributeRowRadius: CGFloat = 8
        package static let surfaceRadius: CGFloat = 12
        package static let attributesCardRadius = surfaceRadius
        package static let startCardPadding: CGFloat = 20
        package static let attributesCardInset: CGFloat = 16
        package static let lineButtonHeight = minimumTapTarget
        package static let groupLabel = Font.footnote.bold()
        package static let listHeaderHeight = minimumTapTarget
        package static let listHeaderInsets = EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16)
        package static let loopSwitcherAlignment = Alignment.center
    #endif

    /// The tune page's attributes column at its narrowest, its hairline included, beside the
    /// content once the detail column has room for both.
    package static let attributesColumnWidth: CGFloat = 236
    /// The widest the attributes column grows, once the content beside it has the page's
    /// readable width.
    package static let attributesColumnMaxWidth: CGFloat = 320
    /// The attributes column's width from which a row sets its value beside its label.
    package static let attributesColumnBesideWidth: CGFloat = 288
    /// The space between the content and the attributes column.
    package static let attributesColumnGap: CGFloat = 8
    /// The narrowest the tune page's content column reads at beside the attributes column: room
    /// enough that an 11-inch or larger iPad in landscape, with the sidebar hidden, takes the
    /// attributes column, while the open iPhone Duo and a narrow Mac window take the card.
    package static let contentMinWidth: CGFloat = 340

    /// The space between lines of tokens drawn at ``smallControlHeight``: at least `base`, and
    /// enough that their hit areas, reaching to ``minTarget``, meet without overlapping.
    package static func tokenLineGap(_ base: CGFloat) -> CGFloat {
        max(base, minTarget - smallControlHeight)
    }
}
