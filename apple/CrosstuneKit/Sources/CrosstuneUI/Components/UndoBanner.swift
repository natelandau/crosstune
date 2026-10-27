import SwiftUI

/// An action the musician can take back, shown in a short banner. System undo (Cmd-Z, the
/// Edit menu, shake) carries the same undo; the banner makes it visible. An item with no undo
/// is a notice, such as why an undo did not run.
public struct UndoBannerItem: Identifiable {
    public let id: UUID
    public let message: String
    public let undo: (() -> Void)?

    /// `message` says what happened: "Archived 3 tunes".
    public init(message: String, undo: @escaping () -> Void) {
        self.init(id: UUID(), message: message, undo: undo)
    }

    /// A notice with no Undo.
    public init(message: String) {
        self.init(id: UUID(), message: message, undo: nil)
    }

    private init(id: UUID, message: String, undo: (() -> Void)?) {
        self.id = id
        self.message = message
        self.undo = undo
    }

    /// The same banner with its Undo taken away, kept on screen as it was rather than shown anew.
    public func withoutUndo() -> UndoBannerItem {
        UndoBannerItem(id: id, message: message, undo: nil)
    }
}

/// A floating banner with a message and an Undo button, or the message alone.
public struct UndoBanner: View {
    nonisolated public static let undo = "Undo"
    /// How long a banner stays before it leaves on its own.
    nonisolated public static let duration: Duration = .seconds(8)
    /// How long it stays while VoiceOver runs, long enough to hear the message and reach Undo.
    nonisolated public static let voiceOverDuration: Duration = .seconds(20)

    /// How long a banner stays, given whether VoiceOver is running.
    nonisolated public static func timeout(voiceOver: Bool) -> Duration {
        voiceOver ? voiceOverDuration : duration
    }

    private let message: String
    private let onUndo: (() -> Void)?

    /// - Parameter onUndo: Nil leaves Undo out.
    public init(message: String, onUndo: (() -> Void)?) {
        self.message = message
        self.onUndo = onUndo
    }

    @Environment(\.spacing) private var spacing

    public var body: some View {
        #if os(macOS)
            macBody
        #else
            touchBody
        #endif
    }

    #if os(macOS)
        /// The primary text color, with the page background's color for its words, fitted to
        /// them, so it reads as a passing notice over either appearance's column.
        private var macBody: some View {
            HStack(spacing: 16) {
                // Messages name lists and tunes.
                Text(message)
                    .contentMask()
                    .font(MacStyle.body)
                    .foregroundStyle(Palette.pageBackground)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let onUndo {
                    Button(action: onUndo) {
                        Text(Self.undo)
                            .font(MacStyle.body.weight(.semibold))
                            .foregroundStyle(Palette.inverseAccent)
                            .frame(maxHeight: .infinity)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .frame(height: MacStyle.undoBannerHeight)
            .background(Palette.textPrimary, in: .rect(cornerRadius: 10))
            .shadow(color: .black.opacity(0.18), radius: 10, y: 3)
            .frame(maxWidth: 480)
        }
    #else
        private var touchBody: some View {
            HStack(spacing: spacing(12)) {
                // Messages name lists and tunes.
                Text(message)
                    .contentMask()
                    .font(.platform(.subheadline, mac: .body))
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let onUndo {
                    Button(action: onUndo) {
                        Text(Self.undo)
                            .font(.platform(.subheadline, mac: .body).weight(.semibold))
                            .frame(minWidth: minimumTapTarget, minHeight: minimumTapTarget)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tint)
                }
            }
            // A notice keeps the height a banner with Undo has.
            .frame(minHeight: minimumTapTarget)
            .padding(.leading, 20)
            .padding(.trailing, 16)
            .padding(.vertical, spacing(4))
            .frame(maxWidth: 480)
            .modifier(GlassCapsule())
        }
    #endif
}

extension EnvironmentValues {
    /// Whether Liquid Glass is drawn. An image renderer cannot draw glass, so a snapshot turns
    /// this off to see the material that replaces it.
    @Entry var drawsGlass = true
}

extension View {
    /// Shows `item` in a banner at the bottom of this view until the musician takes it, the
    /// banner times out, or a newer item replaces it.
    /// - Parameter timesOut: False for an owner that ends the item on its own deadline.
    public func undoBanner(_ item: Binding<UndoBannerItem?>, timesOut: Bool = true) -> some View {
        modifier(UndoBannerModifier(item: item, timesOut: timesOut))
    }
}

private struct UndoBannerModifier: ViewModifier {
    @Binding var item: UndoBannerItem?
    let timesOut: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.spacing) private var spacing

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let current = item {
                    UndoBanner(
                        message: current.message,
                        onUndo: current.undo.map { undo in
                            {
                                item = nil
                                undo()
                            }
                        }
                    )
                    .padding(.horizontal, 16)
                    #if os(macOS)
                        // Lifted clear of the column's last row and the window's corner.
                        .padding(.bottom, 16)
                    #else
                        .padding(.bottom, spacing.stackGap)
                    #endif
                    .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    // A newer item is a new banner, so it transitions in rather than
                    // rewording the one on screen.
                    .id(current.id)
                }
            }
            #if os(macOS)
                // The Mac animates nothing under Reduce Motion; iOS keeps the cross-fade.
                .animation(reduceMotion ? nil : .default, value: item?.id)
            #else
                .animation(.default, value: item?.id)
            #endif
            // Every item is announced, including one that replaces another on screen.
            .onChange(of: item?.id, initial: true) {
                if let item { AccessibilityNotification.Announcement(item.message).post() }
            }
            .task(id: item?.id) {
                guard timesOut, let shown = item?.id else { return }
                try? await Task.sleep(for: UndoBanner.timeout(voiceOver: voiceOver))
                if !Task.isCancelled, item?.id == shown { item = nil }
            }
    }
}

#Preview("Undo banner") {
    @Previewable @State var item: UndoBannerItem? = UndoBannerItem(message: "Archived 3 tunes") {}
    Color.clear
        .frame(width: 390, height: 200)
        .undoBanner($item)
}
