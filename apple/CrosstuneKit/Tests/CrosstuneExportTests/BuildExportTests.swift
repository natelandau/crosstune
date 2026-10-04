import CrosstuneStore
import Foundation
import Testing

@testable import CrosstuneExport

/// The golden fixture both clients build from, so the web and Apple exports stay byte for byte
/// the same.
private let fixtureDirectory = URL(filePath: #filePath)
    .deletingLastPathComponent()  // CrosstuneExportTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // CrosstuneKit
    .deletingLastPathComponent()  // apple
    .deletingLastPathComponent()  // repository root
    .appending(path: "fixtures/export", directoryHint: .isDirectory)

/// The file's exact bytes. String equality is canonical equivalence, which would pass an export
/// whose normalization differs from the fixture's.
private func fixtureBytes(_ name: String) throws -> [UInt8] {
    Array(try Data(contentsOf: fixtureDirectory.appending(path: name)))
}

private struct FixtureError: Error { let message: String }

private func fixtureInput() throws -> ExportInput {
    let data = try Data(contentsOf: fixtureDirectory.appending(path: "input.json"))
    let root = try JSONDecoder().decode(JSONObject.self, from: data)

    func objects(_ key: String) throws -> [JSONObject] {
        guard case .array(let values) = root[key] ?? .null else { throw FixtureError(message: "no \(key)") }
        return try values.map {
            guard case .object(let object) = $0 else { throw FixtureError(message: "\(key) holds a non-object") }
            return object
        }
    }
    func string(_ object: JSONObject, _ key: String) throws -> String {
        guard case .string(let value) = object[key] ?? .null else { throw FixtureError(message: "no \(key)") }
        return value
    }

    func ids(_ key: String) throws -> [String] {
        guard case .array(let values) = root[key] ?? .null else { throw FixtureError(message: "no \(key)") }
        return values.compactMap { if case .string(let value) = $0 { value } else { nil } }
    }

    guard case .array(let instruments) = root["instruments"] ?? .null,
        let timeZone = TimeZone(identifier: try string(root, "time_zone"))
    else { throw FixtureError(message: "no instruments or time zone") }

    return ExportInput(
        timeZone: timeZone,
        instruments: instruments.compactMap { if case .string(let value) = $0 { value } else { nil } },
        tunes: try objects("tunes").map(Tune.init(wire:)),
        userTunes: try objects("user_tunes").map(UserTune.init(wire:)),
        lists: try objects("lists").map(TuneList.init(wire:)),
        listItems: try objects("list_items").map(ListItem.init(wire:)),
        links: try objects("recording_links").map(RecordingLink.init(wire:)),
        recordings: try objects("recordings").map(Recording.init(wire:)),
        localAudio: try objects("local_files").map {
            LocalAudio(recordingID: try string($0, "recording_id"), fileExtension: try string($0, "extension"))
        },
        notationPages: try objects("notation_pages").map(NotationPageRecord.init(wire:)),
        localNotation: Set(try ids("local_notation_pages")))
}

private func emptyInput() -> ExportInput {
    ExportInput(
        timeZone: TimeZone(identifier: "America/New_York")!, instruments: [], tunes: [], userTunes: [], lists: [],
        listItems: [], links: [], recordings: [], localAudio: [])
}

private let newYearsDay = Timestamp(iso: "2026-01-01T00:00:00Z")!

private func tune(_ id: String, _ title: String, modes: [String] = [], tunings: JSONObject = [:], deleted: Bool = false)
    -> Tune
{
    Tune(
        id: id, createdAt: newYearsDay, deletedAt: deleted ? Timestamp(iso: "2026-01-02T00:00:00Z") : nil,
        title: title, modes: modes, tunings: tunings)
}

private func userTune(_ id: String, _ tuneID: String, status: String = "known") -> UserTune {
    UserTune(id: id, createdAt: newYearsDay, tuneID: tuneID, status: status)
}

private func recording(_ id: String, tuneID: String? = nil) -> Recording {
    Recording(
        id: id, createdAt: newYearsDay, tuneID: tuneID, source: "microphone",
        recordedAt: Timestamp(iso: "2026-01-01T12:00:00Z")!)
}

/// The fields of each tune row, for documents whose rows hold no quoted fields.
private func tuneRows(_ plan: ExportPlan) -> [[String]] {
    let lines = plan.tunesCSV.dropFirst().components(separatedBy: "\r\n")
    return lines.dropFirst().dropLast().map { $0.components(separatedBy: ",") }
}

private func column(_ name: String) -> Int { tunesHeader.firstIndex(of: name)! }

@Suite struct BuildExportTests {
    @Test func matchesTheGoldenFixtureByteForByte() throws {
        let plan = buildExport(try fixtureInput())
        #expect(Array(plan.tunesCSV.utf8) == (try fixtureBytes("tunes.csv")))
        #expect(Array(plan.listsCSV.utf8) == (try fixtureBytes("lists.csv")))
        let paths = plan.audio.map(\.path) + plan.notation.map(\.path)
        #expect(Array((paths.joined(separator: "\n") + "\n").utf8) == (try fixtureBytes("paths.txt")))
    }

    @Test func numbersEachTunesLiveOnDevicePagesFromOneInReadingOrder() throws {
        let plan = buildExport(try fixtureInput())
        let id = { (n: Int) in "00000000-0000-4000-8000-000000000\(n)" }
        #expect(plan.notation.map(\.pageID) == [723, 724, 711, 712, 702, 701].map(id))
        #expect(plan.notation.map(\.path).first == "notation/Untitled/1.jpg")
    }

    @Test func leavesOutPagesOfATuneThatIsNotExported() {
        var input = emptyInput()
        input.tunes = [tune("t1", "Gone", deleted: true)]
        input.userTunes = [userTune("u1", "t1")]
        input.notationPages = [
            NotationPageRecord(id: "p1", tuneID: "t1", width: 1, height: 1),
            NotationPageRecord(id: "p2", tuneID: "missing", width: 1, height: 1),
        ]
        input.localNotation = ["p1", "p2"]
        #expect(buildExport(input).notation.isEmpty)
    }

    @Test func pairsEachExportedPathWithItsRecording() throws {
        let plan = buildExport(try fixtureInput())
        let id = { (n: Int) in "00000000-0000-4000-8000-000000000\(n)" }
        #expect(plan.audio.map(\.recordingID) == [631, 611, 612, 613, 621, 641, 642, 643, 651, 681, 671, 691].map(id))
    }

    @Test func countsARecordingWithoutLocalAudioAsMissing() throws {
        let plan = buildExport(try fixtureInput())
        #expect(plan.totalRecordings - plan.audio.count == 1)
    }

    @Test func anEmptyAccountGivesHeadersOnlyAndNoAudio() {
        let plan = buildExport(emptyInput())
        #expect(plan.tunesCSV == csvDocument([tunesHeader]))
        #expect(plan.listsCSV == csvDocument([listsHeader]))
        #expect(plan.audio.isEmpty)
        #expect(plan.totalRecordings == 0)
    }

    @Test func writesAStatusOrModeThisClientDoesNotKnowAsStored() {
        var input = emptyInput()
        input.tunes = [tune("t1", "Reel", modes: ["lydian", "major"])]
        input.userTunes = [userTune("u1", "t1", status: "retired")]
        let row = tuneRows(buildExport(input))[0]
        #expect(row[column("status")] == "retired")
        #expect(row[column("modes")] == "A: lydian; B: Major")
    }

    @Test func lettersPartsPastZAsJavaScriptDoes() {
        var input = emptyInput()
        input.tunes = [tune("t1", "Reel", modes: Array(repeating: "major", count: 200))]
        input.userTunes = [userTune("u1", "t1")]
        let modes = tuneRows(buildExport(input))[0][column("modes")].components(separatedBy: "; ")
        #expect(modes.first == "A: Major")
        #expect(modes[26] == "[: Major")
        #expect(modes[199] == "\u{108}: Major")
    }

    @Test func namesAFileWithAnEmptyExtensionAsAudio() {
        var input = emptyInput()
        input.recordings = [recording("r1")]
        input.localAudio = [LocalAudio(recordingID: "r1", fileExtension: "")]
        #expect(buildExport(input).audio.map(\.path) == ["recordings/Unfiled/2026-01-01.audio"])
    }

    @Test func writesEveryStoredTuningWhenNoInstrumentsAreSet() {
        var input = emptyInput()
        input.tunes = [
            tune(
                "t1", "Reel",
                tunings: [
                    "guitar": .object(["tuning": .string("DADGAD")]),
                    "violin": .object(["tuning": .string("AEAE")]),
                ])
        ]
        input.userTunes = [userTune("u1", "t1")]
        #expect(tuneRows(buildExport(input))[0][column("tunings")] == "Violin: AEAE; Guitar: DADGAD")
    }

    @Test func writesEveryStoredTuningWhenNoInstrumentSetIsKnown() {
        var input = emptyInput()
        input.instruments = ["harp", "hurdy_gurdy"]
        input.tunes = [tune("t1", "Reel", tunings: ["guitar": .object(["tuning": .string("DADGAD")])])]
        input.userTunes = [userTune("u1", "t1")]
        #expect(tuneRows(buildExport(input))[0][column("tunings")] == "Guitar: DADGAD")
    }

    @Test func ordersTunesWithEqualTitlesAndDatesByUserTuneIDCodeUnits() {
        var input = emptyInput()
        input.tunes = [tune("t1", "reel"), tune("t2", "Reel")]
        input.userTunes = [userTune("b", "t1"), userTune("B", "t2")]
        #expect(tuneRows(buildExport(input)).map { $0[0] } == ["Reel", "reel"])
    }

    @Test func breaksATieByUTF16CodeUnitsNotUnicodeScalars() {
        // U+1F600 sorts before U+FF5E by UTF-16 code unit (0xD83D < 0xFF5E) but after it by scalar.
        var input = emptyInput()
        input.tunes = [tune("t1", "reel"), tune("t2", "Reel")]
        input.userTunes = [userTune("\u{1F600}", "t1"), userTune("\u{FF5E}", "t2")]
        #expect(tuneRows(buildExport(input)).map { $0[0] } == ["reel", "Reel"])
    }

    @Test func leavesOutAUserTuneWhoseTuneIsDeletedOrMissing() {
        var input = emptyInput()
        input.tunes = [tune("t1", "Gone", deleted: true)]
        input.userTunes = [userTune("u1", "t1"), userTune("u2", "missing")]
        input.recordings = [recording("r1", tuneID: "t1")]
        input.localAudio = [LocalAudio(recordingID: "r1", fileExtension: "m4a")]
        let plan = buildExport(input)
        #expect(plan.tunesCSV == csvDocument([tunesHeader]))
        #expect(plan.audio.map(\.path) == ["recordings/Unfiled/2026-01-01.m4a"])
    }

    @Test func givesATuneTitledUnfiledItsOwnFolder() {
        var input = emptyInput()
        input.tunes = [tune("t1", "Unfiled")]
        input.userTunes = [userTune("u1", "t1")]
        input.recordings = [recording("r1", tuneID: "t1"), recording("r2")]
        input.localAudio = [
            LocalAudio(recordingID: "r1", fileExtension: "m4a"), LocalAudio(recordingID: "r2", fileExtension: "m4a"),
        ]
        #expect(
            buildExport(input).audio.map(\.path) == [
                "recordings/Unfiled (2)/2026-01-01.m4a", "recordings/Unfiled/2026-01-01.m4a",
            ])
    }

    @Test(
        arguments: [
            ("take.M4A", "m4a"),
            ("take.wav", "wav"),
            ("take", "audio"),
            (nil, "audio"),
        ] as [(String?, String)])
    func readsTheExtensionFromTheStoredFileName(fileName: String?, fileExtension: String) {
        #expect(LocalAudio(recordingID: "r1", fileName: fileName).fileExtension == fileExtension)
    }
}
