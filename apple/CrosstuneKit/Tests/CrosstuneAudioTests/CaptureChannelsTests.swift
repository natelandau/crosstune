import CrosstuneVocabulary
import Foundation
import Testing

@testable import CrosstuneAudio

@Suite struct CaptureChannelsTests {
    private func withDefaults(_ body: (UserDefaults) -> Void) {
        let name = "CaptureChannelsTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        body(defaults)
    }

    @Test func readsMonoWhenNothingIsStored() {
        withDefaults { #expect(CaptureChannels.stored(in: $0) == .mono) }
    }

    @Test func readsAStoredStereoChoice() {
        withDefaults {
            $0.set("stereo", forKey: CaptureChannels.storageKey)
            #expect(CaptureChannels.stored(in: $0) == .stereo)
        }
    }

    @Test func readsMonoForAnUnknownValue() {
        withDefaults {
            $0.set("surround", forKey: CaptureChannels.storageKey)
            #expect(CaptureChannels.stored(in: $0) == .mono)
        }
    }

    @Test func recordsTwoChannelsOnlyForStereoOnAStereoInput() {
        #expect(CaptureChannels.resolve(.mono, inputChannels: 2) == 1)
        #expect(CaptureChannels.resolve(.stereo, inputChannels: 1) == 1)
        #expect(CaptureChannels.resolve(.stereo, inputChannels: 2) == 2)
        #expect(CaptureChannels.resolve(.stereo, inputChannels: 4) == 2)
    }

    @Test func countsItsChannels() {
        #expect(CaptureChannels.mono.count == 1)
        #expect(CaptureChannels.stereo.count == 2)
    }

    @Test func doublesTheRateForStereo() {
        let mono = Vocabulary.audioQualities.compactMap { Vocabulary.audioBitrates[$0] }
        #expect(mono.map { CaptureChannels.bitrate(mono: $0, channels: 1) } == mono)
        #expect(mono.map { CaptureChannels.bitrate(mono: $0, channels: 2) } == [96_000, 128_000, 256_000, 320_000])
    }
}
