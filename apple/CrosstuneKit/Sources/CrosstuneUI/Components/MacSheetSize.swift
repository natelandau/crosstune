import SwiftUI

/// How big a sheet opens on the Mac, where a sheet sizes to its frame rather than the screen.
struct MacSheetSize {
    /// The width every form and picker sheet shares.
    static let formWidth: CGFloat = 480

    var minWidth: CGFloat = formWidth
    var idealWidth: CGFloat = formWidth
    var minHeight: CGFloat
    var idealHeight: CGFloat?
    /// The tallest a fitted sheet grows, nil for a sheet sized by its minimum and ideal.
    var maxHeight: CGFloat?

    var isFitted: Bool { maxHeight != nil }

    /// A short form, as tall as its fields need.
    static func form(minHeight: CGFloat) -> MacSheetSize { MacSheetSize(minHeight: minHeight) }
    /// A searchable list to pick from.
    static let picker = MacSheetSize(minHeight: 480, idealHeight: 560)
    /// A form long enough to scroll, such as a tune's.
    static let longForm = MacSheetSize(minHeight: 560, idealHeight: 720)
    /// As tall as its content, up to `max`, past which the body scrolls.
    static func fitted(max: CGFloat) -> MacSheetSize { MacSheetSize(minHeight: 0, maxHeight: max) }
    /// As tall as its content, up to one of the shared heights.
    static func fitted(_ reach: Reach) -> MacSheetSize { fitted(max: reach.rawValue) }

    /// The heights fitted sheets stop growing at, so sheets of one kind stop at one height.
    enum Reach: CGFloat {
        /// A few filter rows.
        case short = 320
        /// A short form, such as a link.
        case brief = 400
        /// A short list of sections.
        case medium = 480
        /// A notice or a list of settings.
        case standard = 560
        /// A plan's comparison.
        case tall = 760
    }
}

#if os(macOS)
    extension MacSheetSize {
        /// A sheet that opens over the Settings window: `height` tall, or as tall as the window's
        /// content without one, and `width` no wider than the window.
        static func overSettings(width: CGFloat = formWidth, height: CGFloat? = nil) -> MacSheetSize {
            let width = min(width, MacSettingsTabs.size.width)
            let tallest = settingsTallest
            return MacSheetSize(
                minWidth: width, idealWidth: width, minHeight: min(height ?? 440, tallest),
                idealHeight: min(height ?? tallest, tallest))
        }

        /// A fitted sheet over the Settings window, which grows no taller than the window holds.
        static let fittedOverSettings = fitted(max: settingsTallest)

        /// The tallest a sheet over the Settings window may be, a little short of the window.
        private static var settingsTallest: CGFloat { MacSettingsTabs.size.height - 10 }
    }
#endif

extension View {
    /// Sizes the sheet on the Mac; elsewhere the system sizes it.
    func macSheetFrame(_ size: MacSheetSize) -> some View {
        #if os(macOS)
            Group {
                if let maxHeight = size.maxHeight {
                    frame(width: size.idealWidth)
                        .frame(maxHeight: maxHeight)
                        .presentationSizing(.fitted)
                } else {
                    frame(
                        minWidth: size.minWidth, idealWidth: size.idealWidth, minHeight: size.minHeight,
                        idealHeight: size.idealHeight)
                }
            }
        #else
            self
        #endif
    }
}
