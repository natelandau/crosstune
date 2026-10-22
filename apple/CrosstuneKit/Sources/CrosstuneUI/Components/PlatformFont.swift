import SwiftUI

/// The Mac's fixed type roles, named where shared code needs one without importing Mac-only
/// types. ``MacStyle`` holds each role's font.
enum MacTypeRole {
    case body, secondary, label, chip, sectionHeading, sheetTitle, columnTitle, pageTitle, readout, timer
}

extension Font {
    /// `style` on iPhone and iPad, where type follows Dynamic Type; on the Mac, the fixed role
    /// standing in for it, or `role` where the default does not fit the view.
    static func platform(_ style: Font.TextStyle, mac role: MacTypeRole? = nil) -> Font {
        #if os(macOS)
            (role ?? MacTypeRole(style)).font
        #else
            .system(style)
        #endif
    }
}

#if os(macOS)
    extension MacTypeRole {
        /// The role a SwiftUI text style stands in for when a Mac view names no role.
        init(_ style: Font.TextStyle) {
            switch style {
            case .largeTitle: self = .pageTitle
            case .title, .title2: self = .sheetTitle
            case .title3: self = .sectionHeading
            case .headline, .callout, .body: self = .body
            case .subheadline, .footnote, .caption, .caption2: self = .secondary
            @unknown default: self = .body
            }
        }

        var font: Font {
            switch self {
            case .body: MacStyle.body
            case .secondary: MacStyle.secondary
            case .label: MacStyle.label
            case .chip: MacStyle.chip
            case .sectionHeading: MacStyle.sectionHeading
            case .sheetTitle: MacStyle.sheetTitle
            case .columnTitle: MacStyle.columnTitle
            case .pageTitle: MacStyle.pageTitle
            case .readout: MacStyle.readout
            case .timer: MacStyle.timer
            }
        }
    }
#endif
