import CrosstuneStore
import Foundation

/// Everything a linked recording's row shows. A link the player can embed plays in the app; any
/// other opens the provider's own site.
public struct LinkRowContent: Hashable, Sendable {
    /// What a tap on the row does.
    public enum Tap: Hashable, Sendable {
        case play
        case close
        case open(URL)
    }

    public let glyph: MediaGlyph
    public let title: String
    /// What a tap would do, spoken before the title.
    public let verb: String?
    /// What a tap does, or nil for a link that can neither play nor open.
    public let tap: Tap?
    /// Where the second line's link out goes, or nil when the link must not be opened.
    public let outboundURL: URL?
    /// The link out's visible text: the provider, or "Open".
    public let outboundLabel: String
    /// The link out's spoken name: "Open Soldier's Joy on YouTube".
    public let outboundName: String
    /// A play while a take is recorded keeps its name and tap but reads dimmed.
    public let isDimmed: Bool
    /// Why a dimmed play does nothing.
    public let notice: String?

    /// `embeddable` says whether the player can play this link in the app; `loaded` whether it
    /// is the item the player holds now; `playBlocked` whether a take is being recorded, when
    /// nothing may play.
    public init(link: RecordingLink, embeddable: Bool, loaded: Bool = false, playBlocked: Bool = false) {
        title = LinkText.title(link)
        outboundURL = LinkText.outboundURL(link.url)
        outboundLabel = LinkText.outboundLabel(link)
        outboundName = LinkText.outboundName(link)
        switch (embeddable, loaded) {
        case (true, true): (glyph, verb, tap) = (.stop, MediaText.closePlayer, .close)
        case (true, false): (glyph, verb, tap) = (.play, MediaText.play, .play)
        case (false, _):
            // Nothing to load in the player, so the row is the link out, as the line under it is.
            (glyph, verb, tap) = (.none, outboundURL == nil ? nil : LinkText.open, outboundURL.map { .open($0) })
        }
        let blockedPlay = playBlocked && tap == .play
        isDimmed = blockedPlay
        notice = blockedPlay ? MediaText.stopRecordingToPlay : nil
    }
}
