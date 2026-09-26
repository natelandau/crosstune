import Testing

@testable import CrosstuneVocabulary

@Test func listsTheEnumValuesTheAPIValidates() {
    #expect(Vocabulary.modes == ["major", "minor", "mixolydian", "dorian", "modal", "other"])
    #expect(
        Vocabulary.instruments == [
            "violin", "five_string_banjo", "tenor_banjo", "guitar", "mandolin", "bouzouki", "mountain_dulcimer",
        ]
    )
    #expect(Vocabulary.statuses == ["known", "learning", "want_to_learn"])
    #expect(
        Vocabulary.providers == [
            "youtube", "spotify", "apple_music", "bandcamp", "soundcloud", "tidal", "internet_archive", "other",
        ]
    )
    #expect(Vocabulary.audioQualities == ["low", "standard", "high"])
    #expect(Vocabulary.recordingSources == ["microphone", "upload"])
    #expect(Vocabulary.recordingStates == ["pending_upload", "uploaded", "processing", "ready", "failed"])
    #expect(Vocabulary.timeSignatures == ["4/4", "2/4", "2/2", "3/4", "3/2", "6/8", "9/8", "12/8", "other"])
}

@Test func limitsTheFieldsTheAPIValidates() {
    #expect(Vocabulary.Limits.Tune.title == 200)
    #expect(Vocabulary.Limits.Tune.alternateTitles == 200)
    #expect(Vocabulary.Limits.Tune.composer == 200)
    #expect(Vocabulary.Limits.Tune.genre == 100)
    #expect(Vocabulary.Limits.Tune.key == 10)
    #expect(Vocabulary.Limits.Tune.lyrics == 20000)
    #expect(Vocabulary.Limits.Tune.modes == 4)
    #expect(Vocabulary.Limits.Tune.partStructure == 100)
    #expect(Vocabulary.Limits.Tune.tuneType == 100)
    #expect(Vocabulary.Limits.Tune.learnedFrom == 200)
    #expect(Vocabulary.Limits.Tune.notes == 20000)
    #expect(Vocabulary.Limits.Tune.tuning == 100)
    #expect(Vocabulary.Limits.List.name == 200)
    #expect(Vocabulary.Limits.Link.artworkUrl == 2048)
    #expect(Vocabulary.Limits.Link.label == 200)
    #expect(Vocabulary.Limits.Link.providerRef == 200)
    #expect(Vocabulary.Limits.Link.title == 300)
    #expect(Vocabulary.Limits.Link.url == 2048)
    #expect(Vocabulary.Limits.Recording.label == 200)
}
