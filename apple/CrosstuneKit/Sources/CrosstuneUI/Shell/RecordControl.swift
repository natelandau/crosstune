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

        var body: some View {
            Button {
                presses += 1
                action()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "circle.fill")
                        .font(MacStyle.secondary)
                        .foregroundStyle(Color.recordingRed)
                        .symbolEffect(.bounce, value: reduceMotion ? 0 : presses)
                    Text(RecordControl.shortLabel)
                        .font(MacStyle.body.weight(.medium))
                }
                .padding(.horizontal, 12)
                .frame(height: MacStyle.paneControlHeight)
                .contentShape(.capsule)
                .opacity(isEnabled ? 1 : 0.5)
            }
            .buttonStyle(.plain)
            .macGlass(in: Capsule())
            .accessibilityLabel(RecordControl.label)
            .help("\(RecordControl.label) (⌘R)")
        }
    }
#endif
