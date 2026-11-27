import CrosstuneTestSupport
import Foundation
import Testing

private struct LoaderInput: Decodable { let value: Int }
private struct LoaderExpected: Decodable, Equatable {
    let rows: [String]
    let count: Int
}

private func failureMessage(_ body: () throws -> Void) -> String? {
    do {
        try body()
        return nil
    } catch {
        return String(describing: error)
    }
}

/// Exercises the loader against fixtures/loader-checks; the web and API loaders read the same folder.
@Suite struct SharedCasesLoaderTests {
    @Test func appliesTheOverrideOnlyOnItsOwnPlatform() throws {
        let apple: [SharedCase<LoaderInput, LoaderExpected>] = try SharedCases.load("loader-checks", platform: .apple)
        let web: [SharedCase<LoaderInput, LoaderExpected>] = try SharedCases.load("loader-checks", platform: .web)
        let api: [SharedCase<LoaderInput, LoaderExpected>] = try SharedCases.load("loader-checks", platform: .api)

        #expect(apple.map(\.expected) == [LoaderExpected(rows: ["apple"], count: 1)])
        #expect(web.map(\.expected) == [LoaderExpected(rows: ["shared"], count: 1)])
        #expect(api.map(\.expected) == [LoaderExpected(rows: ["shared"], count: 1)])
        #expect(apple.first?.name == "valid")
    }

    @Test(arguments: [
        ("unknown-key.json", "notes"),
        ("override-without-reason.json", "reason"),
        ("override-unknown-field.json", "missing"),
        ("expected-not-object.json", "\"expected\""),
        ("input-missing.json", "\"input\""),
        ("input-not-object.json", "\"input\""),
        ("overrides-null.json", "\"platform_overrides\""),
        ("description-empty.json", "\"description\""),
        ("overrides-not-object.json", "\"platform_overrides\""),
        ("override-not-object.json", "\"apple\" must be an object"),
        ("override-fields-missing.json", "\"fields\""),
        ("override-fields-not-object.json", "\"fields\""),
        ("override-unknown-platform.json", "\"android\""),
    ])
    func refusesAnInvalidCaseAndNamesTheFileAndRule(fileName: String, brokenValue: String) {
        let message = failureMessage {
            let _: SharedCase<LoaderInput, LoaderExpected> = try SharedCases.loadFile(
                SharedCases.root.appending(path: "loader-checks/invalid/\(fileName)"), platform: .apple)
        }
        #expect(message?.contains(fileName) == true)
        #expect(message?.contains(brokenValue) == true)
    }

    @Test func refusesAFolderWithNoCases() {
        let message = failureMessage {
            let _: [SharedCase<LoaderInput, LoaderExpected>] = try SharedCases.load(
                "loader-checks/does-not-exist", platform: .apple)
        }
        #expect(message?.contains("no case files") == true)
    }
}
