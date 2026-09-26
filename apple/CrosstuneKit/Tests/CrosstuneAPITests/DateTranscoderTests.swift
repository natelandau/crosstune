import Foundation
import Testing

@testable import CrosstuneAPI

@Suite struct APIDateTranscoderTests {
    @Test func writesEveryMillisecondAsStamped() throws {
        let transcoder = APIDateTranscoder()
        let start: Int64 = 1_790_000_000_000
        for step in Int64(0)..<5_000 {
            let milliseconds = start + step * 7_919
            let date = Date(timeIntervalSince1970: Double(milliseconds) / 1000)
            let text = try transcoder.encode(date)
            let fraction = try #require(Int64(text.split(separator: ".").last?.dropLast() ?? ""))
            #expect(fraction == milliseconds % 1000, "\(text) for \(milliseconds)")
        }
    }

    @Test func cutsTheAPIsMicrosecondsToMilliseconds() throws {
        let transcoder = APIDateTranscoder()
        let date = try transcoder.decode("2026-09-21T02:15:40.123999Z")
        #expect(try transcoder.encode(date) == "2026-09-21T02:15:40.123Z")
    }

    @Test func writesAWholeSecondWithAZeroFraction() throws {
        let transcoder = APIDateTranscoder()
        let date = try transcoder.decode("2026-09-21T02:15:40Z")
        #expect(try transcoder.encode(date) == "2026-09-21T02:15:40.000Z")
    }
}
