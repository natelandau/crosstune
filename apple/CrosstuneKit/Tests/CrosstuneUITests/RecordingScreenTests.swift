import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

@MainActor
private func eventually(_ condition: () -> Bool) async throws {
    if try await poll({ condition() }) { return }
    Issue.record("The condition never held")
}

private let audioURL = URL(filePath: "/tmp/r1-aaaaaaaa.m4a")

private func take(
    trimStartMs: Int64 = 1000, trimEndMs: Int64? = 3000, speedPercent: Int = 75, pitchCents: Int = 200,
    label: String? = "Jam at Mike's"
) -> Recording {
    Recording(
        id: "r1", tuneID: nil, source: "microphone", recordedAt: noon, label: label, state: "ready",
        sourceDurationMs: 4000, trimStartMs: trimStartMs, trimEndMs: trimEndMs, speedPercent: speedPercent,
        pitchCents: pitchCents)
}

private func audioFile(_ url: URL = audioURL, blobStartMs: Int64 = 0) -> RecordingAudioFile {
    RecordingAudioFile(url: url, file: RecordingFile(id: "r1", localState: .downloaded, blobStartMs: blobStartMs))
}

/// Notes each settled write the player makes, and can refuse them.
@MainActor
private final class Writes {
    private(set) var made: [PlaybackSettings] = []
    var refusal: (any Error)?

    func save(_ recordingID: String, _ change: PlaybackSettings) async throws {
        if let refusal { throw refusal }
        made.append(change)
    }
}

@MainActor
@Suite struct RecordingScreenTests {
    private let audio = FakeAudio()
    private let writes = Writes()
    private let player: PlayerModel

    init() {
        player = PlayerModel(audio: audio)
        player.settleDelay = .milliseconds(40)
        audio.duration = 4
        player.saveSettings = writes.save
    }

    private func load(_ row: Recording = take()) async throws {
        player.audioSource = { _ in audioFile() }
        player.play(.recording(row, tuneTitle: nil))
        try await eventually { player.recordingAudio == .loaded }
    }

    @Test func loadingARecordingAppliesItsWindowSpeedAndPitch() async throws {
        try await load()
        #expect(audio.calls == ["load", "setWindow", "setRate(75)", "setPitch(200)", "play"])
        #expect(audio.window == PlaybackWindow(from: 1, to: 3))
    }

    @Test func aSpeedBurstWritesOnce() async throws {
        try await load()
        for percent in [80, 85, 90] { player.setSpeed(percent) }
        #expect(audio.calls.suffix(3) == ["setRate(80)", "setRate(85)", "setRate(90)"])
        #expect(player.speedPercent == 90)
        #expect(writes.made.isEmpty)
        try await eventually { !writes.made.isEmpty }
        try await Task.sleep(for: .milliseconds(100))
        #expect(writes.made == [PlaybackSettings(speedPercent: 90)])
    }

    @Test func anotherDevicesTrimReappliesTheWindow() async throws {
        try await load()
        let before = audio.calls.count
        player.recordingChanged(id: "r1", to: take(trimStartMs: 2000), audioFile: audioFile(), tuneTitle: nil)
        #expect(Array(audio.calls[before...]) == ["setWindow"])
        #expect(audio.window == PlaybackWindow(from: 2, to: 3))
    }

    @Test func aSettingFromElsewhereAppliesOnlyThatField() async throws {
        try await load()
        let before = audio.calls.count
        player.recordingChanged(id: "r1", to: take(speedPercent: 60), audioFile: audioFile(), tuneTitle: nil)
        player.recordingChanged(
            id: "r1", to: take(speedPercent: 60, pitchCents: -100), audioFile: audioFile(), tuneTitle: nil)
        #expect(Array(audio.calls[before...]) == ["setRate(60)", "setPitch(-100)"])
        #expect(player.speedPercent == 60)
        #expect(player.pitchCents == -100)
    }

