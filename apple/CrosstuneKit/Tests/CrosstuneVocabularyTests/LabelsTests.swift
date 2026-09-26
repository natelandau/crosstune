import Testing

@testable import CrosstuneVocabulary

@Test func labelDictionariesCoverExactlyTheContractsValues() {
    #expect(Set(Vocabulary.instrumentLabels.keys) == Set(Vocabulary.instruments))
    #expect(Set(Vocabulary.statusLabels.keys) == Set(Vocabulary.statuses))
    #expect(Set(Vocabulary.modeAbbreviations.keys) == Set(Vocabulary.modes))
    #expect(Set(Vocabulary.providerLabels.keys) == Set(Vocabulary.providers))
    #expect(Set(Vocabulary.audioQualityNames.keys) == Set(Vocabulary.audioQualities))
    #expect(Set(Vocabulary.audioBitrates.keys) == Set(Vocabulary.audioQualities))
    #expect(Set(Vocabulary.standardTunings.keys).isSubset(of: Vocabulary.instruments))
}

@Test func portsTheWebsLabelsAndBitratesVerbatim() {
    #expect(Vocabulary.instrumentLabels["five_string_banjo"] == "5-string banjo")
    #expect(Vocabulary.instrumentLabels["mountain_dulcimer"] == "Mountain dulcimer")
    #expect(Vocabulary.instrumentLabels["violin"] == "Violin")
    #expect(Vocabulary.statusLabels["want_to_learn"] == "Unknown")
    #expect(Vocabulary.statusLabels["known"] == "Known")
    #expect(Vocabulary.modeAbbreviations["dorian"] == " dor")
    #expect(Vocabulary.modeAbbreviations["mixolydian"] == " mix")
    #expect(Vocabulary.modeAbbreviations["major"] == "")
    #expect(Vocabulary.modeAbbreviations["other"] == "")
    #expect(Vocabulary.providerLabels["apple_music"] == "Apple Music")
    #expect(Vocabulary.providerLabels["other"] == "Link")
    #expect(Vocabulary.audioQualityNames["standard"] == "Standard")
    #expect(Vocabulary.audioBitrates["low"] == 48_000)
    #expect(Vocabulary.audioBitrates["standard"] == 64_000)
    #expect(Vocabulary.audioBitrates["high"] == 128_000)
    #expect(Vocabulary.standardTunings["five_string_banjo"] == "Open G (gDGBD)")
    #expect(Vocabulary.standardTunings["violin"] == "Standard (GDAE)")
}

@Test func offersSuggestionsForEveryInstrumentAndEachStandardFirst() {
    #expect(Set(Vocabulary.tuningSuggestions.keys) == Set(Vocabulary.instruments))
    for (instrument, standard) in Vocabulary.standardTunings {
        #expect(Vocabulary.tuningSuggestions[instrument]?.first == standard)
    }
}

@Test func offersACapoOnlyOnFrettedInstruments() {
    #expect(Vocabulary.capoInstruments.isSubset(of: Vocabulary.instruments))
    #expect(!Vocabulary.capoInstruments.contains("violin"))
    #expect(Vocabulary.capoInstruments.count == Vocabulary.instruments.count - 1)
    #expect(Vocabulary.capoFrets == Array(1...12))
}

@Test func offersEveryKeyOnceWithTheQuickKeysAmongThem() {
    #expect(Set(Vocabulary.allKeys).count == Vocabulary.allKeys.count)
    #expect(Set(Vocabulary.quickKeys).isSubset(of: Vocabulary.allKeys))
    #expect(Vocabulary.allKeys.contains("F#") && Vocabulary.allKeys.contains("Gb"))
}

@Test func offersEveryGenresTypesOnceAndAnOwnTimeSignatureOnlyForKnownTypes() {
    #expect(Set(Vocabulary.tuneTypes).count == Vocabulary.tuneTypes.count)
    #expect(Vocabulary.tuneTypes == Vocabulary.tuneTypes.sorted())
    #expect(Vocabulary.tuneTypes.contains("Song"))
    #expect(Vocabulary.tuneTypes.contains("Slow"))
    #expect(Vocabulary.genreTypes["Cape Breton"] == Vocabulary.genreTypes["Scottish"])
    #expect(Set(Vocabulary.typeTimeSignatures.keys).isSubset(of: Vocabulary.tuneTypes))
    #expect(Set(Vocabulary.typeTimeSignatures.values).isSubset(of: Vocabulary.timeSignatures))
}
