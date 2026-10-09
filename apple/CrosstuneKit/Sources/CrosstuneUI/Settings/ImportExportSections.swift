import CrosstuneAnalytics
import CrosstuneStore
import SwiftUI

/// Bringing tunes in and taking them out, each group with its help above its row. Both read only
/// the local store, so neither needs a connection.
struct ImportExportSections: View {
    nonisolated static let title = "Import and export"
    nonisolated static let importHeader = "Import"
    nonisolated static let importHelp =
        "Add many tunes at once. You will get a chance to review before Crosstune adds them."
    nonisolated static let moreInfo = "More info"
    nonisolated static let exportHeader = "Export"
    nonisolated static let exportHelp =
        "Save your tunes, recordings, and scans to your device in a single zip file."

    /// The import help with "More info" linking to the public help page, as one run of text so
    /// the link follows the sentence.
    nonisolated static var importHelpText: AttributedString {
        var link = AttributedString(moreInfo)
        link.link = ImportCopy.helpURL
        return AttributedString("\(importHelp) ") + link
    }

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @State private var showsImport = false
    @State private var showsExport = false

    var body: some View {
        Section {
            Button(ImportCopy.title) { showsImport = true }
                .disabled(store == nil)
                .sheet(isPresented: $showsImport) {
                    ImportSheet(entry: .settings)
                }
        } header: {
            SettingsHelp(attributed: Self.importHelpText, title: Self.importHeader)
        }
        Section {
            Button(ExportDataSheet.title) { showsExport = true }
                .disabled(store == nil)
                .sheet(isPresented: $showsExport) {
                    ExportDataSheet(store: store, analytics: analytics)
                }
        } header: {
            SettingsHelp(Self.exportHelp, title: Self.exportHeader)
        }
    }
}
