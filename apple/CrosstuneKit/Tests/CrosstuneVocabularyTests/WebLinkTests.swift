import CrosstuneVocabulary
import Foundation
import Testing

struct WebLinkTests {
    @Test(arguments: [
        ("https://example.com/a", "https://example.com/a"),
        ("  http://example.com  ", "http://example.com"),
        ("example.com/tune", "https://example.com/tune"),
        ("www.youtube.com/watch?v=x", "https://www.youtube.com/watch?v=x"),
    ])
    func opensWebLinks(raw: String, expected: String) {
        #expect(WebLink.url(raw)?.absoluteString == expected)
    }

    @Test func trimsOnlyControlsAndSpacesAndDropsLineBreaks() {
        #expect(WebLink.url("\u{01}\t https://exa\nmple.com/a\r\n ")?.absoluteString == "https://example.com/a")
    }

    @Test(arguments: [
        "javascript:alert(1)", "file:///etc/passwd", "mailto:a@example.com", "tel:5551234", "",
        "https://exa mple.com", "exa mple.com/tune", "\u{00A0}https://example.com",
    ])
    func refusesEveryOtherScheme(raw: String) {
        #expect(WebLink.url(raw) == nil)
    }

    /// The limit counts code points, so a link of multi-byte characters at the limit still fits.
    @Test(arguments: [
        ("https://example.com/", "a", 0, true),
        ("https://example.com/", "é", 0, true),
        ("https://example.com/", "a", 1, false),
        ("spotify:track:", "a", 0, false),
    ])
    func storesWebLinksWithinTheLengthLimit(prefix: String, fill: String, over: Int, storable: Bool) {
        let length = Vocabulary.Limits.Link.url - prefix.unicodeScalars.count + over
        let raw = prefix + String(repeating: fill, count: length)
        #expect(WebLink.isStorable(raw) == storable)
    }
}
