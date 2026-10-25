import SwiftUI

/// The names every record control shares. Recording is an action, not a destination: on
/// iPhone, and at regular width from iPadOS 27, it takes the tab bar's separated slot but never
/// stays selected.
public enum RecordControl {
    /// What a record control is called for VoiceOver and in help tags.
    public static let label = "Start a new recording"
    /// The short name, for menus and toolbars. It says the press starts recording at once.
    public static let title = "Start recording"
    /// The shortest name, for the Mac sidebar's capsule, the iPad's Record tab, and the
    /// iPadOS 26 foot capsule, whose help tag or VoiceOver name gives the full one.
    public static let shortLabel = "Record"
    public static let systemImage = "record.circle"
}

#if os(iOS)
    extension RecordControl {
        /// Whether Record is a tab. iPadOS 26 has no prominent role, and the search role the
        /// iPhone falls back to draws a search field in the iPad's bars, so the iPad foot keeps
        /// Record there.
        static var isTab: Bool {
            if #available(iOS 27, *) { true } else { false }
        }

        /// The role that sets the Record tab apart in its own circle at the bar's trailing end.
        static var tabRole: TabRole {
            if #available(iOS 27, *) { .prominent } else { .search }
        }

        /// The Record tab's dot. A bar redraws a template glyph in its own colors, so the dot is
        /// drawn red up front; it draws an original image the same whether or not its tab is
        /// disabled, so a covered tab shows its standing down with a dimmed dot of its own.
        static func tabDot(enabled: Bool) -> UIImage {
            enabled ? enabledDot : coveredDot
        }

        private static let enabledDot = dot(UIColor(Color.recordingRed))
        private static let coveredDot = dot(UIColor(Color.recordingRed).withAlphaComponent(0.35))

        private static func dot(_ color: UIColor) -> UIImage {
            if let glyph = UIImage(systemName: "circle.fill") {
                return glyph.withTintColor(color, renderingMode: .alwaysOriginal)
            }
            return UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).image { context in
                color.setFill()
                context.cgContext.fillEllipse(in: CGRect(x: 2, y: 2, width: 20, height: 20))
            }
        }
    }
#endif

/// The record button in the Mac toolbar while the sidebar, which holds the Mac's own, is
/// collapsed.
public struct RecordToolbarButton: View {
    private let action: @MainActor () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var presses = 0

    public init(action: @escaping @MainActor () -> Void) {
        self.action = action
    }

    public var body: some View {
        Button {
            presses += 1
            action()
        } label: {
            Label {
                Text(RecordControl.title)
            } icon: {
                // A toolbar draws its glyphs in the label color whatever the tint.
                Image(systemName: RecordControl.systemImage)
                    .foregroundStyle(Color.recordingRed)
            }
        }
        .symbolEffect(.bounce, value: reduceMotion ? 0 : presses)
        .accessibilityLabel(RecordControl.label)
        .help(RecordControl.label)
    }
}

#if os(macOS)
    /// The record button pinned to the foot of the Mac sidebar, as in Voice Memos: always in
    /// view, whatever the content column shows. A compact capsule, so it never truncates in a
    /// narrow sidebar.
    struct SidebarRecordButton: View {
        let action: @MainActor () -> Void

        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Environment(\.isEnabled) private var isEnabled
        @State private var presses = 0

        /// The sidebar list's inset from its edges, so the capsule lines up with the rows'
        /// selection.
        static let rowInset: CGFloat = 10
        private static let dotDiameter: CGFloat = 10
        /// Centers the dot under the rows' glyphs.
        private static let dotInset: CGFloat = 11

        var body: some View {
            Button {
                presses += 1
                action()
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: "circle.fill")
                        .font(.system(size: Self.dotDiameter))
                        .foregroundStyle(Color.recordingRed)
                        .symbolEffect(.bounce, value: reduceMotion ? 0 : presses)
                    Text(RecordControl.shortLabel)
                        .font(MacStyle.body.weight(.medium))
                        .foregroundStyle(Palette.ink)
                }
                .padding(.leading, Self.dotInset)
                .padding(.trailing, 14)
                .frame(height: MacStyle.paneControlHeight)
                .background(Palette.field, in: .capsule)
                .overlay { Capsule().strokeBorder(Palette.hairline) }
                .contentShape(.capsule)
                .opacity(isEnabled ? 1 : 0.5)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(RecordControl.label)
            .help("\(RecordControl.label) (⌘R)")
        }
    }
#endif
