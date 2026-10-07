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
        #expect(
            declared["NSPrivacyCollectedDataTypeProductInteraction"]
                == Declared(linked: true, tracking: false, purposes: [analytics]))
        // PostHog's GeoIP derives a country and city from the request.
        #expect(
            declared["NSPrivacyCollectedDataTypeCoarseLocation"]
                == Declared(linked: true, tracking: false, purposes: [analytics]))
        // PostHog's app lifecycle events, kept for retention.
        #expect(
            declared["NSPrivacyCollectedDataTypeOtherUsageData"]
                == Declared(linked: true, tracking: false, purposes: [analytics]))
        #expect(declared.values.allSatisfy { !$0.tracking })
    }

    @Test func declaresTheAccountNameAndTheScans() throws {
        let declared = try Self.declared()
        let functionality = Declared(
            linked: true, tracking: false, purposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"])

        // Clerk receives the name a sign-in provider shares, and the account holds it.
        #expect(declared["NSPrivacyCollectedDataTypeName"] == functionality)
        // Camera scans and photo library uploads, stored with the account.
        #expect(declared["NSPrivacyCollectedDataTypePhotosorVideos"] == functionality)
    }
}
