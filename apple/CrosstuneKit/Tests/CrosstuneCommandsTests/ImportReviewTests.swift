import CrosstuneStore
import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneCommands

/// The cases the web client's `buildReview` passes too, so both clients build the same rows.
private let reviewFixture = URL(filePath: #filePath)
    .deletingLastPathComponent()  // CrosstuneCommandsTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // CrosstuneKit
    .deletingLastPathComponent()  // apple
    .deletingLastPathComponent()  // repository root
    .appending(path: "fixtures/import/review.json")

private struct ReviewCase: Decodable, CustomTestStringConvertible, Sendable {
    struct CatalogTune: Decodable, Sendable {
        let title: String
        let alternateTitles: [String]

        enum CodingKeys: String, CodingKey {
            case title
            case alternateTitles = "alternate_titles"
        }
    }

    struct Row: Decodable, Sendable {
        let title: String
        let duplicate: Bool
        let warnings: [String]
    }

    let name: String
    // The builder takes every tune not deleted, archived included, so `archived` is not read.
    let catalog: [CatalogTune]
    let titles: [String]
    let expected: [Row]

    var testDescription: String { name }
}

private let reviewCases: [ReviewCase] =
    (try? JSONDecoder().decode([ReviewCase].self, from: Data(contentsOf: reviewFixture))) ?? []

private func readOf(_ titles: [String], lineCount: Int? = nil) -> PlainListRead {
    PlainListRead(
        candidates: titles.map { PlainCandidate(title: $0, source: $0) }, lineCount: lineCount ?? titles.count)
}

private func scalars(_ text: String) -> [UInt32] { text.unicodeScalars.map(\.value) }

private func review(_ rows: [ImportRow], dropped: Int = 0, lineCount: Int? = nil) -> ImportReview {
    ImportReview(rows: rows, dropped: dropped, lineCount: lineCount ?? rows.count)
}

private func row(_ id: Int, warnings: [ImportWarning] = []) -> ImportRow {
    ImportRow(
        id: id, title: "Tune \(id)", source: "Tune \(id)", duplicate: false, included: true, warnings: warnings)
}

@Suite struct ImportReviewTests {
    @Test func findsTheSharedFixture() {
        #expect(reviewCases.count >= 7)
    }

    @Test(arguments: reviewCases)
    fileprivate func buildsTheSharedCase(_ fixture: ReviewCase) {
        let catalog = fixture.catalog.map { Tune(title: $0.title, alternateTitles: $0.alternateTitles) }
        let built = ImportReviewBuilder.build(readOf(fixture.titles), catalog: catalog)
        #expect(built.rows.map { scalars($0.title) } == fixture.expected.map { scalars($0.title) })
        #expect(built.rows.map(\.duplicate) == fixture.expected.map(\.duplicate))
        #expect(built.rows.map { $0.warnings.map(\.rawValue) } == fixture.expected.map(\.warnings))
        #expect(built.rows.map(\.included) == fixture.expected.map { !$0.duplicate })
        #expect(built.rows.map(\.id) == Array(fixture.expected.indices))
    }

    @Test func dropsRowsPastTheLimit() {
        let titles = (0...ImportReviewBuilder.limit).map { "Tune \($0)" }
        let built = ImportReviewBuilder.build(readOf(titles), catalog: [])
        #expect(built.rows.count == ImportReviewBuilder.limit)
        #expect(built.dropped == 1)
    }

    @Test func countsTheLimitAfterMerging() {
        let titles = (0..<ImportReviewBuilder.limit).map { "Tune \($0)" } + ["tune 0"]
        let built = ImportReviewBuilder.build(readOf(titles), catalog: [])
        #expect(built.rows.count == ImportReviewBuilder.limit)
        #expect(built.dropped == 0)
    }

    @Test func mergesALaterCopyOfADroppedRowInsteadOfDroppingItAgain() {
        let titles = (0..<ImportReviewBuilder.limit).map { "Tune \($0)" } + ["Extra", "extra"]
        let built = ImportReviewBuilder.build(readOf(titles), catalog: [])
        #expect(built.rows.count == ImportReviewBuilder.limit)
        #expect(built.dropped == 1)
    }

    @Test func carriesTheSourceLineAndTheLineCount() {
        let read = PlainListRead(candidates: [PlainCandidate(title: "A", source: "A / B")], lineCount: 3)
        let built = ImportReviewBuilder.build(read, catalog: [])
        #expect(built.rows.first?.source == "A / B")
        #expect(built.lineCount == 3)
    }
}

@Suite struct ImportReviewHelpTests {
    @Test func aWarningSuggestsHelp() {
        #expect(review([row(0), row(1, warnings: [.shortened])]).suggestsHelp)
    }

    @Test func droppedRowsSuggestHelp() {
        #expect(review([row(0), row(1)], dropped: 1).suggestsHelp)
    }

    @Test func oneRowFrom21LinesSuggestsHelp() {
        #expect(review([row(0)], lineCount: 21).suggestsHelp)
    }

    @Test func oneRowFrom20LinesDoesNot() {
        #expect(!review([row(0)], lineCount: 20).suggestsHelp)
    }

    @Test func aCleanListOfSeveralRowsDoesNot() {
        #expect(!review([row(0), row(1), row(2)], lineCount: 30).suggestsHelp)
    }
}

@Suite struct ImportDuplicateTests {
    let catalog = foldedTitles([Tune(title: "F\u{EA}te")])

    @Test func followsAnEditedTitle() {
        #expect(ImportReviewBuilder.isDuplicate("Fete", titles: catalog))
        #expect(!ImportReviewBuilder.isDuplicate("Other", titles: catalog))
    }

    @Test func aBlankTitleIsNeverADuplicate() {
        #expect(!ImportReviewBuilder.isDuplicate("", titles: catalog))
        #expect(!ImportReviewBuilder.isDuplicate("   ", titles: catalog))
        #expect(!ImportReviewBuilder.isDuplicate("", titles: foldedTitles([Tune(title: "")])))
    }

    @Test func matchesAnAlternateTitle() {
        let titles = foldedTitles([Tune(title: "Soldier's Joy", alternateTitles: ["Soldiers Joy"])])
        #expect(ImportReviewBuilder.isDuplicate(" soldiers joy ", titles: titles))
    }
}