    @Test func aNewRevisionOfTheAudioReloadsInPlace() async throws {
        try await load()
        audio.elapsed = 1.5
        let before = audio.calls.count
        let next = URL(filePath: "/tmp/r1-bbbbbbbb.m4a")
        player.recordingChanged(
            id: "r1", to: take(), audioFile: audioFile(next, blobStartMs: 1000), tuneTitle: nil)
        #expect(audio.loaded == next)
        #expect(
            Array(audio.calls[before...]) == ["load", "setWindow", "setRate(75)", "setPitch(200)", "seek", "play"])
        #expect(audio.window == PlaybackWindow(from: 0, to: 2))
        #expect(audio.elapsed == 1.5)
        #expect(audio.keptLoop == true)
    }

    @Test func aRowValueLandingWhileAChangeSettlesNeverOverridesIt() async throws {
        try await load()
        player.setSpeed(90)
        player.recordingChanged(id: "r1", to: take(speedPercent: 60), audioFile: audioFile(), tuneTitle: nil)
        #expect(audio.calls.last == "setRate(90)")
        #expect(player.speedPercent == 90)
        try await eventually { writes.made == [PlaybackSettings(speedPercent: 90)] }
    }

    @Test func theWrittenValueLandingLetsLaterValuesFromElsewhereThrough() async throws {
        try await load()
        player.setPitch(300)
        try await eventually { !writes.made.isEmpty }
        player.recordingChanged(id: "r1", to: take(pitchCents: 300), audioFile: audioFile(), tuneTitle: nil)
        #expect(audio.calls.last == "setPitch(300)")
        player.recordingChanged(id: "r1", to: take(pitchCents: 0), audioFile: audioFile(), tuneTitle: nil)
        #expect(audio.calls.last == "setPitch(0)")
        #expect(player.pitchCents == 0)
    }

    @Test func closingTheScreenWritesAPendingChangeAtOnce() async throws {
        try await load()
        player.settleDelay = .seconds(60)
        player.isExpanded = true
        player.setPitch(-50)
        player.isExpanded = false
        try await eventually { writes.made == [PlaybackSettings(pitchCents: -50)] }
    }

    @Test func aFailedWriteShowsAndGoesBackToTheRowButAMissingRecordingDoesNot() async throws {
        try await load()
        writes.refusal = CommandError.recordingNotFound
        player.setSpeed(90)
        try await Task.sleep(for: .milliseconds(150))
        #expect(player.failure == nil)

        writes.refusal = URLError(.cannotOpenFile)
        player.setPitch(100)
        try await eventually { player.failure == RecordingScreenText.pitchNotSaved }
        #expect(player.pitchCents == 200)
        #expect(audio.calls.last == "setPitch(200)")
        player.setPitch(300)
        #expect(player.failure == nil)
    }

    @Test func aFailureSentAsTheScreenClosesStillShowsOnThePlayer() async throws {
        try await load()
        player.settleDelay = .seconds(60)
        writes.refusal = URLError(.cannotOpenFile)
        player.expand()
        player.setSpeed(60)
        player.isExpanded = false
        try await eventually { player.failure == RecordingScreenText.speedNotSaved }
        #expect(player.isLoaded)
    }

    @Test func closingThePlayerWritesASettlingChangeOnce() async throws {
        try await load()
        player.setSpeed(60)
        player.close()
        try await Task.sleep(for: .milliseconds(150))
        #expect(writes.made == [PlaybackSettings(speedPercent: 60)])
    }

    @Test func aNewRevisionWithANewSettingFromElsewherePlaysThatSetting() async throws {
        try await load()
        player.setPitch(300)
        try await eventually { !writes.made.isEmpty }
        let next = URL(filePath: "/tmp/r1-bbbbbbbb.m4a")
        player.recordingChanged(id: "r1", to: take(pitchCents: -100), audioFile: audioFile(next), tuneTitle: nil)
        #expect(audio.loaded == next)
        #expect(audio.calls.contains("setPitch(-100)"))
        #expect(player.pitchCents == -100)
    }

    @Test func finishingWaitsForTheWritesAndLeavingTheStoreDropsTheRest() async throws {
        try await load()
        player.settleDelay = .seconds(60)
        player.setSpeed(60)
        await player.finishSettings()
        #expect(writes.made == [PlaybackSettings(speedPercent: 60)])

        player.setPitch(-300)
        player.leaveStore()
        try await Task.sleep(for: .milliseconds(100))
        #expect(writes.made == [PlaybackSettings(speedPercent: 60)])
        #expect(!player.isLoaded)
        #expect(player.saveSettings == nil)
    }

    @Test func aFailedDeleteLoadsTheRecordingAgainAndSaysSo() async throws {
        try await load()
        player.expand()
        audio.elapsed = 1.5
        await player.deleteLoadedRecording { throw CommandError.recordingNotFound }
        #expect(player.failure == CommandError.recordingNotFoundMessage)
        #expect(!player.isExpanded)
        try await eventually { player.recordingAudio == .loaded }
        #expect(
            audio.calls.suffix(7) == ["unload", "load", "setWindow", "setRate(75)", "setPitch(200)", "seek", "play"])
        #expect(audio.elapsed == 1.5)

        await player.deleteLoadedRecording {}
        #expect(!player.isLoaded)
    }

    @Test func onlyTheWindowThatAskedShowsTheScreen() {
        let asking = UUID()
        let other = UUID()
        player.open(.recording(take(), tuneTitle: nil), in: asking)
        #expect(player.showsExpanded(in: asking))
        #expect(!player.showsExpanded(in: other))
        player.isExpanded = false
        #expect(!player.showsExpanded(in: asking))
        #expect(player.expandedWindow == nil)

        // A request from no particular window, such as a link's play, shows everywhere.
        player.expand()
        #expect(player.showsExpanded(in: asking) && player.showsExpanded(in: other))
    }

    @Test func aLinkPlayedWhileAScreenIsOpenShowsInEveryWindow() throws {
        let asking = UUID()
        player.open(.recording(take(), tuneTitle: nil), in: asking)
        var link = RecordingLink(id: "l1", tuneID: "t1", url: "https://example.com/x", provider: "youtube")
        link.providerRef = "dQw4w9WgXcQ"
        player.play(try #require(PlayerItem.link(link)))
        #expect(player.expandedWindow == nil)
        #expect(player.showsExpanded(in: UUID()))
    }

    @Test func aHoldPlaysItsSettingsUntilLetGo() async throws {
        try await load()
        player.hold("r1", PlaybackSettings(speedPercent: 100, pitchCents: 0))
        #expect(audio.calls.suffix(2) == ["setRate(100)", "setPitch(0)"])
        // The row changing underneath leaves the held settings playing.
        let before = audio.calls.count
        player.recordingChanged(id: "r1", to: take(speedPercent: 60), audioFile: audioFile(), tuneTitle: nil)
        #expect(audio.calls.count == before)
        player.hold("r1", nil)
        #expect(audio.calls.suffix(2) == ["setRate(60)", "setPitch(200)"])
    }

    @Test func editOpensTheRecordingScreen() async throws {
        player.audioSource = { _ in audioFile() }
        #expect(player.open(.recording(take(), tuneTitle: nil)))
        #expect(player.isExpanded)
        #expect(player.holds(.recording, id: "r1"))
        try await eventually { player.recordingAudio == .loaded }

        // Opening what is already loaded shows it without starting it over.
        player.isExpanded = false
        let before = audio.calls.count
        #expect(player.open(.recording(take(), tuneTitle: nil)))
        #expect(player.isExpanded)
        #expect(audio.calls.count == before)
    }

    @Test func theMoreMenuOffersTrimRenameAddToTuneAndDelete() {
        #expect(
            RecordingMenuItem.items(inTune: false, trimBlocker: nil) == [
                .trim(blocker: nil), .rename, .addToTune, .delete,
            ])
        #expect(
            RecordingMenuItem.items(inTune: true, trimBlocker: RecordingScreenText.trimBusy) == [
                .trim(blocker: RecordingScreenText.trimBusy), .rename, .removeFromTune, .delete,
            ])
        #expect(RecordingMenuItem.trim(blocker: nil).label == "Trim")
        #expect(RecordingMenuItem.rename.label == RecordingRowActions.rename)
        #expect(RecordingMenuItem.addToTune.label == RecordingRowActions.addToTune)
        #expect(RecordingMenuItem.delete.label == RecordingRowActions.delete)
    }

    @Test func theSpeedAndPitchSegmentsNameTheirValuesOffDefault() {
        #expect(PracticeMode.allCases == [.loops, .speed, .pitch])
        #expect(PracticeMode.loops.title(speedPercent: 75, pitchCents: 200) == "Loops")
        #expect(PracticeMode.speed.title(speedPercent: 100, pitchCents: 0) == "Speed")
        #expect(PracticeMode.speed.title(speedPercent: 75, pitchCents: 0) == "Speed 75%")
        #expect(PracticeMode.pitch.title(speedPercent: 100, pitchCents: 0) == "Pitch")
        #expect(PracticeMode.pitch.title(speedPercent: 100, pitchCents: 200) == "Pitch +2")
        #expect(PracticeText.segment("Speed", value: nil) == "Speed")
    }

    @Test func aRecordingStillCapturingDisablesTheWaveformTransportAndModesWithTheReason() {
        #expect(RecordingScreenText.screenBlocker(file: nil, downloading: false) == nil)
        #expect(
            RecordingScreenText.screenBlocker(
                file: RecordingFile(id: "r1", localState: .capturing), downloading: false)
                == RecordingScreenText.trimWhileRecording)
        #expect(
            RecordingScreenText.screenBlocker(file: nil, downloading: true)
                == RecordingScreenText.trimWhileDownloading)
        // A pending trim blocks Trim but leaves the rest of the screen working.
        var cutting = take()
        cutting.playbackStartMs = 0
        cutting.playbackEndMs = 4000
        #expect(RecordingScreenText.trimBlocker(cutting, file: nil, audio: .loaded) != nil)
        #expect(RecordingScreenText.screenBlocker(file: nil, downloading: false) == nil)
    }

    @Test func thePlayButtonNamesTheRepeat() {
        #expect(PlayFace(isPlaying: false, repeating: nil) == PlayFace(label: "Play", systemImage: "play.fill"))
        #expect(
            PlayFace(isPlaying: false, repeating: "B part")
                == PlayFace(label: "Repeat B part", systemImage: "repeat"))
        #expect(PlayFace(isPlaying: true, repeating: "B part") == PlayFace(label: "Pause", systemImage: "pause.fill"))
    }

    @Test func theWaveformReadsThePlayheadAgainstTheLength() {
        #expect(PracticeText.position(42_300, of: 190_000) == "0:42 of 3:10")
    }

    @Test func theBadgeOpensTheLoadedRecordingsScreen() async throws {
        let window = UUID()
        try await load()
        #expect(player.open(.recording(take(), tuneTitle: nil), in: window))
        #expect(player.showsExpanded(in: window))
    }

    @Test func theBarsStopControlClearsTheSelection() async throws {
        try await load()
        player.loops.follow([
            RecordingLoop(
                id: "a", createdAt: noon, updatedAt: noon, recordingID: "r1", label: nil, startMs: 1000, endMs: 3000,
                color: 0)
        ])
        player.loops.select("a")
        #expect(player.loops.isRepeating)
        player.loops.select(nil)
        #expect(player.loops.selectedID == nil)
        #expect(!player.loops.isRepeating)
        #expect(!audio.isRepeating)
    }

    @Test func theRepeatBadgeOffersToRepeatTheLoop() {
        #expect(PracticeText.repeatLoop("B part") == "Repeat B part")
    }

    @Test func theRepeatBadgeNamesTheLoop() {
        #expect(PracticeText.repeating("B part") == "Repeating B part")
    }

    @Test(arguments: [
        (200, "+2"), (-100, "-1"), (1, "+0.1"), (-205, "-2.1"), (250, "+2.5"), (1200, "+12"), (-4, "-0.1"),
        (15, "+0.2"),
    ])
    func writesPitchInSemitones(cents: Int, expected: String) {
        #expect(RecordingScreenText.pitchBadge(cents) == expected)
    }

    @Test func writesSpeedAsAPercentAndNamesEachSettingAloud() {
        #expect(RecordingScreenText.speedBadge(75) == "75%")
        #expect(RecordingScreenText.badgeLabel(speedPercent: 75, pitchCents: 200) == "Speed 75%, Pitch +2")
        #expect(RecordingScreenText.badgeLabel(speedPercent: 100, pitchCents: -50) == "Pitch -0.5")
        #expect(RecordingScreenText.badgeLabel(speedPercent: 100, pitchCents: 0) == nil)
    }

    @Test func thePitchSplitKeepsItsSemitonesAsTheCentsReachHalfway() {
        var split = PitchSplit(cents: 249)
        #expect(split.semitones == 2 && split.cents == 49)
        split = split.with(cents: 50)
        #expect(split.value == 250)
        split.follow(250)
        #expect(split.semitones == 2 && split.cents == 50)

        // A pitch from elsewhere splits afresh, its cents within -50 to +50.
        split.follow(-351)
        #expect(split.semitones == -4 && split.cents == 49)
        split.follow(-350)
        #expect(split.semitones == -3 && split.cents == -50)
        #expect(PitchSplit(cents: 1200).with(semitones: 13).value == 1200)
        #expect(PitchSplit(cents: 1180).with(cents: 50).value == 1200)
    }

    @Test func saysWhyTrimCannotBeUsed() {
        let row = take()
        var capturing = RecordingFile(id: "r1", localState: .capturing)
        #expect(
            RecordingScreenText.trimBlocker(row, file: capturing, audio: .loaded)
                == RecordingScreenText.trimWhileRecording)
        capturing.localState = .downloaded
        #expect(
            RecordingScreenText.trimBlocker(row, file: capturing, audio: .fetching)
                == RecordingScreenText.trimWhileDownloading)

        var cutting = take()
        cutting.playbackStartMs = 0
        cutting.playbackEndMs = 4000
        #expect(RecordingScreenText.trimBlocker(cutting, file: nil, audio: .loaded) == RecordingScreenText.trimBusy)
        cutting.playbackStartMs = 1000
        cutting.playbackEndMs = 3000
        #expect(RecordingScreenText.trimBlocker(cutting, file: nil, audio: .loaded) == nil)
    }

    @Test func showsOnlyPeaksThatLineUpWithTheTrim() throws {
        // 5 points a second of 20 ms windows is 50 per second: 4 s of source.
        let values = (0..<200).map { UInt8($0 % 256) }
        let peaks = Peaks(values: values)
        var row = take()
        row.peaksRev = "p1"
        row.playbackStartMs = 500

        let local = ShownPeaks(row, peaks: peaks, peaksRev: nil)
        #expect(local?.peaks.values == Array(values[50..<150]))
        #expect(local?.loudest == 199)

        let server = ShownPeaks(row, peaks: peaks, peaksRev: "p1")
        #expect(server?.peaks.values == Array(values[25..<125]))
        #expect(ShownPeaks(row, peaks: peaks, peaksRev: "old") == nil)
        #expect(ShownPeaks(row, peaks: nil, peaksRev: nil) == nil)
    }
}
