// The client's own labels and rates for the API's vocabulary values: what the server
// validates, `Vocabulary.swift` already has; what only the client shows or records at,
// this file has. A value missing here fails to compile wherever it is looked up, so a new
// server value gets a deliberate label before it can reach a screen.

extension Vocabulary {
    public static let instrumentLabels: [String: String] = [
        "violin": "Violin",
        "five_string_banjo": "5-string banjo",
        "tenor_banjo": "Tenor banjo",
        "guitar": "Guitar",
        "mandolin": "Mandolin",
        "bouzouki": "Bouzouki",
        "mountain_dulcimer": "Mountain dulcimer",
    ]

    /// The tuning an instrument is in unless a tune says otherwise, which a row leaves unsaid.
    /// An instrument with no standard tuning always shows the one a tune holds.
    public static let standardTunings: [String: String] = [
        "violin": "Standard (GDAE)",
        "five_string_banjo": "Open G (gDGBD)",
        "guitar": "Standard (EADGBE)",
        "mandolin": "Standard (GDAE)",
    ]

    public static let statusLabels: [String: String] = [
        "known": "Known",
        "learning": "Learning",
        "want_to_learn": "Unknown",
    ]

    /// What follows a key on a row. Major reads as the key alone, as players write it.
    public static let modeAbbreviations: [String: String] = [
        "major": "",
        "minor": "m",
        "dorian": " dor",
        "mixolydian": " mix",
        "modal": " modal",
        "other": "",
    ]

    public static let providerLabels: [String: String] = [
        "youtube": "YouTube",
        "spotify": "Spotify",
        "apple_music": "Apple Music",
        "bandcamp": "Bandcamp",
        "soundcloud": "SoundCloud",
        "tidal": "TIDAL",
        "internet_archive": "Internet Archive",
        "other": "Link",
    ]

    public static let audioQualityNames: [String: String] = [
        "low": "Low",
        "standard": "Standard",
        "high": "High",
    ]

    public static let audioBitrates: [String: Int] = [
        "low": 48_000,
        "standard": 64_000,
        "high": 128_000,
    ]
}
