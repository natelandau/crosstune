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

    /// What to call a link: what the provider says it is, else where it points.
    public static func title(_ link: RecordingLink) -> String {
        if let title = link.title, !title.isEmpty { return title }
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

    /// Where a link may send the musician, or nil when it must not be opened.
    public static func outboundURL(_ raw: String) -> URL? {
        WebLink.url(raw)
    }
}
