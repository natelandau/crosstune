import CrosstunePalette
import CrosstuneShare
import SwiftUI
import os

/// The share sheet: a tune search for a link, progress while audio files save, then what came of
/// the share.
struct ShareView: View {
    let model: ShareSheetModel
    /// Runs a save so the extension is not suspended before the save is written.
    let perform: (@escaping @MainActor () async -> Void) -> Void
    let cancel: () -> Void
    let close: () -> Void

    private static let logger = Logger(subsystem: "app.crosstune.Crosstune", category: "share-sheet")

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(ShareText.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbar }
        }
        .tint(Palette.textPrimary)
        .task(id: model.state) {
            guard case .saved = model.state else { return }
            // Long enough to read the confirmation, which needs no action.
            try? await Task.sleep(for: .seconds(1.5))
            if !Task.isCancelled { close() }
        }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .signedOut: ShareMessage(text: ShareText.signedOut)
        case .nothingToShare: ShareMessage(text: ShareText.nothingToShare)
        case .saved(let text): ShareMessage(text: text)
        case .loading, .audio:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Palette.groupedBackground)
        case .refused(let refusals):
            // By position, since two files can be refused with the same words.
            List(refusals.enumerated(), id: \.offset) { _, refusal in
                Text(refusal).foregroundStyle(Palette.textPrimary).listRowBackground(Palette.groupedSurface)
            }
            .scrollContentBackground(.hidden)
            .background(Palette.groupedBackground)
        case .link(let url, let title):
            ShareLinkList(model: model, url: url, title: title)
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        switch model.state {
        case .link, .loading, .audio:
            ToolbarItem(placement: .cancellationAction) {
                Button(ShareText.cancel, action: cancel)
            }
        case .signedOut, .nothingToShare, .saved, .refused:
            ToolbarItem(placement: .cancellationAction) {
                Button(role: .close, action: close)
            }
        }
        if case .link = model.state {
            ToolbarItem(placement: .confirmationAction) {
                Button(action: saveLink) {
                    Text(ShareText.save).foregroundStyle(Palette.onAccentFill)
                }
                .fontWeight(.semibold)
                .buttonStyle(.glassProminent)
                .tint(Palette.accentFill)
                .disabled(model.choice == nil)
            }
        }
    }

    private func saveLink() {
        perform {
            do {
                try model.saveChoice()
            } catch {
                Self.logger.error("A shared link was not saved: \(error)")
            }
        }
    }
}
