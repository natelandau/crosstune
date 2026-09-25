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

@Test(arguments: ["", "2026-09-25", "2026-09-25T12:00:00", "not a time"])
func refusesTextThatIsNotATime(_ input: String) {
    #expect(Timestamp(iso: input) == nil)
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
