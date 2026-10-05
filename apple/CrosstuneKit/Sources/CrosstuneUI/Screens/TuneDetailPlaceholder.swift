import SwiftUI

/// The split view's detail column while no tune is chosen.
public struct TuneDetailPlaceholder: View {
    public static let title = "No tune selected"
    /// The Mac's way forward from an empty pane.
    public static let hint = "Choose a tune, or add one with ⌘N"

    public init() {}

    public var body: some View {
        #if os(macOS)
            // Quiet, so an empty pane reads as space waiting for a tune rather than a message.
            VStack(spacing: 6) {
                Image(systemName: "music.note")
                    .font(.system(size: 22, weight: .light))
                    .foregroundStyle(.tertiary)
                    .padding(.bottom, 4)
                    .accessibilityHidden(true)
                Text(Self.title)
                    .font(MacStyle.sectionHeading)
                    .foregroundStyle(.secondary)
                Text(Self.hint)
                    .font(MacStyle.body)
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
        #else
            ContentUnavailableView(Self.title, systemImage: "music.note")
        #endif
    }
}
