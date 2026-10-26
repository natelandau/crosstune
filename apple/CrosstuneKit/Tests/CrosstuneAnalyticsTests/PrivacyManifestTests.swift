import Foundation
import Testing

/// The app's privacy manifest declares what the analytics sends, so the App Store label matches.
struct PrivacyManifestTests {
    struct Declared: Equatable {
        let linked: Bool
        let tracking: Bool
        let purposes: Set<String>
    }

    static func declared() throws -> [String: Declared] {
        let url = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appending(path: "Crosstune/PrivacyInfo.xcprivacy")
        let plist = try PropertyListSerialization.propertyList(from: Data(contentsOf: url), format: nil)
        let types = try #require((plist as? [String: Any])?["NSPrivacyCollectedDataTypes"] as? [[String: Any]])
        var declared: [String: Declared] = [:]
        for type in types {
            let name = try #require(type["NSPrivacyCollectedDataType"] as? String)
            declared[name] = Declared(
                linked: try #require(type["NSPrivacyCollectedDataTypeLinked"] as? Bool),
                tracking: try #require(type["NSPrivacyCollectedDataTypeTracking"] as? Bool),
                purposes: Set(try #require(type["NSPrivacyCollectedDataTypePurposes"] as? [String])))
        }
        return declared
    }

    @Test func declaresWhatAnalyticsSendsAndNoneOfItForTracking() throws {
        let declared = try Self.declared()
        let analytics = "NSPrivacyCollectedDataTypePurposeAnalytics"

        // The person is keyed by the signed-in user's ID.
        #expect(declared["NSPrivacyCollectedDataTypeUserID"]?.purposes.contains(analytics) == true)
        // Sentry's crash reports carry the screens visited before the crash.
        #expect(
            declared["NSPrivacyCollectedDataTypeProductInteraction"]
                == Declared(
                    linked: true, tracking: false,
                    purposes: [analytics, "NSPrivacyCollectedDataTypePurposeAppFunctionality"]))
        // PostHog's GeoIP derives a country and city from the request, and with Precise Location
        // off a recording keeps the approximate fix.
        #expect(
            declared["NSPrivacyCollectedDataTypeCoarseLocation"]
                == Declared(
                    linked: true, tracking: false,
                    purposes: [analytics, "NSPrivacyCollectedDataTypePurposeAppFunctionality"]))
        // PostHog's app lifecycle events, kept for retention.
        #expect(
            declared["NSPrivacyCollectedDataTypeOtherUsageData"]
                == Declared(linked: true, tracking: false, purposes: [analytics]))
        // Sync, upload, and export failure events carry a failure reason, Sentry's error reports
        // carry error details, and the API keeps each account's app version to enforce the
        // minimum supported version.
        #expect(
            declared["NSPrivacyCollectedDataTypeOtherDiagnosticData"]
                == Declared(
                    linked: true, tracking: false,
                    purposes: [analytics, "NSPrivacyCollectedDataTypePurposeAppFunctionality"]))
        #expect(declared.values.allSatisfy { !$0.tracking })
    }

    @Test func declaresTheAccountNameTheScansAndWhereRecordingsWereMade() throws {
        let declared = try Self.declared()
        let functionality = Declared(
            linked: true, tracking: false, purposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"])

        // Clerk receives the name a sign-in provider shares, and the account holds it.
        #expect(declared["NSPrivacyCollectedDataTypeName"] == functionality)
        // Camera scans and photo library uploads, stored with the account.
        #expect(declared["NSPrivacyCollectedDataTypePhotosorVideos"] == functionality)
        // Where a recording was recorded, stored with the recording at the device's full accuracy.
        #expect(declared["NSPrivacyCollectedDataTypePreciseLocation"] == functionality)
    }

    @Test func declaresThePurchaseHistoryRevenueCatKeeps() throws {
        let declared = try Self.declared()

        let purposes: Set = [
            "NSPrivacyCollectedDataTypePurposeAppFunctionality", "NSPrivacyCollectedDataTypePurposeAnalytics",
        ]

        // RevenueCat keys purchases by the signed-in user's ID, so they link to the person.
        #expect(
            declared["NSPrivacyCollectedDataTypePurchaseHistory"]
                == Declared(linked: true, tracking: false, purposes: purposes))
    }

    @Test func declaresCrashDataNotLinked() throws {
        let declared = try Self.declared()

        // Sentry's crash reports carry a random per-install ID, never the account.
        #expect(
            declared["NSPrivacyCollectedDataTypeCrashData"]
                == Declared(
                    linked: false, tracking: false,
                    purposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]))
        // Hang and error reports are crash data. No timing or performance metrics are sent.
        #expect(declared["NSPrivacyCollectedDataTypePerformanceData"] == nil)
    }
}
