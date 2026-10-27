import SwiftUI

#if os(iOS)
    import GameController
#endif

/// The split view's detail column while no tune is chosen.
public struct TuneDetailPlaceholder: View {
    public static let title = "No tune selected"
    /// The Mac's way forward from an empty pane.
    public static let hint = "Choose a tune, or add one with ⌘N"
    /// The way forward on a touch screen with no keyboard to press ⌘N on.
    public static let touchHint = "Choose a tune, or add one with +"

    #if os(iOS)
        @State private var hasKeyboard = GCKeyboard.coalesced != nil
    #else
        @Environment(CatalogModel.self) private var catalog: CatalogModel?
    #endif

    public init() {}

    public var body: some View {
        #if os(macOS)
            if let catalog, CatalogScreen.isEmptyCatalog(catalog.results, query: catalog.query) {
                // The catalog column's onboarding is the one empty state while there is no tune.
                Color.clear
            } else {
                // Quiet, so an empty pane reads as space waiting for a tune rather than a message.
                VStack(spacing: 6) {
                    Image(systemName: "music.note")
                        .font(.system(size: 22, weight: .light))
                        .foregroundStyle(.textSecondary)
                        .padding(.bottom, 4)
                        .accessibilityHidden(true)
                    Text(Self.title)
                        .font(MacStyle.sectionHeading)
                        .foregroundStyle(Palette.textSecondary)
                    Text(Self.hint)
                        .font(MacStyle.body)
                        .foregroundStyle(Palette.textSecondary)
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityElement(children: .combine)
            }
        #else
            ContentUnavailableView {
                Label(Self.title, systemImage: "music.note")
            } description: {
                Text(hasKeyboard ? Self.hint : Self.touchHint)
            }
            .onReceive(NotificationCenter.default.publisher(for: .GCKeyboardDidConnect)) { _ in
                hasKeyboard = true
            }
            .onReceive(NotificationCenter.default.publisher(for: .GCKeyboardDidDisconnect)) { _ in
                hasKeyboard = GCKeyboard.coalesced != nil
            }
        #endif
    }
}
