import CrosstuneStore
import CrosstuneVocabulary
import Foundation

/// How a linked recording reads in its row.
public enum LinkText {
    /// The second line's text for a link whose provider has no name of its own.
    public static let open = "Open"

    /// The provider's name. A provider this build predates reads as a plain link.
    public static func providerLabel(_ provider: String) -> String {
        Vocabulary.providerLabels[provider] ?? Vocabulary.providerLabels["other"]!
    }

    /// What to call a link: what the provider says it is, then what the musician called it,
    /// then where it points. A bare host names nothing, so it comes last.
    public static func title(_ link: RecordingLink) -> String {
        if let title = link.title, !title.isEmpty { return title }
        if let label = link.label, !label.isEmpty { return label }
        return outboundURL(link.url)?.host() ?? link.url
    }

    /// The link out's visible text: the provider, or "Open" for a plain link.
    public static func outboundLabel(_ link: RecordingLink) -> String {
        let label = providerLabel(link.provider)
        return label == providerLabel("other") ? open : label
    }

    /// The link out's spoken name: "Open Soldier's Joy on YouTube".
    public static func outboundName(_ link: RecordingLink) -> String {
        "\(open) \(title(link)) on \(providerLabel(link.provider))"
    }

    /// Where a link may send the musician, or nil when it must not be opened. A stored URL is
    /// whatever was pasted, and any scheme but http and https could hand it to another app. A
    /// bare host, pasted without a scheme, is read as https.
    public static func outboundURL(_ raw: String) -> URL? {
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

    /// A host the web's parser would refuse, such as one holding a space, is refused here too,
    /// though Foundation would percent-encode it and carry on.
    private static func webURL(_ text: String) -> URL? {
        guard let url = URL(string: text), let host = url.host(percentEncoded: false), !host.isEmpty,
            !host.unicodeScalars.contains(where: { $0.value <= 0x20 })
        else { return nil }
        return url
    }
}
