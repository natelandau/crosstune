import CrosstuneVocabulary
import Foundation

/// A page of the iPhone and iPad Settings root: a row there, a page of its own when opened. The
/// pages follow the subjects of the Mac Settings window's tabs.
enum SettingsCategory: String, CaseIterable, Hashable {
    case tunes
    case recordings
    case appearance
    case syncAndStorage
    case importExport
    case about

    nonisolated static let syncAndStorageTitle = "Sync and storage"

    var title: String {
        switch self {
        case .tunes: SettingsModel.tunes
        case .recordings: SettingsModel.recordings
        case .appearance: Appearance.title
        case .syncAndStorage: Self.syncAndStorageTitle
        case .importExport: ImportExportSections.title
        case .about: SettingsScreen.about
        }
    }

    var systemImage: String {
        switch self {
        case .tunes: "music.note.list"
        case .recordings: "waveform"
        case .appearance: "circle.lefthalf.filled"
        case .syncAndStorage: "arrow.triangle.2.circlepath"
        case .importExport: "arrow.up.arrow.down"
        case .about: "info.circle"
        }
    }

    /// The settings form's groups the page shows, each inline on the one page.
    var sections: SettingsScreen.Sections {
        switch self {
        case .tunes: [.instrumentToggles, .newTunes, .serviceToggles, .appleMusic]
        case .recordings: [.recording, .savedLocations, .downloads]
        case .appearance: [.appearance]
        case .syncAndStorage: [.sync, .storage]
        case .importExport: [.importExport]
        case .about: [.about]
        }
    }

    /// The row's value on the root, as the web's root shows them: the instruments played for
    /// Tunes, the recording quality for Recordings, and the appearance chosen on this device.
    /// Empty for the rest, and for the stored settings until read.
    func summary(_ summaries: SettingsSummaries?, appearance: Appearance) -> String {
        if self == .appearance { return appearance.label }
        guard let summaries else { return "" }
        return switch self {
        case .tunes: SettingsModel.instrumentsSummary(playing: summaries.instruments.contains)
        case .recordings: Vocabulary.audioQualityNames[summaries.audioQuality] ?? summaries.audioQuality
        case .appearance, .syncAndStorage, .importExport, .about: ""
        }
    }
}
