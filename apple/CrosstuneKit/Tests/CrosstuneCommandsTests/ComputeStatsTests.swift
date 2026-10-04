import Foundation
import Testing

@testable import CrosstuneCommands

/// The cases the web stats module passes too, so both clients show the same page.
private let fixtureDirectory = URL(filePath: #filePath)
    .deletingLastPathComponent()  // CrosstuneCommandsTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // CrosstuneKit
    .deletingLastPathComponent()  // apple
    .deletingLastPathComponent()  // repository root
    .appending(path: "fixtures/stats", directoryHint: .isDirectory)

private let fixtureNames: [String] =
    ((try? FileManager.default.contentsOfDirectory(atPath: fixtureDirectory.path(percentEncoded: false))) ?? [])
    .filter { $0.hasSuffix(".json") }
    .sorted()

private struct Fixture: Decodable {
    let input: StatsInput
    let expected: Stats
}

@Suite struct ComputeStatsTests {
    @Test func findsTheSharedFixtures() {
        #expect(fixtureNames.count >= 14)
    }

    @Test(arguments: fixtureNames)
    func matchesTheSharedFixture(_ name: String) throws {
        let data = try Data(contentsOf: fixtureDirectory.appending(path: name))
        let fixture = try JSONDecoder().decode(Fixture.self, from: data)
        let stats = computeStats(fixture.input)
        #expect(stats == fixture.expected)
        // String equality is canonical equivalence, which would pass an NFD value where the fixture
        // holds NFC; the encoded bytes keep them apart.
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        #expect(try encoder.encode(stats) == encoder.encode(fixture.expected))
    }
}

@Suite struct FormatRecordedTests {
    @Test(arguments: [
        (0, "0 m"),
        (59_999, "0 m"),
        (720_000, "12 m"),
        (33_120_000, "9 h 12 m"),
    ])
    func formats(_ ms: Int, _ text: String) {
        #expect(formatRecorded(ms) == text)
    }
}

@Suite struct EquivalenceTextTests {
    @Test func everyEquivalenceHasItsText() {
        for entry in equivalences {
            #expect(
                equivalenceText(Stats.Equivalence(id: entry.id, n: 2), tuneTitle: "Sally Ann").hasPrefix("About 2 "))
        }
    }

    @Test(arguments: [
        (Stats.Equivalence(id: .tune, n: 140, tuneID: "t1"), "About 140 times through Soldier's Joy"),
        (Stats.Equivalence(id: .tune, n: 1, tuneID: "t1"), "About 1 time through Soldier's Joy"),
        (Stats.Equivalence(id: .lpSide, n: 3), "About 3 sides of an LP"),
        (Stats.Equivalence(id: .lpSide, n: 1), "About 1 side of an LP"),
        (Stats.Equivalence(id: .bostonDublin, n: 1_200), "About 1,200 flights from Boston to Dublin"),
        (Stats.Equivalence(id: .workWeek, n: 2), "About 2 working weeks"),
        (Stats.Equivalence(id: .crossCountry, n: 1), "About 1 drive from New York to Los Angeles"),
    ])
    func reads(_ equivalence: Stats.Equivalence, _ text: String) {
        #expect(equivalenceText(equivalence, tuneTitle: "Soldier's Joy") == text)
    }
}
