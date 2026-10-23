import SwiftUI

/// Want to learn's hollow ring in the status color, darkened where the shared gray falls under
/// 3:1: on a light surface and on any row or filter wash. On the Mac's gray selection it takes
/// a color that holds 3:1 there. ``StatusGlyphStyle`` turns it white on an emphasized selection.
enum UnknownRing {
    /// What the ring sits on.
    enum Placement: Equatable, CaseIterable {
        case ground, fill, graySelection
    }

    static func placement(in environment: EnvironmentValues) -> Placement {
        #if os(macOS)
            if environment.macRowSelected { return .graySelection }
            if environment.macContainer == .surface { return .fill }
        #endif
        return environment.statusRingOnFill ? .fill : .ground
    }

    static func hex(_ placement: Placement, scheme: ColorScheme) -> String {
        switch placement {
        case .ground: StatusStyle.unknownHex
        case .fill: StatusStyle.unknownOnSurfaceHex(scheme)
        // The gray is lighter in light mode and darker in dark mode than any wash, so dark mode
        // takes ink.
        case .graySelection: scheme == .dark ? Palette.hex(.ink, scheme) : StatusStyle.unknownOnSurfaceHex(scheme)
        }
    }
}

extension EnvironmentValues {
    /// Whether a status ring here sits on a surface or a row's wash rather than the ground.
    @Entry var statusRingOnFill = false
}

extension View {
    /// Marks a surface, or a row on a wash, so a want to learn ring in it holds 3:1.
    func statusRingOnFill(_ onFill: Bool = true) -> some View {
        environment(\.statusRingOnFill, onFill)
    }
}
