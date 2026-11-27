import Foundation

/// One shared case with the platform's overrides already merged into `expected`.
public struct SharedCase<Input: Decodable, Expected: Decodable> {
    public let name: String
    public let input: Input
    public let expected: Expected
}

extension SharedCase: Sendable where Input: Sendable, Expected: Sendable {}

public enum SharedCases {
    public enum Platform: String, CaseIterable {
        case web, apple, api
    }

    public struct LoadError: Error, CustomStringConvertible {
        public let description: String
    }

    /// The repository's `fixtures/` folder, found from this file's location.
    public static let root = URL(filePath: #filePath)
        .deletingLastPathComponent()  // CrosstuneTestSupport
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // CrosstuneKit
        .deletingLastPathComponent()  // apple
        .deletingLastPathComponent()  // repository root
        .appending(path: "fixtures", directoryHint: .isDirectory)

    private static let allowedKeys: Set<String> = ["description", "input", "expected", "platform_overrides"]

    /// Load every case in `fixtures/<folder>`, sorted by file name.
    public static func load<Input: Decodable, Expected: Decodable>(
        _ folder: String, platform: Platform
    ) throws -> [SharedCase<Input, Expected>] {
        let directory = root.appending(path: folder, directoryHint: .isDirectory)
        let directoryPath = directory.path(percentEncoded: false)
        let entries: [String]
        do {
            entries = try FileManager.default.contentsOfDirectory(atPath: directoryPath)
        } catch CocoaError.fileReadNoSuchFile {
            entries = []
        } catch {
            throw LoadError(description: "fixtures/\(folder) could not be listed: \(error)")
        }
        let names = entries.filter { $0.hasSuffix(".json") }.sorted()
        guard !names.isEmpty else {
            throw LoadError(description: "fixtures/\(folder) has no case files; expected at least one .json file")
        }
        return try names.map { try loadFile(directory.appending(path: $0), platform: platform) }
    }

    /// Load every case in `fixtures/<folder>` as a suite's test arguments, which are read before
    /// any test runs and so cannot throw. Stops the test process on a malformed case or when fewer
    /// than `minimum` load, so a deleted or misplaced fixture cannot pass with no cases.
    public static func loadOrTrap<Input: Decodable, Expected: Decodable>(
        _ folder: String, platform: Platform, minimum: Int
    ) -> [SharedCase<Input, Expected>] {
        let cases: [SharedCase<Input, Expected>]
        do {
            cases = try load(folder, platform: platform)
        } catch {
            fatalError("\(error)")
        }
        guard cases.count >= minimum else {
            fatalError("fixtures/\(folder) has \(cases.count) cases; expected at least \(minimum)")
        }
        return cases
    }

    /// Load one case file, so a refusal can be tested against a single file.
    public static func loadFile<Input: Decodable, Expected: Decodable>(
        _ file: URL, platform: Platform
    ) throws -> SharedCase<Input, Expected> {
        let fileName = file.lastPathComponent
        func fail(_ rule: String) -> LoadError { LoadError(description: "\(fileName): \(rule)") }

        func describe(_ value: Any?) -> String {
            guard let value else { return "nothing" }
            guard JSONSerialization.isValidJSONObject([value]),
                let data = try? JSONSerialization.data(withJSONObject: [value]),
                let text = String(data: data, encoding: .utf8)
            else { return "\(value)" }
            return String(text.dropFirst().dropLast())
        }
        func asObject(_ value: Any?, _ label: String) throws -> [String: Any] {
            guard let result = value as? [String: Any] else {
                throw fail("\(label) must be an object, got \(describe(value))")
            }
            return result
        }
        func asNonEmptyString(_ value: Any?, _ label: String) throws -> String {
            guard let text = value as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw fail("\(label) must be a non-empty string, got \(describe(value))")
            }
            return text
        }

        let data = try Data(contentsOf: file)
        let object = try asObject(try JSONSerialization.jsonObject(with: data), "the top level")
        let unknownKeys = Set(object.keys).subtracting(allowedKeys).sorted()
        guard unknownKeys.isEmpty else {
            throw fail("top-level key \(unknownKeys) is not one of \(allowedKeys.sorted())")
        }

        _ = try asNonEmptyString(object["description"], "\"description\"")
        _ = try asObject(object["input"], "\"input\"")
        var expected = try asObject(object["expected"], "\"expected\"")
        let overrides = try asObject(object["platform_overrides"] ?? [String: Any](), "\"platform_overrides\"")
        let known = expected.keys.sorted()
        var platformFields: [String: Any] = [:]
        for (overridePlatform, rawOverride) in overrides.sorted(by: { $0.key < $1.key }) {
            let label = "override \"\(overridePlatform)\""
            guard Platform(rawValue: overridePlatform) != nil else {
                throw fail("\(label) is not one of \(Platform.allCases.map(\.rawValue))")
            }
            let override = try asObject(rawOverride, label)
            _ = try asNonEmptyString(override["reason"], "\(label) \"reason\"")
            let fields = try asObject(override["fields"], "\(label) \"fields\"")
            for field in fields.keys where expected[field] == nil {
                throw fail("\(label) field \"\(field)\" is absent from expected, which has \(known)")
            }
            if overridePlatform == platform.rawValue { platformFields = fields }
        }
        for (field, value) in platformFields { expected[field] = value }

        // Overrides change only `expected`, so `input` decodes from the file as read.
        let decoder = JSONDecoder()
        let input: Input
        do {
            input = try decoder.decode(InputOnly<Input>.self, from: data).input
        } catch {
            throw fail("\"input\" does not decode as \(Input.self): \(error)")
        }
        let decodedExpected: Expected
        do {
            decodedExpected = try decoder.decode(
                Expected.self, from: try JSONSerialization.data(withJSONObject: expected))
        } catch {
            throw fail("\"expected\" does not decode as \(Expected.self): \(error)")
        }
        return SharedCase(
            name: file.deletingPathExtension().lastPathComponent, input: input, expected: decodedExpected)
    }
}

/// A case file's `input`, decoded without the rest of the file.
private struct InputOnly<Input: Decodable>: Decodable {
    let input: Input
}
