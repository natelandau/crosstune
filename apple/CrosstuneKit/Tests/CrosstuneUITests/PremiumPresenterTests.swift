import CrosstuneAnalytics
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@MainActor
private func eventually(_ condition: @MainActor () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("Timed out waiting for a condition")
}

private func entitlement(source: String?, expiresAt: Date? = nil) -> Entitlement {
    Entitlement(
        id: "entitlement-1", createdAt: noon, premiumSource: source, premiumExpiresAt: expiresAt.map(Timestamp.init),
        autoRenews: false, trialEndsAt: expiresAt.map(Timestamp.init), premiumQuotaBytes: 10_000,
        freeQuotaBytes: 1_000)
}

@MainActor
@Suite struct PremiumPresenterTests {
    private let root = TemporaryRoot()
    private let sink = RecordingAnalyticsSink()

    /// A plan model over a store holding `row`, once it has judged the row.
    private func plan(_ row: Entitlement?, kind: PlanKind) async throws -> PlanModel {
        let store = try root.open()
        if let row { try await store.write { writer in try row.upsert(writer.db) } }
        let model = PlanModel(store: store)
        try await eventually { model.isLoaded && model.plan.kind == kind }
        return model
    }

    @Test func aFreePlanPresentsTheSheetInsteadOfActing() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)

        #expect(presenter.gate(.recordings, from: .record) == false)
        #expect(presenter.presented == .recordings)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown",
                    properties: ["reason": .string("recordings"), "from": .string("record")])
            ])
    }

    @Test func aFreePlanGatesScansOffTheirTune() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)

        #expect(presenter.gate(.scans, from: .addScan) == false)
        #expect(presenter.presented == .scans)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown", properties: ["reason": .string("scans"), "from": .string("add_scan")])
            ])
    }

    @Test func aTrialActsAndSendsNothing() async throws {
        let ends = Date().addingTimeInterval(86_400)
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: "trial", expiresAt: ends), kind: .premium), analytics: sink.client)

        #expect(presenter.gate(.recordings, from: .upload) == true)
        #expect(presenter.gate(.scans, from: .scan) == true)
        #expect(presenter.presented == nil)
        #expect(sink.captures.isEmpty)
    }

    @Test func anUnknownPlanGatesNothing() async throws {
        let store = try root.open()
        let presenter = PremiumPresenter(plan: PlanModel(store: store), analytics: sink.client)

        #expect(presenter.gate(.recordings, from: .addToRecordings) == true)
        #expect(presenter.presented == nil)
        #expect(sink.captures.isEmpty)
    }

    @Test func sendsOncePerPresentation() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)

        _ = presenter.gate(.recordings, from: .record)
        // A second tap while the sheet is still up shows nothing new.
        _ = presenter.gate(.recordings, from: .record)
        #expect(sink.captures.count == 1)
        presenter.presented = nil
        _ = presenter.gate(.recordings, from: .upload)
        #expect(sink.captures.count == 2)
    }

    @Test func theCopyMatchesTheWeb() {
        #expect(PlanText.premiumRecordingsTitle == "Recordings are part of Premium")
        #expect(PlanText.premiumScansTitle == "Scans on more than one tune are part of Premium")
        #expect(
            PlanText.premiumRecordingsBody
                == "Premium keeps your recordings on our servers, so they play on every device. Every recording you already have stays: you can rename, file, delete, and export it on any plan."
        )
        #expect(
            PlanText.premiumScansBody(tuneTitle: "Soldier's Joy")
                == "On the free plan, scans open on one tune, \"Soldier's Joy\". Pages on other tunes stay: you can delete or export them."
        )
        #expect(PlanText.seePlan == "See your plan")
    }

    @Test func seePlanOpensTheAccountPageFromTheSettingsRoot() {
        let place = ShellPlace()
        place.tab = .recordings
        place.showSettingsPage(.stats)

        place.showSettingsPage(.account)

        #expect(place.tab == .settings)
        #expect(place.settingsPage == .account)
        #expect(place.settingsPath.count == 1)
    }

    #if os(macOS)
        @Test func seePlanPicksTheAccountTab() throws {
            let defaults = try #require(UserDefaults(suiteName: "PremiumPresenterTests"))
            defer { defaults.removePersistentDomain(forName: "PremiumPresenterTests") }

            MacSettingsTabs.select(.account, in: defaults)

            #expect(defaults.string(forKey: MacSettingsTabs.tabStorageKey) == "account")
        }
    #endif

    @Test func theSheetSaysWhatWasTapped() {
        #expect(PremiumSheet.title(.recordings) == PlanText.premiumRecordingsTitle)
        #expect(PremiumSheet.title(.scans) == PlanText.premiumScansTitle)
        #expect(PremiumSheet.message(.recordings, scanTuneTitle: nil) == PlanText.premiumRecordingsBody)
        #expect(PremiumSheet.message(.scans, scanTuneTitle: nil) == nil)
        #expect(
            PremiumSheet.message(.scans, scanTuneTitle: "Kitchen Girl")
                == PlanText.premiumScansBody(tuneTitle: "Kitchen Girl"))
    }

    @Test func aDimmedRowUnderTheTunePagesRecordingsLineReportsTheLine() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)
        let recording = Recording(id: "r1", tuneID: "t1", source: "microphone", addedAt: noon, state: "ready")
        let view = RecordingView(recording: recording, file: nil, tuneID: "t1", tuneTitle: "Kitchen Girl")

        TuneMediaRows.item(view) { _ in }.offerPremium(presenter)

        #expect(presenter.presented == .recordings)
        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown",
                    properties: ["reason": .string("recordings"), "from": .string("recordings_line")])
            ])
    }

    @Test func aDimmedRowOnTheRecordingsScreenReportsTheRow() async throws {
        let presenter = PremiumPresenter(
            plan: try await plan(entitlement(source: nil), kind: .free), analytics: sink.client)
        let recording = Recording(id: "r1", tuneID: nil, source: "microphone", addedAt: noon, state: "ready")
        let view = RecordingView(recording: recording, file: nil, tuneID: nil, tuneTitle: nil)

        RecordingItem(view: view, source: .recordingsList) { _ in }.offerPremium(presenter)

        #expect(
            sink.captures == [
                .init(
                    name: "premium_sheet_shown",
                    properties: ["reason": .string("recordings"), "from": .string("recording_row")])
            ])
    }

    @Test func theSheetScrollsAndGrowsForLargeText() {
        #expect(PremiumSheet.detents == [.medium, .large])
    }

    @Test func theEntriesAndReasonsNameThePlansValues() {
        #expect(PremiumReason.allCases.map(\.rawValue) == ["recordings", "scans"])
        #expect(
            PremiumEntry.allCases.map(\.rawValue) == [
                "record", "upload", "add_to_recordings", "recording_row", "recordings_line", "scan", "add_scan",
            ])
    }
}
