import SwiftUI

/// "What can I paste?", which opens the public help page so the rules live in one place.
struct ImportHelp: View {
    static let destination = ImportCopy.helpURL

    var body: some View {
        #if os(macOS)
            Link(ImportCopy.whatCanIPaste, destination: Self.destination)
                .font(MacStyle.body)
                .foregroundStyle(Palette.accent)
        #else
            Link(destination: Self.destination) {
                Label(ImportCopy.whatCanIPaste, systemImage: "questionmark.circle")
            }
        #endif
    }
}
