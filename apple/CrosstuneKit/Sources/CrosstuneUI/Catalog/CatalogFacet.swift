import CrosstuneCommands
import CrosstuneStore
import CrosstuneVocabulary

/// Something the catalog filters on besides status and the archived setting: a tune's key,
/// type, mode, one instrument's tuning, or genre.
public enum CatalogFacet: Hashable, Sendable {
    case key
    case tuneType
    case mode
    /// One instrument's tuning, so each instrument's tunings filter on their own.
    case tuning(String)
    case genre

    /// Every facet in the order the filter sheet lists them.
    nonisolated public static let all: [CatalogFacet] =
        [.key, .tuneType, .mode] + Vocabulary.instruments.map(CatalogFacet.tuning) + [.genre]

    /// The facets with their own rail on the catalog screen. Every other visible facet is in the
    /// filter sheet.
    nonisolated public static let onScreen: [CatalogFacet] = [.key, .tuneType]

    /// Whether this facet is set in the filter sheet rather than on the screen.
    public var isInSheet: Bool { isInSheet(railsOnScreen: true) }

    /// Whether this facet is set in the filter sheet. `railsOnScreen` false puts every facet
    /// there, as at the accessibility text sizes, where rails would crowd out the tunes.
    public func isInSheet(railsOnScreen: Bool) -> Bool {
        !railsOnScreen || !Self.onScreen.contains(self)
    }

    /// The key the facet is stored under in the catalog filters, the web client's own.
    public var storageKey: String {
        switch self {
        case .key: "key"
        case .tuneType: "tune_type"
        case .mode: "mode"
        case .tuning(let instrument): "tuning:\(instrument)"
        case .genre: "genre"
        }
    }

    public var label: String {
        switch self {
        case .key: "Key"
        case .tuneType: "Type"
        case .mode: "Mode"
        case .tuning(let instrument): "\(TuningText.instrumentLabel(instrument)) tuning"
        case .genre: "Genre"
        }
    }

    /// The instrument a tuning facet belongs to.
    public var instrument: String? {
        if case .tuning(let instrument) = self { return instrument }
        return nil
    }

    /// Every value a tune holds for this facet: one mode per part, one instrument's tuning from
    /// the map, or a column's one value.
    public func values(of tune: Tune) -> [String?] {
        switch self {
        case .key: [tune.key]
        case .tuneType: [tune.tuneType]
        case .mode: tune.modes
        case .tuning(let instrument): [tuningEntry(tune.tunings, instrument: instrument).tuning]
        case .genre: [tune.genre]
        }
    }

    /// How a set filter on this facet reads on its capsule. A tuning names its instrument, since
    /// two instruments can share a tuning's name.
    public func capsuleLabel(_ value: String) -> String {
        guard let instrument else { return value }
        return "\(TuningText.instrumentLabel(instrument)): \(value)"
    }
}
