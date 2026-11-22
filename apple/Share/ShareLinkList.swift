import CrosstunePalette
import CrosstuneShare
import CrosstuneVocabulary
import SwiftUI

/// The shared link, then a search of the user's tunes to save it to.
struct ShareLinkList: View {
    @Bindable var model: ShareSheetModel
    let url: String
    let title: String?

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading) {
                    if let title { Text(title).foregroundStyle(Palette.textPrimary) }
                    Text(url).font(.subheadline).foregroundStyle(Palette.textSecondary).lineLimit(2)
                }
                .listRowBackground(Palette.groupedSurface)
            }
            if let failure = model.failure {
                Section {
                    Text(failure).foregroundStyle(Palette.danger).listRowBackground(Palette.groupedSurface)
                }
            }
            Section {
                if model.offersCreate {
                    row(ShareText.newTune(trimmedText(model.query)), detail: nil, choice: .newTune)
                }
                ForEach(model.results) { tune in
                    row(tune.title, detail: tune.detail, choice: .tune(tune))
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.groupedBackground)
        .searchable(
            text: $model.query, placement: .navigationBarDrawer(displayMode: .always), prompt: ShareText.searchPrompt
        )
        // Save stays in reach while searching: closing the search clears the text and with it a
        // new tune's row, so a hidden toolbar would leave no way to save to a new tune.
        .searchPresentationToolbarBehavior(.avoidHidingContent)
        // As the app's list search types: autocorrect would change what is searched for.
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .scrollDismissesKeyboard(.immediately)
    }

    private func row(_ title: String, detail: String?, choice: ShareChoice) -> ShareTuneRow {
        ShareTuneRow(title: title, detail: detail, isChosen: model.choice == choice) {
            model.choice = choice
        }
    }
}
