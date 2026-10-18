import CrosstuneStore

/// What the Edit recording sheet suggests, drawn from the musician's live recordings.
public enum RecordingSuggestions {
    /// The players on the recordings, each once whatever its case or accents, by name.
    public static func players(_ recordings: [Recording]) -> [String] {
        TuneSuggestions.tally(live(recordings).map(\.players), canonical: []).map(\.value)
            .sorted(by: TuneSuggestions.ordered)
    }

    /// The named places on the other recordings, each once, most recently added first, without
    /// accuracy, as a picked place has none. One name at two spots stays twice, since a town's
    /// name can repeat across states.
    public static func recentPlaces(_ recordings: [Recording], excluding id: String) -> [RecordingPlace] {
        var places: [RecordingPlace] = []
        let newestFirst = live(recordings).filter { $0.id != id }.sorted { $0.addedAt > $1.addedAt }
        for recording in newestFirst {
            guard let place = recording.place.map(picked), !places.contains(place) else { continue }
            places.append(place)
        }
        return places
    }

    /// `place` as a hand pick would set it, so two places compare by name and point alone.
    static func picked(_ place: RecordingPlace) -> RecordingPlace {
        RecordingPlace(
            name: place.name, coordinate: Coordinate(lat: place.coordinate.lat, lon: place.coordinate.lon))
    }

    private static func live(_ recordings: [Recording]) -> [Recording] {
        recordings.filter { $0.deletedAt == nil }
    }
}
