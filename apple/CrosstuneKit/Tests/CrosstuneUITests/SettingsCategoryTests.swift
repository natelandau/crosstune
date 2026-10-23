import CrosstuneCommands
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import SwiftUI
import Testing

@testable import CrosstuneUI

@Suite struct SettingsCategoryTests {
    @Test func rootListsSubjectsInOrder() {
        #expect(
            SettingsCategory.allCases == [
                .tunes, .recordings, .appearance, .tuner, .syncAndStorage, .importExport, .about,
            ])
        #expect(
            SettingsCategory.allCases.map(\.title) == [
                SettingsModel.tunes, SettingsModel.recordings, Appearance.title, SettingsModel.tuner,
                SettingsCategory.syncAndStorageTitle,
                ImportExportSections.title, SettingsScreen.about,
            ])
        #expect(SettingsModel.tunes == "Tunes")
    }

    @MainActor
    @Test func settingsPageHandsCompareByTheirPlaceAndPage() {
        let place = ShellPlace()
        let other = ShellPlace()
        let opener = SettingsPageOpener(place: place)
        #expect(opener == SettingsPageOpener(place: place))
        #expect(opener != SettingsPageOpener(place: other))

        opener(.stats)
        #expect(place.settingsPage == .stats)
        #expect(opener != SettingsPageOpener(place: place))

        let recorder = SettingsPageRecorder(place: place)
        #expect(recorder == SettingsPageRecorder(place: place))
        #expect(recorder != SettingsPageRecorder(place: other))
        recorder(.account)
        #expect(place.settingsPage == .account)
    }

    /// Every root row keeps its own identity, so the iPad root lists each page once and opens
    /// its own, and a row is rebuilt when the appearance changes.
    @Test func rootRowsKeepTheirOwnIdentity() throws {
        let pages = [SettingsPage.account, .stats] + SettingsCategory.allCases.map(SettingsPage.category)
        for scheme in [ColorScheme.light, .dark] {
            #expect(Set(pages.map { $0.rowIdentity(scheme) }).count == pages.count, "\(scheme)")
        }
        for page in pages {
            #expect(page.rowIdentity(.light) != page.rowIdentity(.dark), "\(page)")
        }
        let root = SourceScan.withoutComments(
            try SourceScan.text(at: SourceScan.sources.appending(path: "Phone/SettingsRoot.swift")))
        #expect(root.contains(".id(page.rowIdentity(colorScheme))"))
        #expect(!root.contains(".id(colorScheme)"))
    }

    @Test func tunesHoldsInstrumentsNewTunesAndServices() {
        #expect(SettingsCategory.tunes.sections == [.instrumentToggles, .newTunes, .serviceToggles, .appleMusic])
    }

    @Test func recordingsHoldsRecordingLocationsAndDownloads() {
        #expect(SettingsCategory.recordings.sections == [.recording, .savedLocations, .downloads])
    }

    @Test func syncAndStorageNoLongerHoldsDownloads() {
        #expect(SettingsCategory.syncAndStorage.sections == [.sync, .storage])
    }

    @Test func eachRootRowSumsUpItsPage() {
        let summaries = SettingsSummaries(
            instruments: ["five_string_banjo", "violin"], audioQuality: "high", tunerA4Hz: 442)
        #expect(SettingsCategory.tunes.summary(summaries, appearance: .system) == "Violin, 5-string banjo")
        #expect(
            SettingsCategory.recordings.summary(summaries, appearance: .system) == Vocabulary.audioQualityNames["high"])
        #expect(SettingsCategory.tuner.summary(summaries, appearance: .system) == "A4 = 442 Hz")
        #expect(SettingsCategory.tuner.title == "Tuner")
        #expect(SettingsCategory.tuner.systemImage == "gauge.with.needle")
        for category in [SettingsCategory.syncAndStorage, .importExport, .about] {
            #expect(category.summary(summaries, appearance: .system) == "", "\(category)")
        }
        let none = SettingsSummaries(instruments: [], audioQuality: "standard", tunerA4Hz: 440)
        #expect(SettingsCategory.tunes.summary(none, appearance: .system) == TuneFieldLabels.notSet)
    }

    /// Appearance is chosen on the device, so its row shows the choice without the stored settings.
    @Test(arguments: Appearance.allCases)
    func appearanceRowShowsTheChoice(appearance: Appearance) {
        #expect(SettingsCategory.appearance.summary(nil, appearance: appearance) == appearance.label)
    }

    @Test func rootRowsShowNothingUntilRead() {
        for category in SettingsCategory.allCases where category != .appearance {
            #expect(category.summary(nil, appearance: .dark) == "", "\(category)")
        }
    }

    @Test @MainActor func rootSummariesFollowTheStoredSettings() async throws {
        let root = TemporaryRoot()
        let store = try await SampleCatalog.copiedStore(root: root.url)
        let commands = Commands(store: store)
        try await commands.setInstruments(clerkUserID: store.userID, instruments: ["violin", "mandolin"])
        try await commands.setAudioQuality(clerkUserID: store.userID, quality: "high")
        let row = settingsID(clerkUserID: store.userID)

        let summaries = try await store.read { try SettingsSummaries.fetch($0, settingsRow: row) }

        #expect(SettingsCategory.tunes.summary(summaries, appearance: .system) == "Violin, Mandolin")
        #expect(
            SettingsCategory.recordings.summary(summaries, appearance: .system) == Vocabulary.audioQualityNames["high"])
    }
}

@Suite struct SettingsModelAnalyticsTests {
    /// A settings model built without the environment's client sends no `settingChanged`, so
    /// the same toggle would report in one place and not another.
    @Test func everySettingsModelReportsToTheEnvironmentsClient() throws {
        var built = 0
        for file in SourceScan.files() {
            let text = SourceScan.withoutComments(try SourceScan.text(at: file))
            var rest = text.startIndex
            while let found = text.range(of: "SettingsModel(", range: rest..<text.endIndex) {
                let open = text.index(before: found.upperBound)
                let call = SourceScan.call(in: text, opening: open)
                #expect(call.contains("analytics:"), "\(SourceScan.relative(file)): \(call)")
                built += 1
                rest = found.upperBound
            }
        }
        #expect(built >= 2)
    }
}
