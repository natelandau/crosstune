import Foundation
import Testing

@testable import CrosstuneCommands

/// The cases the web client's `readPlainList` passes too, so both clients read a list the same way.
private let plainListFixture = URL(filePath: #filePath)
    .deletingLastPathComponent()  // CrosstuneCommandsTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // CrosstuneKit
    .deletingLastPathComponent()  // apple
    .deletingLastPathComponent()  // repository root
    .appending(path: "fixtures/import/plain-list.json")

private struct PlainListCase: Decodable, CustomTestStringConvertible, Sendable {
    let name: String
    let input: String
    let titles: [String]
    let lineCount: Int

    var testDescription: String { name }
}

private let plainListCases: [PlainListCase] =
    (try? JSONDecoder().decode([PlainListCase].self, from: Data(contentsOf: plainListFixture))) ?? []

/// A string's scalars, since `==` on `String` calls canonically equivalent spellings equal.
private func scalars(_ text: String) -> [UInt32] { text.unicodeScalars.map(\.value) }

@Suite struct PlainListReaderTests {
    @Test func findsTheSharedFixture() {
        #expect(plainListCases.count >= 18)
    }

    @Test(arguments: plainListCases)
    fileprivate func readsTheSharedCase(_ fixture: PlainListCase) {
        let read = PlainListReader.read(fixture.input)
        #expect(read.candidates.map { scalars($0.title) } == fixture.titles.map(scalars))
        #expect(read.lineCount == fixture.lineCount)
    }

    @Test func carriesTheTrimmedLineAsEverySplitTitlesSource() {
        let read = PlainListReader.read("  1. Silver Spear / Mason's Apron \r\nReel")
        #expect(
            read.candidates == [
                PlainCandidate(title: "Silver Spear", source: "1. Silver Spear / Mason's Apron"),
                PlainCandidate(title: "Mason's Apron", source: "1. Silver Spear / Mason's Apron"),
                PlainCandidate(title: "Reel", source: "Reel"),
            ])
    }

    @Test func keepsDecomposedTextAsWritten() {
        let read = PlainListReader.read("- Fe\u{302}te")
        #expect(read.candidates.map { scalars($0.title) } == [scalars("Fe\u{302}te")])
    }
}
