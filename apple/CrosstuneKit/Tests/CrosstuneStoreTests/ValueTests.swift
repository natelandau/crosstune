import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneStore

@Test(arguments: [
    ("2026-09-25T12:00:00.123456Z", "2026-09-25T12:00:00.123Z"),
    ("2026-09-25T12:00:00.999999Z", "2026-09-25T12:00:00.999Z"),
    ("2026-09-25T12:00:00Z", "2026-09-25T12:00:00.000Z"),
    ("2026-09-25T12:00:00.5Z", "2026-09-25T12:00:00.500Z"),
    ("2026-09-25T12:00:00.123+00:00", "2026-09-25T12:00:00.123Z"),
    ("2026-09-25T14:00:00.123+02:00", "2026-09-25T12:00:00.123Z"),
    ("1969-12-31T23:59:59.999Z", "1969-12-31T23:59:59.999Z"),
])
func readsTheAPIsTimesAtMillisecondPrecision(_ input: String, _ expected: String) throws {
    #expect(try #require(Timestamp(iso: input)).iso == expected)
}

@Test(arguments: ["", "2026-09-25", "2026-09-25T12:00:00", "not a time", "2026-09-25T12:00:00.\u{0663}Z"])
func refusesTextThatIsNotATime(_ input: String) {
    #expect(Timestamp(iso: input) == nil)
}

@Test(arguments: [
    "2026-09-25T12:00:00.123Z", "1969-12-31T23:59:59.999Z", "1970-01-01T00:00:00.000Z",
    "2000-02-29T23:59:59.999Z", "2024-02-29T00:00:00.001Z", "2100-12-31T23:59:59.999Z",
    "1900-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z", "2026-03-01T00:00:00.000Z",
])
func readsTheClientsOwnFormWithoutTheGeneralParser(_ input: String) throws {
    let fast = try #require(Timestamp.canonicalMilliseconds(input))
    #expect(fast == Timestamp.parsedMilliseconds(input))
    #expect(Timestamp(milliseconds: fast).iso == input)
}

@Test(arguments: [
    "2026-09-25T12:00:00.123456Z", "2026-09-25T12:00:00Z", "2026-09-25T12:00:00.5Z",
    "2026-09-25T14:00:00.123+02:00", "2026-02-30T12:00:00.000Z", "2026-13-01T12:00:00.000Z",
    "2026-09-25T24:00:00.000Z", "1899-12-31T23:59:59.999Z", "2026-09-25T12:00:00.\u{0663}23Z",
    "2026-09-25 12:00:00.123Z",
])
func leavesEveryOtherFormToTheGeneralParser(_ input: String) {
    #expect(Timestamp.canonicalMilliseconds(input) == nil)
    #expect(Timestamp(iso: input)?.milliseconds == Timestamp.parsedMilliseconds(input))
}

@Test func readsTimesAcrossTwoCenturiesAsTheGeneralParserDoes() {
    var milliseconds: Int64 = -86_400_000 * 3
    while milliseconds < 4_102_444_800_000 {
        let iso = Timestamp(milliseconds: milliseconds).iso
        #expect(Timestamp.canonicalMilliseconds(iso) == milliseconds)
        #expect(Timestamp.parsedMilliseconds(iso) == milliseconds)
        milliseconds += 604_799_937
    }
}

@Test func stampsPastTheStoredTimeWhenNeeded() {
    #expect(noon.stamped(after: nil) == noon)
    #expect(noon.stamped(after: later(-1)) == noon)
    #expect(noon.stamped(after: noon) == later(1))
    #expect(noon.stamped(after: later(10)) == later(11))
}

@Test func keepsDatesToTheMillisecond() {
    let date = Date(timeIntervalSince1970: 1_790_000_000.123_9)
    #expect(Timestamp(date).milliseconds == 1_790_000_000_123)
}

@Test func makesLowercaseVersionSevenIDsInTimeOrder() throws {
    let first = newID(at: noon)
    let second = newID(at: later(1))

    let uuid = try #require(UUID(uuidString: first))
    #expect(first == first.lowercased())
    #expect(uuid.uuid.6 >> 4 == 7)
    #expect(uuid.uuid.8 >> 6 == 0b10)
    #expect(first < second)
    #expect(newID(at: noon) != first)
}

@Test func roundTripsAnyJSON() throws {
    let text = #"{"a":null,"b":true,"c":9007199254740993,"d":1.5,"e":"x","f":[1,"y"],"g":{"h":false}}"#
    let value = try JSONDecoder().decode(JSONObject.self, from: Data(text.utf8))

    #expect(value["c"] == .integer(9_007_199_254_740_993))
    #expect(value["d"] == .number(1.5))
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    #expect(String(decoding: try encoder.encode(value), as: UTF8.self) == text)
}
