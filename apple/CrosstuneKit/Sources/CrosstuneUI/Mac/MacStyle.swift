#if os(macOS)
    import AppKit
    import SwiftUI

    /// The Mac app's accent, type, and spacing tokens.
    public enum MacStyle {
        /// Harbor blue, lighter in dark mode so text on the window keeps its contrast.
        public static var accent: Color { MacPalette.accent }
        /// Coral, the mark's color.
        public static var coral: Color { BrandStyle.coral }

        /// How strongly a set filter's accent wash shows over the window.
        public static func setFillOpacity(_ scheme: ColorScheme) -> Double {
            scheme == .dark ? 0.22 : 0.12
        }

        /// Whether a set filter's label is the accent. Over dark mode's surface the wash leaves
        /// the accent short of 4.5:1, so in dark mode the label takes ink.
        public static func setLabelIsAccent(_ scheme: ColorScheme) -> Bool {
            scheme != .dark
        }

        /// How strongly the accent washes the row a playing list is on: lighter than a set
        /// filter's wash, so the row reads as marked rather than chosen.
        public static func playingWashOpacity(_ scheme: ColorScheme) -> Double {
            scheme == .dark ? 0.18 : 0.10
        }

        /// A set filter's wash, the fill of a filter control or token once it narrows the list.
        public static func setFill(_ scheme: ColorScheme) -> Color {
            accent.opacity(setFillOpacity(scheme))
        }

        /// A set filter's label on its wash.
        public static func setLabel(_ scheme: ColorScheme) -> Color {
            setLabelIsAccent(scheme) ? accent : MacPalette.ink
        }

        // SF Pro at fixed sizes: a Mac view never takes a SwiftUI text style, whose sizes follow
        // the system's own scale.
        public static let body = Font.system(size: bodySize)
        public static let secondary = Font.system(size: 11)
        public static let label = Font.system(size: 12, weight: .medium)
        public static let chip = Font.system(size: 12, weight: .medium)
        public static let sectionHeading = Font.system(size: 15, weight: .semibold)
        /// A line under a headline, a step above body text.
        public static let lead = Font.system(size: 15)
        /// The chevron trailing a row that opens or pushes, a step lighter than its text.
        public static let rowChevron = Font.system(size: 11, weight: .semibold)
        public static let sheetTitle = Font.system(size: sheetTitleSize, weight: .bold)
        /// The title a form names its subject with, typed straight under the sheet's title and a
        /// step below it.
        public static let formTitle = Font.system(size: formTitleSize, weight: .semibold)
        public static let columnTitle = Font.system(size: columnTitleSize, weight: .bold)
        public static let pageTitle = Font.system(size: pageTitleSize, weight: .bold)
        public static let readout = Font.system(size: 20, weight: .semibold).monospacedDigit()
        public static let timer = Font.system(size: 64, weight: .light).monospacedDigit()

        nonisolated public static let bodySize: CGFloat = 13
        public static let sheetTitleSize: CGFloat = 20
        public static let formTitleSize: CGFloat = 18
        public static let columnTitleSize: CGFloat = 26
        public static let pageTitleSize: CGFloat = 34
        public static let columnTitleTracking: CGFloat = -0.4
        public static let pageTitleTracking: CGFloat = -0.7
        public static let timerTracking: CGFloat = -1

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
        /// A media row's title line at the body size, which its glyph centers on.
        public static let mediaTitleLineHeight: CGFloat = 16
        public static let pageMaxWidth: CGFloat = 680
        /// The widest a page's section runs, heading included, so its controls and a row's
        /// trailing controls stay near the text and long text keeps a readable measure.
        public static let pageRowMaxWidth: CGFloat = 440
        /// The column a page's glyphs (play, quote, status) hang in, left of the text's leading
        /// edge and inside the page margin, so every section's text starts on one edge.
        public static let pageGlyphColumn: CGFloat = 24
        /// Between a hung glyph and its text, inside ``pageGlyphColumn``.
        public static let pageGlyphGap: CGFloat = 8
        public static let pageMargin: CGFloat = 32
        public static let sectionGap: CGFloat = 28
        public static let headingGap: CGFloat = 8
        public static let dockHeight: CGFloat = 48
        /// The dock's play and pause disc, inside the dock's glyph slot.
        public static let dockPlayDiameter: CGFloat = 28
        /// The dock's inset from the column's edges and around what grows above its bar.
        public static let dockInset: CGFloat = 16
        public static let undoBannerHeight: CGFloat = 36
        /// The practice stage's corners: the card holding the overview, waveform, and readout.
        public static let stageRadius: CGFloat = 12
        /// The practice transport's play disc; its skips take the large icon circle.
        public static let transportDiameter: CGFloat = 44
        public static let recordPanelWidth: CGFloat = 360
        public static let stopDiameter: CGFloat = 80
        /// The inset around a sheet's content, as Mac sheets lay out.
        public static let sheetMargin: CGFloat = 20
        /// Puts a sidebar status row's glyph under the Catalog row's name, the row it narrows.
        public static let sidebarStatusIndent: CGFloat = 21
        /// How far the inset list style draws its selection in from a column's edges.
        public static let selectionInset: CGFloat = 10
        /// Where every column's title and the tune page's title set their first baseline: this
        /// far below the pane bar, whatever the title's size, so the titles line up across the
        /// columns.
        public static let columnTitleBaseline: CGFloat = 38

        /// What holds a title, and how far below the pane bar its own content already starts.
        enum TitleContainer {
            /// A column's inset list, which adds its own room above the first row.
            case insetList
            /// A column's plain list.
            case plainList
            /// A page's scroll view, which adds nothing.
            case page

            var top: CGFloat {
                switch self {
                case .insetList: 9.5
                case .plainList: 0
                case .page: 0
                }
            }
        }

        /// The room above a bold title of `size` points in `container` that sets its first
        /// baseline on ``columnTitleBaseline``.
        static func titleTop(size: CGFloat, container: TitleContainer) -> CGFloat {
            columnTitleBaseline - NSFont.systemFont(ofSize: size, weight: .bold).ascender - container.top
        }

        /// The undo banner's Undo: the other appearance's accent, which reads on the banner's ink.
        static func undoActionHex(_ scheme: ColorScheme) -> String {
            MacPalette.hex(.accent, scheme == .dark ? .light : .dark)
        }

        static var undoAction: Color {
            Color(
                nsColor: NSColor(name: nil) { appearance in
                    let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                    let rgb = KeyColor.RGB(hex: undoActionHex(isDark ? .dark : .light))
                    return NSColor(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
                })
        }

        /// A row above a column's tunes, such as its title or filters. The inset list style adds
        /// its own side padding, so the row starts where the tune rows do.
        public static func columnRowInsets(top: CGFloat = 0, bottom: CGFloat = 0) -> EdgeInsets {
            EdgeInsets(top: top, leading: 0, bottom: bottom, trailing: 0)
        }

        /// The row under a column title that the filter row or the selection bar holds: one
        /// height and one offset under the title on every column, so entering selection never
        /// moves the rows.
        public static let columnBarHeight: CGFloat = paneControlHeight
        public static let columnBarInsets = columnRowInsets(top: 8, bottom: 2)
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

        /// The opaque mode's fill: the sidebar's surface, so floating chrome reads as the pane it
        /// sits over.
        static var opaqueFill: Color { MacPalette.surface }
    }

    /// Liquid Glass in `shape`, drawn as ``MacGlassMode`` resolves.
    struct MacGlass<S: Shape>: ViewModifier {
        let shape: S

        @Environment(\.drawsGlass) private var drawsGlass
        @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
        @Environment(\.colorSchemeContrast) private var contrast

        func body(content: Content) -> some View {
            switch MacGlassMode(
                reduceTransparency: reduceTransparency, increasedContrast: contrast == .increased,
                drawsGlass: drawsGlass)
            {
            case .opaque:
                content.background(MacGlassMode.opaqueFill, in: shape)
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

        /// A content column's list, drawn over the column's ground. The inset style draws the
        /// selection as a soft highlight inset from the column's edges; the plain style runs it
        /// edge to edge.
        func macColumnList() -> some View {
            listStyle(.inset)
                .scrollContentBackground(.hidden)
        }
    }
#endif
