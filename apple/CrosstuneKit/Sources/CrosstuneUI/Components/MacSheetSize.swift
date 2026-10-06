import SwiftUI

/// How big a sheet opens on the Mac, where a sheet sizes to its frame rather than the screen.
struct MacSheetSize {
    /// The width every form and picker sheet shares.
    static let formWidth: CGFloat = 480

    var minWidth: CGFloat = formWidth
    var idealWidth: CGFloat = formWidth
    var minHeight: CGFloat
    var idealHeight: CGFloat?

    /// A short form, as tall as its fields need.
    static func form(minHeight: CGFloat) -> MacSheetSize { MacSheetSize(minHeight: minHeight) }
    /// A searchable list to pick from.
    static let picker = MacSheetSize(minHeight: 480, idealHeight: 560)
    /// A form long enough to scroll, such as a tune's.
    static let longForm = MacSheetSize(minHeight: 560, idealHeight: 720)
}

extension View {
    /// Sizes the sheet on the Mac; elsewhere the system sizes it.
    func macSheetFrame(_ size: MacSheetSize) -> some View {
        #if os(macOS)
            frame(
                minWidth: size.minWidth, idealWidth: size.idealWidth, minHeight: size.minHeight,
                idealHeight: size.idealHeight)
        #else
            self
        #endif
    }
}
