import SwiftUI

/// The names every record control shares. Recording is an action, not a destination, so it
/// never becomes a tab or a sidebar row.
public enum RecordControl {
    /// What a record control is called for VoiceOver and in help tags.
    public static let label = "Start a new recording"
    /// The short name, for menus and toolbars. It says the press starts recording at once.
    public static let title = "Start recording"
    /// The shortest name, for the Mac sidebar's capsule, whose help tag gives the full one.
    public static let shortLabel = "Record"
    public static let systemImage = "record.circle"
}

/// The dome centered over the iPhone tab bar, a solid red dot on the bar's own glass: larger
/// than a tab, its top rising above the bar so the page scrolls past on either side of it.
public struct RecordDome: View {
    /// Wider than a tab's icon and label together, so it reads as the one primary action, and
    /// narrow enough to clear the chosen-tab highlight of a short-labeled tab beside it.
    nonisolated public static let diameter: CGFloat = 58
    /// How far the floating tab bar sits in from each side of the window.
    nonisolated static let barInset: CGFloat = 21
    /// The red dot's share of the dome, leaving a glass ring around it.
    nonisolated static let dotRatio: CGFloat = 0.7

    /// The dome's diameter in a window `width` points wide: never wider than its own slot of
    /// the five, so it never covers the tabs beside it in a narrow window.
    nonisolated public static func diameter(forWidth width: CGFloat) -> CGFloat {
        min(diameter, max(0, (width - 2 * barInset) / 5))
    }

    private let action: @MainActor () -> Void
    private let size: CGFloat

    @Environment(\.drawsGlass) private var drawsGlass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var presses = 0

    public init(diameter: CGFloat = Self.diameter, action: @escaping @MainActor () -> Void) {
        size = diameter
        self.action = action
    }

    public var body: some View {
        // Opaque under the glass, so a chosen tab's highlight beside the dome tucks under its
        // edge instead of showing through the ring.
        if drawsGlass {
            button
                .glassEffect(.regular.interactive(), in: .circle)
                .background(.background.secondary, in: .circle)
        } else {
            button
                .background(.background.secondary, in: .circle)
                .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
        }
    }

    private var button: some View {
        Button {
            presses += 1
            action()
        } label: {
            Image(systemName: "circle.fill")
                .resizable()
                .foregroundStyle(Color.recordingRed)
                .frame(width: size * Self.dotRatio, height: size * Self.dotRatio)
                .symbolEffect(.bounce, value: reduceMotion ? 0 : presses)
                .frame(width: size, height: size)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(RecordControl.label)
    }
}

/// The record button that leads the iPad toolbar, and the Mac toolbar while the sidebar, which
/// holds the Mac's own, is collapsed.
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
