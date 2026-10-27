import CrosstuneAnalytics
import CrosstuneAuth
import CrosstuneDesign
import CrosstuneDiagnostics
import CrosstuneStore
import SwiftUI

/// Bringing tunes in and taking them out, each group with its help above its row. Import reads
/// only the local store; export needs a connection only for files this device does not hold.
struct ImportExportSections: View {
    nonisolated static let title = "Import and export"
    nonisolated static let importHeader = "Import"
    nonisolated static let importHelp =
        "Add many tunes at once. You will get a chance to review before Crosstune adds them."
    nonisolated static let moreInfo = "More info"
    nonisolated static let exportHeader = "Export"
    nonisolated static let exportHelp =
        "Save your tunes, recordings, and scans to your device in a single zip file."
    /// The Mac's row buttons, which open a sheet and so end in an ellipsis.
    nonisolated static let importMac = "\(importHeader)…"
    nonisolated static let exportMac = "\(exportHeader)…"

    /// The import help with "More info" linking to the public help page, as one run of text so
    /// the link follows the sentence.
    nonisolated static var importHelpText: AttributedString {
        var link = AttributedString(moreInfo)
        link.link = ImportCopy.helpURL
        return AttributedString("\(importHelp) ") + link
    }

    @Environment(\.store) private var store
    @Environment(\.analytics) private var analytics
    @Environment(\.diagnostics) private var diagnostics
    @Environment(AccountSession.self) private var session: AccountSession?
    @State private var showsImport = false
    @State private var showsExport = false

    var body: some View {
        #if os(macOS)
            // One card: each row says what it does, and its button opens the sheet.
            MacFormSection {
                MacSettingsRow(ImportCopy.title, attributedHelp: Self.importHelpText) {
                    importButton(MacSettingsButton(Self.importMac) { showsImport = true })
                }
                MacSettingsRow(ExportDataSheet.title, help: Self.exportHelp) {
                    exportButton(MacSettingsButton(Self.exportMac) { showsExport = true })
                }
            }
        #else
            Section {
                importButton(Button(ImportCopy.title) { showsImport = true })
            } header: {
                SettingsHelp(attributed: Self.importHelpText, title: Self.importHeader)
            }
            Section {
                exportButton(Button(ExportDataSheet.title) { showsExport = true })
            } header: {
                SettingsHelp(Self.exportHelp, title: Self.exportHeader)
            }
        #endif
    }

    private func importButton(_ button: some View) -> some View {
        button
            .disabled(store == nil)
            .sheet(isPresented: $showsImport) {
                ImportSheet(entry: .settings)
            }
            #if DEBUG
                .opensForSample(.importTunes, when: store != nil) { showsImport = true }
            #endif
    }

    private func exportButton(_ button: some View) -> some View {
        button
            .disabled(store == nil)
            .sheet(isPresented: $showsExport) {
                ExportDataSheet(
                    store: store, engine: session?.syncEngine,
                    isOffline: { [session] in session?.isOffline ?? true },
                    analytics: analytics, diagnostics: diagnostics)
            }
            #if DEBUG
                .opensForSample(.export, when: store != nil) { showsExport = true }
            #endif
    }
}
