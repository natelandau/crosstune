#if os(macOS)
    import AppKit
    import SwiftUI

    /// The Mac app's accent, type, and spacing tokens.
    public enum MacStyle {
        public static let accentLight = "#4F5D75"
        public static let accentDark = "#8E9BB3"
        public static let coralHex = "#EF8354"

        /// Slate, lighter in dark mode so text on the window keeps its contrast.
        public static var accent: Color {
            Color(
                nsColor: NSColor(name: nil) { appearance in
                    let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                    return NSColor(hex: dark ? accentDark : accentLight)
                })
        }

        public static var coral: Color { Color(nsColor: NSColor(hex: coralHex)) }

        public static let onAccentLight = "#FFFFFF"
        public static let onAccentDark = "#16181D"

        /// A label on a slate fill: white on the light slate, near-black on the dark slate, which
        /// is a light color.
        public static func onAccent(_ scheme: ColorScheme) -> Color {
            Color(nsColor: NSColor(hex: scheme == .dark ? onAccentDark : onAccentLight))
        }

        /// How strongly a set filter's slate wash shows over the window.
        public static func setFillOpacity(_ scheme: ColorScheme) -> Double {
            scheme == .dark ? 0.28 : 0.14
        }

        /// Whether a set filter's label is slate. Over a dark window the wash leaves slate text
        /// short of 4.5:1, so in dark mode the label takes the primary label color.
        public static func setLabelIsSlate(_ scheme: ColorScheme) -> Bool {
            scheme != .dark
        }

        /// A set filter's wash, the fill of a filter control or token once it narrows the list.
        public static func setFill(_ scheme: ColorScheme) -> Color {
            accent.opacity(setFillOpacity(scheme))
        }

        /// A set filter's label on its wash.
        public static func setLabel(_ scheme: ColorScheme) -> Color {
            setLabelIsSlate(scheme) ? accent : .primary
        }

        /// The wash over the sidebar pane.
        public static func sidebarTint(_ scheme: ColorScheme) -> Color {
            scheme == .dark
                ? Color(nsColor: NSColor(hex: accentDark)).opacity(0.20)
                : Color(nsColor: NSColor(hex: accentLight)).opacity(0.15)
        }

        public static let body = Font.system(size: 13)
        public static let secondary = Font.system(size: 11)
        public static let columnTitle = Font.system(size: 22, weight: .bold)
        public static let pageTitle = Font.system(size: 26, weight: .bold)
        public static let sectionHeading = Font.system(size: 15, weight: .semibold)

        public static let rowHeight: CGFloat = 32
        public static let sidebarRowHeight: CGFloat = 28
        /// A column's header line: its count and sort.
        public static let headerRowHeight: CGFloat = 28
        public static let paneControlHeight: CGFloat = 28
        /// The width every glyph-only pane control shares.
        public static let paneIconWidth: CGFloat = 36
        /// A small control's height, a step below the pane bar's so the bar stays the column's
        /// chrome: a filter control, a section heading's control, a row's own control, and a
        /// group's heading line.
        public static let smallControlHeight: CGFloat = 24
        /// The square a media row's state glyph takes.
        public static let mediaGlyphSlot: CGFloat = 28
        public static let pageMaxWidth: CGFloat = 680
        /// The widest a row on a page runs, so its trailing controls stay near its title.
        public static let pageRowMaxWidth: CGFloat = 440
        public static let pageMargin: CGFloat = 32
        public static let sectionGap: CGFloat = 28
        public static let headingGap: CGFloat = 8
        public static let dockHeight: CGFloat = 48
        public static let recordPanelWidth: CGFloat = 360
        public static let stopDiameter: CGFloat = 80
        /// The inset around a sheet's content, as Mac sheets lay out.
        public static let sheetMargin: CGFloat = 20
        /// The grouped form style's own inset at each side.
        public static let groupedFormInset: CGFloat = 20
        /// Puts a sidebar status row's glyph under the Catalog row's name, the row it narrows.
        public static let sidebarStatusIndent: CGFloat = 21
        /// How far the inset list style draws its selection in from a column's edges.
        public static let selectionInset: CGFloat = 10
        /// Takes back the room the inset list style adds above a column's first row.
        public static let columnTitleTop: CGFloat = -6

        /// A row above a column's tunes, such as its title or filters. The inset list style adds
        /// its own side padding, so the row starts where the tune rows do.
        public static func columnRowInsets(top: CGFloat = 0, bottom: CGFloat = 0) -> EdgeInsets {
            EdgeInsets(top: top, leading: 0, bottom: bottom, trailing: 0)
        }
    }

    extension NSColor {
        fileprivate convenience init(hex: String) {
            let rgb = KeyColor.RGB(hex: hex)
            self.init(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
        }
    }

    /// How a ``MacGlass`` surface draws. Reduce Transparency or Increase Contrast wins over
    /// everything, so an opaque fill draws even where glass is off; otherwise glass, or a thick
    /// material where glass cannot be drawn.
    enum MacGlassMode: Equatable {
        case opaque
        case glass
        case material

        init(reduceTransparency: Bool, increasedContrast: Bool, drawsGlass: Bool) {
            if reduceTransparency || increasedContrast {
                self = .opaque
            } else {
                self = drawsGlass ? .glass : .material
            }
        }
    }

    /// Liquid Glass in `shape`, drawn as ``MacGlassMode`` resolves.
    struct MacGlass<S: Shape>: ViewModifier {
        let shape: S

        @Environment(\.drawsGlass) private var drawsGlass
        @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
        @Environment(\.colorSchemeContrast) private var contrast
        @Environment(\.colorScheme) private var scheme

        func body(content: Content) -> some View {
            switch MacGlassMode(
                reduceTransparency: reduceTransparency, increasedContrast: contrast == .increased,
                drawsGlass: drawsGlass)
            {
            case .opaque:
                content.background {
                    shape.fill(Color(nsColor: .windowBackgroundColor))
                        .overlay { shape.fill(MacStyle.sidebarTint(scheme)) }
                }
            case .glass:
                content.glassEffect(.regular.interactive(), in: shape)
            case .material:
                content.background(.thickMaterial, in: shape)
            }
        }
    }

    extension View {
        func macGlass(in shape: some Shape) -> some View {
            modifier(MacGlass(shape: shape))
        }

        /// A content column's list. The inset style draws the selection as a soft highlight inset
        /// from the column's edges; the plain style runs it edge to edge.
        func macColumnList() -> some View {
            listStyle(.inset)
        }
    }
#endif
