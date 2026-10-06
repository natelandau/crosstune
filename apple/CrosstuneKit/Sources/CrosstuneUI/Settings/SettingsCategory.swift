import Foundation

/// A page of the iPhone Settings root: a row there, a page of its own when pushed.
enum SettingsCategory: CaseIterable, Hashable {
    case instruments
    case musicServices
    case recording
    case appearance
    case syncAndStorage

    nonisolated static let syncAndStorageTitle = "Sync and storage"

    var title: String {
        switch self {
        case .instruments: SettingsModel.instruments
        case .musicServices: SettingsModel.musicServices
        case .recording: SettingsModel.recording
        case .appearance: Appearance.title
        case .syncAndStorage: Self.syncAndStorageTitle
        }
    }

    var systemImage: String {
        switch self {
        case .instruments: "guitars"
        case .musicServices: "music.note.list"
        case .recording: "waveform"
        case .appearance: "circle.lefthalf.filled"
        case .syncAndStorage: "arrow.triangle.2.circlepath"
        }
    }

    /// The settings form's groups the page shows. Instruments and music services have pages of
    /// their own, so no group of the form stands for them.
    var sections: SettingsScreen.Sections {
        switch self {
        case .instruments, .musicServices: []
        case .recording: [.recording]
        case .appearance: [.appearance]
        case .syncAndStorage: [.sync, .storage, .downloads]
        }
    }

    /// The settings form's groups a page builds from its own views instead of a form section.
    var pageRows: SettingsScreen.Sections {
        switch self {
        case .instruments: [.instruments]
        case .musicServices: [.musicServices, .appleMusic]
        case .recording, .appearance, .syncAndStorage: []
        }
    }
}
