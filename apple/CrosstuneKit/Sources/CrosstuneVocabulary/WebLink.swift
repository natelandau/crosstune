import Foundation

/// Which typed or shared links the app stores and opens. One rule for every path that adds a
/// link, the share extension's included, so none stores a link another refuses.
public enum WebLink {
    /// Where a link may send the musician, or nil when it must not be opened. A stored URL is
    /// whatever was pasted, and any scheme but http and https could hand it to another app. A
    /// bare host, pasted without a scheme, is read as https.
    public static func url(_ raw: String) -> URL? {
        // Read the way the web's URL parser reads it: C0 controls and spaces trimmed at either
        // end, tabs and newlines dropped anywhere. The API refuses a link on this same reading.
        let scalars = raw.unicodeScalars.filter { $0 != "\t" && $0 != "\n" && $0 != "\r" }
        let kept = scalars.drop { $0.value <= 0x20 }.reversed().drop { $0.value <= 0x20 }.reversed()
        let trimmed = String(String.UnicodeScalarView(kept))
        if let match = trimmed.prefixMatch(of: #/([A-Za-z][A-Za-z0-9+.\-]*):/#) {
            let scheme = match.1.lowercased()
            return scheme == "http" || scheme == "https" ? webURL(trimmed) : nil
        }
        return webURL("https://\(trimmed)")
    }

    /// Whether the API stores `raw`, already trimmed of spaces as stored: a web address within
    /// the URL's length limit, counted in code points as the API counts it.
    public static func isStorable(_ raw: String) -> Bool {
        raw.unicodeScalars.count <= Vocabulary.Limits.Link.url && url(raw) != nil
    }

    /// A host the web's parser would refuse, such as one holding a space, is refused here too,
    /// though Foundation would percent-encode it and carry on.
    private static func webURL(_ text: String) -> URL? {
        guard let url = URL(string: text), let host = url.host(percentEncoded: false), !host.isEmpty,
            !host.unicodeScalars.contains(where: { $0.value <= 0x20 })
        else { return nil }
        return url
    }
}
