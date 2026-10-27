/// The raw colors the palette's roles are made from, named by hue and step: a lower step is
/// lighter. Only the role definitions in `Style/` read these; every view names a role, so a role
/// can move to another primitive without a change outside `Style/`.
package enum Primitive {
    package static let white = "#FFFFFF"
    package static let black = "#000000"

    package static let warmGray0 = "#FFFEFC"
    package static let warmGray50 = "#F3F1ED"
    package static let warmGray100 = "#E8E5E0"
    package static let warmGray150 = "#DDD9D3"
    package static let warmGray500 = "#8A857C"

    package static let gray100 = "#ECEDF0"
    package static let gray250 = "#BAC0CA"
    package static let gray300 = "#9CA2AB"
    package static let gray400 = "#8A909A"
    /// The system's gray fill hue.
    package static let gray470 = "#767680"
    package static let gray500 = "#737983"
    package static let gray600 = "#61676F"
    package static let gray650 = "#555B66"
    package static let gray800 = "#34373D"
    package static let gray850 = "#292C31"
    package static let gray900 = "#1E2024"
    package static let gray925 = "#1C2026"
    package static let gray950 = "#16181B"

    package static let slate300 = "#BFC0C0"
    package static let slate600 = "#4F5D75"
    package static let slate800 = "#2D3142"
    package static let slate900 = "#1E212C"
    package static let slate950 = "#1D2230"

    package static let blue300 = "#6AA6E6"
    package static let blue400 = "#4A86C4"
    package static let blue500 = "#3A72AE"
    package static let blue650 = "#2B609A"
    package static let blue700 = "#1F5F9E"

    package static let coral200 = "#F6BBA1"
    package static let coral400 = "#EF8354"

    package static let red300 = "#FF8A80"
    package static let red700 = "#B3261E"

    package static let orange300 = "#FFB35C"
    package static let orange400 = "#FF8D28"
    package static let orange450 = "#FF9230"
    package static let orange700 = "#B85C00"
    package static let orange800 = "#8A4B00"

    package static let green400 = "#30D158"
    package static let green700 = "#248A3D"

    /// The six loop colors, one per slot, in each appearance.
    package static let loopLight: [UInt32] = [0x1f5fd6, 0xb34700, 0x1e7a34, 0xb0247a, 0x00727a, 0x6b3fc4]
    package static let loopDark: [UInt32] = [0x3570dc, 0xc0560a, 0x26853c, 0xc8368c, 0x0f808a, 0x7d56d8]

    /// The heatmap's four steps, lightest active day first, in each appearance.
    package static let heatmapLight: [UInt32] = [0x707c93, 0x56627a, 0x3b465b, 0x1f2634]
    package static let heatmapDark: [UInt32] = [0x7f8ba2, 0xa0abbf, 0xc2c9d7, 0xe4e8ef]
}
