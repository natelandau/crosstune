import SwiftUI

extension View {
    /// A list or scroll view on the paper ground rather than the system's white or black. The
    /// Mac draws its own grounds, so it keeps this view as is.
    func paperGround() -> some View {
        #if os(macOS)
            self
        #else
            scrollContentBackground(.hidden).background(Palette.ground.ignoresSafeArea())
        #endif
    }

    /// A grouped form's page on paper. ``PaperForm`` sets the cards, so a form is built with it.
    fileprivate func paperGroupedForm() -> some View {
        #if os(macOS)
            self
        #else
            scrollContentBackground(.hidden).background(Palette.groupedPage.ignoresSafeArea())
        #endif
    }

    /// Rows, or the sections that hold them, on the paper card rather than the system's.
    func paperCard() -> some View {
        #if os(macOS)
            self
        #else
            listRowBackground(Palette.groupedCard)
        #endif
    }
}

/// A grouped `Form` on paper: the page takes ``Palette/groupedPage`` and every row, in any
/// section, takes ``Palette/groupedCard`` unless it sets its own background. Its switches take
/// the shared on color. The sections stay as written: rebuilding them (`ForEach(sections:)`)
/// drops a row's own list modifiers, such as the open Settings page's `field` background.
struct PaperForm<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        Form {
            Group { content }
                .paperCard()
                .environment(\.onPaperCard, true)
        }
        .formStyle(.grouped)
        .toggleStyle(.harborSwitch)
        .paperGroupedForm()
    }
}
