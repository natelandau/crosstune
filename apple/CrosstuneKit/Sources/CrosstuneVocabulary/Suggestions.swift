// What the client suggests and offers but the API leaves open: tuning names, genres, tune types,
// part structures, and the keys on the key grid. Any of these can change with no other change to
// code, the API, or the database.

extension Vocabulary {
    /// Tuning suggestions per instrument, name then strings, lowercase for a drone. The first is
    /// standard when the instrument has one.
    public static let tuningSuggestions: [String: [String]] = [
        "violin": [
            "Standard (GDAE)", "Cross A (AEAE)", "Cross G (GDGD)", "High Bass (ADAE)", "Calico (AEAC#)",
            "Dead Man (DDAD)",
        ],
        "five_string_banjo": [
            "Open G (gDGBD)", "Standard C (gCGBD)", "Double C (gCGCD)", "Sawmill (gDGCD)", "Double D (aDADE)",
        ],
        "tenor_banjo": ["Irish (GDAE)", "Standard (CGDA)"],
        "guitar": ["Standard (EADGBE)", "DADGAD", "Drop D (DADGBE)", "Open D (DADF#AD)", "Open G (DGDGBD)"],
        "mandolin": ["Standard (GDAE)", "Cross A (AEAE)", "Cross G (GDGD)"],
        "bouzouki": ["GDAD", "GDAE", "ADAD", "ADAE"],
        "mountain_dulcimer": ["DAd", "DAA", "DAG", "DAC"],
    ]

    /// Instruments that take a capo. The API refuses a capo on any other.
    public static let capoInstruments: Set<String> = [
        "five_string_banjo", "tenor_banjo", "guitar", "mandolin", "bouzouki", "mountain_dulcimer",
    ]

    /// The frets a capo is offered at.
    public static let capoFrets: [Int64] = Array(1...12)

    /// Every key spelling the client offers, alphabetical, the sharp before the flat for each
    /// letter. F sharp and G flat are one pitch but two keys, and musicians name them separately.
    public static let allKeys = [
        "A", "A#", "Ab", "B", "Bb", "C", "C#", "D", "D#", "Db", "E", "Eb", "F", "F#", "G", "G#", "Gb",
    ]

    /// The keys on the grid, reachable in one tap. Every other key costs a second tap under More
    /// keys, so this is what a player reaches for without thinking.
    public static let quickKeys = ["A", "B", "C", "D", "E", "F", "G", "Bb", "Eb"]

    public static let genres = [
        "Old-time", "Bluegrass", "Irish", "Scottish", "Cape Breton", "Cajun", "Gospel", "Blues", "Swing",
    ]

    private static let scottishTypes = ["Reel", "Jig", "Strathspey", "March", "Air", "Waltz"]

    /// The types a genre's players reach for, most common first. A tune in one of these genres
    /// offers these types first; every other type follows alphabetically.
    public static let genreTypes: [String: [String]] = [
        "Irish": [
            "Reel", "Jig", "Slip jig", "Single jig", "Hop jig", "Slide", "Polka", "Hornpipe", "Barndance", "Highland",
            "Mazurka", "Set dance", "Air", "Planxty", "March", "Waltz",
        ],
        "Scottish": scottishTypes,
        "Cape Breton": scottishTypes,
        "Old-time": ["Breakdown", "Waltz", "Rag", "Hornpipe", "March", "Song"],
        "Bluegrass": ["Breakdown", "Song", "Waltz", "Gospel"],
    ]

    /// Every suggested type, once, sorted.
    public static let tuneTypes: [String] = Array(Set(genreTypes.values.joined()).union(["Slow"])).sorted()

    /// The time signature a type is written in, for the types that have only one.
    public static let typeTimeSignatures: [String: String] = [
        "Reel": "4/4",
        "Hornpipe": "4/4",
        "Barndance": "4/4",
        "Highland": "4/4",
        "Strathspey": "4/4",
        "Breakdown": "4/4",
        "Rag": "4/4",
        "Jig": "6/8",
        "Slip jig": "9/8",
        "Hop jig": "9/8",
        "Slide": "12/8",
        "Single jig": "12/8",
        "Polka": "2/4",
        "March": "2/4",
        "Waltz": "3/4",
        "Mazurka": "3/4",
    ]

    public static let partStructures = ["AABB", "AABBCC", "AB", "ABC", "AAB", "ABB"]
}
