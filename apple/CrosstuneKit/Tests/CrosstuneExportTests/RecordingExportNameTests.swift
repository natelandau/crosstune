import CrosstuneStore
import Foundation
import Testing

@testable import CrosstuneExport

private let fixtureURL = URL(filePath: #filePath)
    .deletingLastPathComponent()  // CrosstuneExportTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // CrosstuneKit
    .deletingLastPathComponent()  // apple
    .deletingLastPathComponent()  // repository root
    .appending(path: "fixtures/export/recording-names.json")

private struct NameCase: Decodable, Sendable, CustomTestStringConvertible {
    let `case`: String
    let title: String
    let titleIsDate: Bool
    let recordedAt: String?
    let recordedPrecision: String?
    let `extension`: String

    var testDescription: String { `case` }

    enum CodingKeys: String, CodingKey {
        case `case`, title, `extension`
        case titleIsDate = "title_is_date"
        case recordedAt = "recorded_at"
        case recordedPrecision = "recorded_precision"
    }

    var input: NameInput {
        NameInput(
            title: title, titleIsDate: titleIsDate,
            recordedAt: recordedAt.flatMap { try? Date($0, strategy: .iso8601) },
            precision: recordedPrecision.flatMap(RecordingPrecision.init(rawValue:)),
            fileExtension: `extension`)
    }
}

private struct SingleCase: Decodable, Sendable, CustomTestStringConvertible {
    let item: NameCase
    let expected: String
    var testDescription: String { item.case }

    init(from decoder: any Decoder) throws {
        item = try NameCase(from: decoder)
        expected = try decoder.container(keyedBy: Key.self).decode(String.self, forKey: .expected)
    }
    private enum Key: String, CodingKey { case expected }
}

private struct BatchCase: Decodable, Sendable, CustomTestStringConvertible {
    let `case`: String
    let items: [NameCase]
    let expected: [String]
    var testDescription: String { `case` }
}

private struct NameFixture: Decodable, Sendable {
    let timeZone: String
    let single: [SingleCase]
    let batches: [BatchCase]

    enum CodingKeys: String, CodingKey {
        case single, batches
        case timeZone = "time_zone"
    }
}

private let fixture: NameFixture = {
    // swiftlint:disable:next force_try
    try! JSONDecoder().decode(NameFixture.self, from: Data(contentsOf: fixtureURL))
}()

private let zone = TimeZone(identifier: fixture.timeZone)!

@Test(arguments: fixture.single)
private func fileNameMatchesFixture(_ item: SingleCase) {
    #expect(fileNames([item.item.input], timeZone: zone) == [item.expected])
}

@Test(arguments: fixture.batches)
private func batchNamesStayDistinct(_ batch: BatchCase) {
    #expect(fileNames(batch.items.map(\.input), timeZone: zone) == batch.expected)
}
