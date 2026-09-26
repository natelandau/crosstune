import SwiftUI

/// An action the musician can take back, offered in a short banner. System undo (Cmd-Z, the
/// Edit menu, shake) carries the same undo; the banner makes it visible.
public struct UndoOffer: Identifiable {
    public let id = UUID()
    public let message: String
    public let undo: () -> Void

    /// `message` says what happened: "Archived 3 tunes".
    public init(message: String, undo: @escaping () -> Void) {
        self.message = message
        self.undo = undo
    }
}

/// A floating banner with a message and an Undo button.
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
    private let onUndo: () -> Void

    public init(message: String, onUndo: @escaping () -> Void) {
        self.message = message
        self.onUndo = onUndo
    }

    public var body: some View {
        HStack(spacing: 12) {
            Text(message)
                .font(.subheadline)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onUndo) {
                Text(Self.undo)
                    .font(.subheadline.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)
        }
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .padding(.vertical, 4)
        .frame(maxWidth: 480)
        .modifier(GlassCapsule())
    }
}

extension EnvironmentValues {
    /// Whether Liquid Glass is drawn. An image renderer cannot draw glass, so a snapshot turns
    /// this off to see the material that stands in for it.
    @Entry var drawsGlass = true
}

/// Liquid Glass in a capsule, or a thick material where glass cannot be drawn.
struct GlassCapsule: ViewModifier {
    @Environment(\.drawsGlass) private var drawsGlass

    func body(content: Content) -> some View {
        if drawsGlass {
            content.glassEffect(.regular, in: .capsule)
        } else {
            content
                .background(.thickMaterial, in: .capsule)
                .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
        }
    }
}

extension View {
    /// Shows `offer` in a banner at the bottom of this view until the musician takes it, the
    /// banner times out, or a newer offer replaces it.
    public func undoBanner(_ offer: Binding<UndoOffer?>) -> some View {
        modifier(UndoBannerModifier(offer: offer))
    }
}

private struct UndoBannerModifier: ViewModifier {
    @Binding var offer: UndoOffer?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let current = offer {
                    UndoBanner(message: current.message) {
                        offer = nil
                        current.undo()
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                    .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    // A newer offer is a new banner, so it transitions in rather than
                    // rewording the one on screen.
                    .id(current.id)
                }
            }
            .animation(.default, value: offer?.id)
            // Every offer is announced, including one that replaces another on screen.
            .onChange(of: offer?.id, initial: true) {
                if let offer { AccessibilityNotification.Announcement(offer.message).post() }
            }
            .task(id: offer?.id) {
                guard let shown = offer?.id else { return }
                try? await Task.sleep(for: UndoBanner.timeout(voiceOver: voiceOver))
                if !Task.isCancelled, offer?.id == shown { offer = nil }
            }
    }
}

#Preview("Undo banner") {
    @Previewable @State var offer: UndoOffer? = UndoOffer(message: "Archived 3 tunes") {}
    Color.clear
        .frame(width: 390, height: 200)
        .undoBanner($offer)
}
