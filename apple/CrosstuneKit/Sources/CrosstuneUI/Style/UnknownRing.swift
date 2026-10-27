import SwiftUI

/// Want to learn's hollow ring in the status color, darkened where the shared gray falls under
/// 3:1: on a light surface and on any row or filter tint. On the Mac's gray selection it takes
/// a color that holds 3:1 there. ``StatusGlyphStyle`` turns it white on an emphasized selection.
enum UnknownRing {
    /// What the ring sits on.
    enum Placement: Equatable, CaseIterable {
        case pageBackground, fill, graySelection
    }

    static func placement(in environment: EnvironmentValues) -> Placement {
        #if os(macOS)
            if environment.macRowSelected { return .graySelection }
            if environment.macContainer == .surface { return .fill }
        #endif
        return environment.statusRingOnFill ? .fill : .pageBackground
    }

    static func hex(_ placement: Placement, scheme: ColorScheme) -> String {
        switch placement {
        case .pageBackground: Palette.hex(.statusUnknown, scheme)
        case .fill: Palette.hex(.statusUnknownOnFill, scheme)
        // The gray selection is lighter in light mode and darker in dark mode than any tint, so
        // dark mode takes the primary text color.
        case .graySelection:
            scheme == .dark ? Palette.hex(.textPrimary, scheme) : Palette.hex(.statusUnknownOnFill, scheme)
        }
    }
}

extension EnvironmentValues {
    /// Whether a status ring here sits on a surface or a row's tint rather than the page
    /// background.
    @Entry var statusRingOnFill = false
}

extension View {
    /// Marks a surface, or a row on a tint, so a want to learn ring in it holds 3:1.
    func statusRingOnFill(_ onFill: Bool = true) -> some View {
        environment(\.statusRingOnFill, onFill)
    }
}
