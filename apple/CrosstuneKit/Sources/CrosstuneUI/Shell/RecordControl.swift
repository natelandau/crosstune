import SwiftUI

/// The names every record control shares. Recording is an action, not a destination: on
/// iPhone it takes the tab bar's separated slot but never stays selected, and it never becomes
/// a sidebar row.
public enum RecordControl {
    /// What a record control is called for VoiceOver and in help tags.
    public static let label = "Start a new recording"
    /// The short name, for menus and toolbars. It says the press starts recording at once.
    public static let title = "Start recording"
    /// The shortest name, for the Mac sidebar's capsule and the iPad's foot capsule, whose help
    /// tag or VoiceOver name gives the full one.
    public static let shortLabel = "Record"
    public static let systemImage = "record.circle"
}

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
                .overlay(Capsule().strokeBorder(Palette.hairline))
                .contentShape(.capsule)
                .opacity(isEnabled ? 1 : 0.5)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(RecordControl.label)
            .help("\(RecordControl.label) (⌘R)")
        }
    }
#endif
