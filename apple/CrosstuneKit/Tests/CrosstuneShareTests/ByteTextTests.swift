import CrosstuneShare
import Testing

struct ByteTextTests {
    @Test(arguments: [
        (999, "999 B"), (1_499, "1 KB"), (999_000, "999 KB"), (1_000_000, "1 MB"), (1_999_999, "1.9 MB"),
        (12_340_000, "12.3 MB"), (999_999_999, "999.9 MB"), (2_000_000_000, "2 GB"), (5_380_000_000, "5.3 GB"),
    ])
    func truncatesLargeSizesRatherThanRounding(bytes: Int64, text: String) {
        #expect(ByteText.bytes(bytes) == text)
    }
}
