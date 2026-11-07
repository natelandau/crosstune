import CrosstuneAudio
import CrosstuneCommands
import CrosstuneStore
import CrosstuneTestSupport
import CrosstuneVocabulary
import Foundation
import Synchronization
import Testing

@testable import CrosstuneUI

private let audioURL = URL(filePath: "/tmp/r1-aaaaaaaa.m4a")

private func recording(
    _ id: String = "r1", trimStartMs: Int64 = 1000, trimEndMs: Int64? = 3000, speedPercent: Int = 75,
    pitchCents: Int = 200, isolate: IsolateSetting = .standard, isMono: Bool? = nil,
    label: String? = "Jam at Mike's"
) -> Recording {
    Recording(
        id: id, tuneID: nil, source: "microphone", addedAt: noon, label: label, state: "ready",
        sourceDurationMs: 4000, trimStartMs: trimStartMs, trimEndMs: trimEndMs, speedPercent: speedPercent,
        pitchCents: pitchCents, isolate: isolate, isMono: isMono)
}

/// The left half of the stereo field, soloed.
private let leftHalf = IsolateSetting(effect: .solo, panStart: -100, panEnd: 0, lowHz: 40, highHz: 16000)
/// The 200 Hz to 4 kHz band, muted.
private let mutedBand = IsolateSetting(effect: .mute, panStart: -100, panEnd: 100, lowHz: 200, highHz: 4000)

private func audioFile(_ url: URL = audioURL, blobStartMs: Int64 = 0) -> RecordingAudioFile {
    RecordingAudioFile(url: url, file: RecordingFile(id: "r1", localState: .downloaded, blobStartMs: blobStartMs))
}

/// Notes each mono flag the player saves.
@MainActor
private final class MonoWrites {
    private(set) var made: [String: Bool] = [:]

    func save(_ recordingID: String, _ isMono: Bool) async throws {
        made[recordingID] = isMono
    }
}

/// Notes each settled write the player makes, and can refuse them.
@MainActor
private final class Writes {
    private(set) var made: [PlaybackSettings] = []
    var refusal: (any Error)?

    func save(_: String, _ change: PlaybackSettings) async throws {
        if let refusal { throw refusal }
        made.append(change)
    }
}

@MainActor
@Suite struct RecordingScreenTests {
    private let audio = FakeAudio()
    private let writes = Writes()
    private let monos = MonoWrites()
    private let player: PlayerModel

    init() {
        player = PlayerModel(audio: audio)
        player.settleDelay = .milliseconds(40)
        audio.duration = 4
        player.saveSettings = writes.save
        player.saveMono = monos.save
    }

    /// Waits until no change is settling and every settled write has landed.
    private func settled() async throws {
        try await eventually {
            player.settling.isEmpty && player.measuring.isEmpty
                && player.writing.isEmpty
        }
    }

    private func load(_ row: Recording = recording()) async throws {
        player.audioSource = { _ in audioFile() }
        player.play(.recording(row, tuneTitle: nil))
        try await eventually { player.recordingAudio == .loaded }
    }

    @Test func loadingARecordingAppliesItsWindowSpeedAndPitch() async throws {
        try await load()
        #expect(
            audio.calls == [
                "load", "setWindow", "setRate(75)", "setPitch(200)", "setIsolate(default, mono: false)", "play",
            ])
        #expect(audio.window == PlaybackWindow(from: 1, to: 3))
    }

    @Test func anEarlyEndShortensTheWindowFromItsStartAndTheTrimEndRestoresIt() async throws {
        try await load(recording(trimStartMs: 1000, trimEndMs: 4000))
        player.endPlayback(atSourceMs: 2500)
        #expect(audio.window == PlaybackWindow(from: 1, to: 2.5))
        player.endPlayback(atSourceMs: nil)
        #expect(audio.window == PlaybackWindow(from: 1, to: 4))
    }

    @Test func aSpeedBurstWritesOnce() async throws {
        let sleep = ManualSleep()
        player.sleep = sleep.sleep
        try await load()
        for percent in [80, 85, 90] { player.setSpeed(percent) }
        #expect(audio.calls.suffix(3) == ["setRate(80)", "setRate(85)", "setRate(90)"])
        #expect(player.speedPercent == 90)
        try await eventually { sleep.cancelled == 2 && sleep.pending.count == 1 }
        #expect(writes.made.isEmpty)
        sleep.wake()
        try await settled()
        #expect(writes.made == [PlaybackSettings(speedPercent: 90)])
    }

    @Test func setIsolateAppliesAtOnceAndSettlesToOneSave() async throws {
        let sleep = ManualSleep()
        player.sleep = sleep.sleep
        try await load(recording(isMono: false))
        player.setIsolate(leftHalf)
        player.setIsolate(mutedBand)
        #expect(audio.calls.suffix(2) == ["setIsolate(custom, mono: false)", "setIsolate(custom, mono: false)"])
        #expect(player.isolate == mutedBand)
        try await eventually { sleep.cancelled == 1 && sleep.pending.count == 1 }
        #expect(writes.made.isEmpty)
        sleep.wake()
        try await settled()
        #expect(writes.made == [PlaybackSettings(isolate: mutedBand)])
    }

    @Test func anIsolateFromElsewhereAppliesAndASettlingOneWins() async throws {
        try await load(recording(isMono: false))
        let before = audio.calls.count
        player.recordingChanged(
            id: "r1", to: recording(isolate: leftHalf, isMono: false), audioFile: audioFile(), tuneTitle: nil)
        #expect(Array(audio.calls[before...]) == ["setIsolate(custom, mono: false)"])
        #expect(player.isolate == leftHalf)

        player.setIsolate(mutedBand)
        player.recordingChanged(id: "r1", to: recording(isMono: false), audioFile: audioFile(), tuneTitle: nil)
        #expect(player.isolate == mutedBand)
        try await eventually { writes.made == [PlaybackSettings(isolate: mutedBand)] }
    }

    @Test func aFailedIsolateWriteShowsAndGoesBackToTheRow() async throws {
        try await load(recording(isolate: leftHalf, isMono: false))
        writes.refusal = URLError(.cannotOpenFile)
        player.setIsolate(.standard)
        #expect(audio.calls.last == "setIsolate(default, mono: false)")
        try await eventually { player.failure == RecordingScreenText.isolateNotSaved }
        #expect(player.isolate == leftHalf)
        #expect(audio.calls.last == "setIsolate(custom, mono: false)")
    }

    @Test func aMonoRecordingReadsAPanOnlyIsolateAsDefault() async throws {
        try await load(recording(isolate: leftHalf, isMono: true))
        #expect(player.isolate == leftHalf)
        #expect(player.effectiveIsolate.isDefault)
        #expect(player.activitySnapshot.isolateDefault)
    }

    @Test func reloadingTheSameRecordingReportsWhatPlayedUntilTheAudioIsBack() async throws {
        try await load(recording(isMono: false))
        player.setIsolate(mutedBand)
        let gate = AsyncStream<Void>.makeStream()
        player.audioSource = { _ in
            for await _ in gate.stream { break }
            return audioFile()
        }
        player.play(.recording(recording(isMono: false), tuneTitle: nil))
        #expect(player.recordingAudio == .fetching)
        #expect(player.playedSettings(of: "r1")?.isolate == mutedBand)
        gate.continuation.yield()
        try await eventually { player.recordingAudio == .loaded }
        try await settled()
    }

    @Test func aHoldPlaysItsIsolateUntilLetGo() async throws {
        try await load(recording(isolate: leftHalf, isMono: false))
        player.hold("r1", .normal)
        #expect(audio.calls.last == "setIsolate(default, mono: false)")
        player.hold("r1", nil)
        #expect(audio.calls.last == "setIsolate(custom, mono: false)")
    }

    @Test func startingARecordingWithIsMonoNilMeasuresAndSavesIt() async throws {
        let measured = Mutex<[URL]>([])
        audio.measureMonoAnswer = { url in
            measured.withLock { $0.append(url) }
            return true
        }
        try await load(recording(isolate: leftHalf))
        try await settled()
        #expect(measured.withLock { $0 } == [audioURL])
        #expect(monos.made == ["r1": true])
        #expect(player.isMono == true)
        #expect(audio.calls.last == "setIsolate(custom, mono: true)")
    }

    @Test func startingWithIsMonoSetNeverMeasures() async throws {
        audio.measureMonoAnswer = { _ in
            Issue.record("A recording whose mono flag is known was measured.")
            return true
        }
        try await load(recording(isolate: leftHalf, isMono: false))
        #expect(player.measuring.isEmpty)
        try await settled()
        #expect(monos.made.isEmpty)
        #expect(player.isMono == false)
    }

    @Test func aMonoFlagFromElsewhereReappliesTheIsolate() async throws {
        try await load(recording(isolate: leftHalf))
        player.recordingChanged(
            id: "r1", to: recording(isolate: leftHalf, isMono: true), audioFile: audioFile(), tuneTitle: nil)
        #expect(audio.calls.last == "setIsolate(custom, mono: true)")
        #expect(player.isMono == true)
    }

    @Test func aFailedMeasurementLeavesTheMonoFlagUnknown() async throws {
        try await load(recording(isolate: leftHalf))
        try await settled()
        #expect(monos.made.isEmpty)
        #expect(player.isMono == nil)
        #expect(audio.calls.last == "play")
    }

    @Test func aFileTheDetectorCannotReadLeavesTheMonoFlagUnknown() async throws {
        audio.measureMonoAnswer = { _ in throw CaptureError.unsupportedFormat }
        try await load(recording(isolate: leftHalf))
        try await settled()
        #expect(monos.made.isEmpty)
        #expect(player.isMono == nil)
    }

    @Test func aMeasurementLandingAfterASwitchIsSavedButNotApplied() async throws {
        let gate = AsyncStream<Void>.makeStream()
        audio.measureMonoAnswer = { _ in
            for await _ in gate.stream { break }
            return true
        }
        try await load(recording(isolate: leftHalf))
        let measurement = try #require(player.measuring["r1"])
        player.audioSource = { id in audioFile(URL(filePath: "/tmp/\(id).m4a")) }
        player.play(.recording(recording("r2", isMono: false), tuneTitle: nil))
        try await eventually { player.holds(.recording, id: "r2") && player.recordingAudio == .loaded }
        let before = audio.calls.count
        gate.continuation.yield()
        await measurement.value
        try await settled()
        #expect(monos.made == ["r1": true])
        #expect(audio.calls.count == before)
        #expect(player.isMono == false)
    }

    @Test func aMeasurementStillUnderWayWhenSettingsFinishNeverSaves() async throws {
        let gate = AsyncStream<Void>.makeStream()
        audio.measureMonoAnswer = { _ in
            for await _ in gate.stream { break }
            return true
        }
        try await load(recording(isolate: leftHalf))
        let measurement = try #require(player.measuring["r1"])
        await player.finishSettings()
        #expect(player.measuring.isEmpty)
        gate.continuation.yield()
        await measurement.value
        try await settled()
        #expect(monos.made.isEmpty)
        #expect(player.isMono == nil)
    }

    @Test func leavingTheStoreStopsAMeasurementUnderWay() async throws {
        let gate = AsyncStream<Void>.makeStream()
        audio.measureMonoAnswer = { _ in
            for await _ in gate.stream { break }
            return true
        }
        try await load(recording(isolate: leftHalf))
        let measurement = try #require(player.measuring["r1"])
        let saveMono = monos.save
        player.leaveStore()
        // A store opened again before the measurement lands still receives nothing.
        player.saveMono = saveMono
        gate.continuation.yield()
        await measurement.value
        #expect(player.measuring.isEmpty)
        #expect(monos.made.isEmpty)
    }

    @Test func switchingRecordingsAppliesTheNewIsolate() async throws {
        let sleep = ManualSleep()
        player.sleep = sleep.sleep
        try await load(recording(isolate: leftHalf, isMono: false))
        #expect(audio.calls.contains("setIsolate(custom, mono: false)"))
        player.setIsolate(mutedBand)
        player.audioSource = { id in audioFile(URL(filePath: "/tmp/\(id).m4a")) }
        player.play(.recording(recording("r2", isMono: true), tuneTitle: nil))
        try await eventually { player.holds(.recording, id: "r2") && player.recordingAudio == .loaded }
        #expect(audio.calls.suffix(2) == ["setIsolate(default, mono: true)", "play"])
        #expect(player.isolate == .standard)
        #expect(player.isMono == true)
    }

    @Test func anotherDevicesTrimReappliesTheWindow() async throws {
        try await load()
        let before = audio.calls.count
        player.recordingChanged(id: "r1", to: recording(trimStartMs: 2000), audioFile: audioFile(), tuneTitle: nil)
        #expect(Array(audio.calls[before...]) == ["setWindow"])
        #expect(audio.window == PlaybackWindow(from: 2, to: 3))
    }

    @Test func aSettingFromElsewhereAppliesOnlyThatField() async throws {
        try await load()
        let before = audio.calls.count
        player.recordingChanged(id: "r1", to: recording(speedPercent: 60), audioFile: audioFile(), tuneTitle: nil)
        player.recordingChanged(
            id: "r1", to: recording(speedPercent: 60, pitchCents: -100), audioFile: audioFile(), tuneTitle: nil)
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
            id: "r1", to: recording(), audioFile: audioFile(next, blobStartMs: 1000), tuneTitle: nil)
        #expect(audio.loaded == next)
        #expect(
            Array(audio.calls[before...]) == [
                "load", "setWindow", "setRate(75)", "setPitch(200)", "setIsolate(default, mono: false)", "seek", "play",
            ])
        #expect(audio.window == PlaybackWindow(from: 0, to: 2))
        #expect(audio.elapsed == 1.5)
        #expect(audio.keptLoop == true)
    }

    @Test func aRowValueLandingWhileAChangeSettlesNeverOverridesIt() async throws {
        try await load()
        player.setSpeed(90)
        player.recordingChanged(id: "r1", to: recording(speedPercent: 60), audioFile: audioFile(), tuneTitle: nil)
        #expect(audio.calls.last == "setRate(90)")
        #expect(player.speedPercent == 90)
        try await eventually { writes.made == [PlaybackSettings(speedPercent: 90)] }
    }

    @Test func theWrittenValueLandingLetsLaterValuesFromElsewhereThrough() async throws {
        try await load()
        player.setPitch(300)
        try await eventually { !writes.made.isEmpty }
        player.recordingChanged(id: "r1", to: recording(pitchCents: 300), audioFile: audioFile(), tuneTitle: nil)
        #expect(audio.calls.last == "setPitch(300)")
        player.recordingChanged(id: "r1", to: recording(pitchCents: 0), audioFile: audioFile(), tuneTitle: nil)
        #expect(audio.calls.last == "setPitch(0)")
        #expect(player.pitchCents == 0)
    }

    @Test func flushingWritesAPendingChangeAtOnce() async throws {
        try await load()
        player.settleDelay = .seconds(60)
        player.setPitch(-50)
        player.flushSettings()
        try await eventually { writes.made == [PlaybackSettings(pitchCents: -50)] }
    }

    @Test func aFailedWriteShowsAndGoesBackToTheRowButAMissingRecordingDoesNot() async throws {
        let sleep = ManualSleep()
        player.sleep = sleep.sleep
        try await load()
        writes.refusal = CommandError.recordingNotFound
        player.setSpeed(90)
        try await eventually { sleep.pending.count == 1 }
        sleep.wake()
        try await settled()
        #expect(player.failure == nil)

        writes.refusal = URLError(.cannotOpenFile)
        player.setPitch(100)
        try await eventually { sleep.pending.count == 1 }
        sleep.wake()
        try await eventually { player.failure == RecordingScreenText.pitchNotSaved }
        #expect(player.pitchCents == 200)
        #expect(audio.calls.last == "setPitch(200)")
        player.setPitch(300)
        #expect(player.failure == nil)
    }

    @Test func aFailureSentAsThePageClosesStillShowsOnThePlayer() async throws {
        try await load()
        player.settleDelay = .seconds(60)
        writes.refusal = URLError(.cannotOpenFile)
        player.setSpeed(60)
        player.flushSettings()
        try await eventually { player.failure == RecordingScreenText.speedNotSaved }
        #expect(player.isLoaded)
    }

    @Test func closingThePlayerWritesASettlingChangeOnce() async throws {
        let sleep = ManualSleep()
        player.sleep = sleep.sleep
        try await load()
        player.setSpeed(60)
        player.close()
        try await eventually { sleep.cancelled == 1 }
        try await settled()
        #expect(writes.made == [PlaybackSettings(speedPercent: 60)])
    }

    @Test func aNewRevisionWithANewSettingFromElsewherePlaysThatSetting() async throws {
        try await load()
        player.setPitch(300)
        try await eventually { !writes.made.isEmpty }
        let next = URL(filePath: "/tmp/r1-bbbbbbbb.m4a")
        player.recordingChanged(id: "r1", to: recording(pitchCents: -100), audioFile: audioFile(next), tuneTitle: nil)
        #expect(audio.loaded == next)
        #expect(audio.calls.contains("setPitch(-100)"))
        #expect(player.pitchCents == -100)
    }

    @Test func finishingWaitsForTheWritesAndLeavingTheStoreDropsTheRest() async throws {
        let sleep = ManualSleep()
        player.sleep = sleep.sleep
        try await load()
        player.setSpeed(60)
        await player.finishSettings()
        #expect(writes.made == [PlaybackSettings(speedPercent: 60)])

        player.setPitch(-300)
        player.leaveStore()
        try await eventually { sleep.cancelled == 2 }
        try await settled()
        #expect(writes.made == [PlaybackSettings(speedPercent: 60)])
        #expect(!player.isLoaded)
        #expect(player.saveSettings == nil)
    }

    @Test func aFailedDeleteLoadsTheRecordingAgainAndSaysSo() async throws {
        try await load()
        audio.elapsed = 1.5
        await player.deleteLoadedRecording { throw CommandError.recordingNotFound }
        #expect(player.failure == CommandError.recordingNotFoundMessage)
        try await eventually { player.recordingAudio == .loaded }
        #expect(
            audio.calls.suffix(8) == [
                "unload", "load", "setWindow", "setRate(75)", "setPitch(200)", "setIsolate(default, mono: false)",
                "seek", "play",
            ])
        #expect(audio.elapsed == 1.5)

        await player.deleteLoadedRecording {}
        #expect(!player.isLoaded)
    }

    @Test func aPageRequestGoesToTheWindowThatAsked() {
        let asking = ShellPlace()
        let other = ShellPlace()
        RecordingPageOpener.shell(asking, player: player)("r1", source: .recordingsList)
        #expect(other.takeUnreportedOpen(of: "r1") == nil)
        #expect(asking.takeUnreportedOpen(of: "r1")?.tab == nil)
        #expect(player.pageSource == .recordingsList)
    }

    @Test func aLinkPlayedWhileAPageIsOpenShowsInEveryWindow() throws {
        RecordingPageOpener.shell(ShellPlace(), player: player)("r1", source: .recordingsList)
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
        player.recordingChanged(id: "r1", to: recording(speedPercent: 60), audioFile: audioFile(), tuneTitle: nil)
        #expect(audio.calls.count == before)
        player.hold("r1", nil)
        #expect(audio.calls.suffix(2) == ["setRate(60)", "setPitch(200)"])
    }

    @Test func theMoreMenuOffersTrimAndSplitBeforeDelete() {
        #expect(
            RecordingMenuItem.items(
                pinned: true, goesToTune: true, trimDisabledReason: RecordingScreenText.trimBusy) == [
                    .pin(pinned: true), .goToTune, .trim(disabledReason: RecordingScreenText.trimBusy),
                    .split(disabledReason: nil), .delete(disabledReason: nil),
                ])
        #expect(RecordingMenuItem.trim(disabledReason: nil).label == "Trim")
        #expect(RecordingMenuItem.delete(disabledReason: nil).label == RecordingRowActions.delete)
    }

    @Test func theMoreMenuLeavesTrimAndSplitOutWhenTheRecordingCannotTrim() {
        #expect(
            RecordingMenuItem.items(pinned: false, goesToTune: true, trimDisabledReason: nil, trims: false) == [
                .pin(pinned: false), .goToTune, .delete(disabledReason: nil),
            ])
    }

    @Test func theMoreMenuOpensAnImportedRecordingOnItsSiteBeforeTrim() throws {
        let page = "https://www.slippery-hill.com/content/bear-creek-sally-goodin"
        func imported(_ url: String?, origin: String = "slippery_hill") -> Recording {
            Recording(tuneID: nil, source: "import", origin: origin, originURL: url, addedAt: noon)
        }
        let open = try #require(RecordingMenuItem.openOrigin(for: imported(page)))
        #expect(open == .openOrigin(site: "Slippery-Hill", page: try #require(URL(string: page))))
        #expect(open.label == RecordingRowActions.openOn("Slippery-Hill"))
        #expect(
            RecordingMenuItem.items(pinned: true, goesToTune: true, trimDisabledReason: nil, openOrigin: open) == [
                .pin(pinned: true), .goToTune, open, .trim(disabledReason: nil), .split(disabledReason: nil),
                .delete(disabledReason: nil),
            ])
        #expect(RecordingMenuItem.openOrigin(for: imported("javascript:alert(1)")) == nil)
        #expect(RecordingMenuItem.openOrigin(for: imported(nil, origin: "own")) == nil)
    }

    /// A recording that only knows its upload's length still shows it in the heading.
    @Test func practiceHeaderShowsTheLength() {
        let row = Recording(
            id: "r1", tuneID: nil, source: "microphone", addedAt: noon, label: nil, state: "ready",
            durationMs: 184_000)
        let rows = ScreenRows(
            recording: row, file: nil, tuneID: nil, tuneTitle: nil, partStructure: nil, shownPlace: nil)
        #expect(rows.trimmedLengthMs == 184_000)
        #expect(RecordingText.duration(milliseconds: rows.trimmedLengthMs) == "3:04")
        #expect(RecordingPageRows.subtitle(rows).contains("3:04"))

        // A playback file cut from the trim start already plays the trimmed length.
        var trimmed = row
        trimmed.trimStartMs = 4_000
        trimmed.playbackStartMs = 4_000
        let trimmedRows = ScreenRows(
            recording: trimmed, file: nil, tuneID: nil, tuneTitle: nil, partStructure: nil, shownPlace: nil)
        #expect(trimmedRows.trimmedLengthMs == 184_000)
    }

    @Test func theSpeedAndPitchSegmentsNameTheirValuesOffDefault() {
        #expect(PracticeMode.allCases == [.speed, .pitch, .isolate, .loops])
        #expect(PracticeMode.loops.title(speedPercent: 75, pitchCents: 200, isolate: .standard) == "Loops")
        #expect(PracticeMode.speed.title(speedPercent: 100, pitchCents: 0, isolate: .standard) == "Speed")
        #expect(PracticeMode.speed.title(speedPercent: 75, pitchCents: 0, isolate: .standard) == "Speed 75%")
        #expect(PracticeMode.pitch.title(speedPercent: 100, pitchCents: 0, isolate: .standard) == "Pitch")
        #expect(PracticeMode.pitch.title(speedPercent: 100, pitchCents: 200, isolate: .standard) == "Pitch +2")
        #expect(PracticeText.segment("Speed", value: nil) == "Speed")
    }

    @Test func aRecordingStillCapturingDisablesTheWaveformTransportAndModesWithTheReason() {
        #expect(RecordingScreenText.screenUnavailableReason(file: nil, downloading: false) == nil)
        #expect(
            RecordingScreenText.screenUnavailableReason(
                file: RecordingFile(id: "r1", localState: .capturing), downloading: false)
                == RecordingScreenText.trimWhileRecording)
        #expect(
            RecordingScreenText.screenUnavailableReason(file: nil, downloading: true)
                == RecordingScreenText.trimWhileDownloading)
        // A pending trim blocks Trim but leaves the rest of the screen working.
        var cutting = recording()
        cutting.playbackStartMs = 0
        cutting.playbackEndMs = 4000
        #expect(RecordingScreenText.trimDisabledReason(cutting, file: nil, audio: .loaded) != nil)
        #expect(RecordingScreenText.screenUnavailableReason(file: nil, downloading: false) == nil)
    }

    @Test func thePlayButtonNamesTheRepeat() {
        #expect(
            PlayButtonLabel(isPlaying: false, repeating: nil)
                == PlayButtonLabel(label: "Play", systemImage: "play.fill"))
        #expect(
            PlayButtonLabel(isPlaying: false, repeating: "B part")
                == PlayButtonLabel(label: "Repeat B part", systemImage: "repeat"))
        #expect(
            PlayButtonLabel(isPlaying: true, repeating: "B part")
                == PlayButtonLabel(label: "Pause", systemImage: "pause.fill"))
    }

    @Test func theWaveformReadsThePlayheadAgainstTheLength() {
        #expect(PracticeText.position(42_300, of: 190_000) == "0:42 of 3:10")
    }

    @Test func theBadgeOpensTheLoadedRecordingsPracticeTab() async throws {
        let place = ShellPlace()
        try await load()
        player.openLoaded(recordingPage: .shell(place, player: player), tune: nil, source: .dock)
        #expect(place.takeUnreportedOpen(of: "r1")?.tab == .practice)
        #expect(player.isLoaded)
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
        let row = recording()
        var capturing = RecordingFile(id: "r1", localState: .capturing)
        #expect(
            RecordingScreenText.trimDisabledReason(row, file: capturing, audio: .loaded)
                == RecordingScreenText.trimWhileRecording)
        capturing.localState = .downloaded
        #expect(
            RecordingScreenText.trimDisabledReason(row, file: capturing, audio: .fetching)
                == RecordingScreenText.trimWhileDownloading)

        var cutting = recording()
        cutting.playbackStartMs = 0
        cutting.playbackEndMs = 4000
        #expect(
            RecordingScreenText.trimDisabledReason(cutting, file: nil, audio: .loaded) == RecordingScreenText.trimBusy)
        cutting.playbackStartMs = 1000
        cutting.playbackEndMs = 3000
        #expect(RecordingScreenText.trimDisabledReason(cutting, file: nil, audio: .loaded) == nil)
    }

    @Test func showsOnlyPeaksThatLineUpWithTheTrim() throws {
        // 5 points a second of 20 ms windows is 50 per second: 4 s of source.
        let values = (0..<200).map { UInt8($0 % 256) }
        let peaks = Peaks(values: values)
        var row = recording()
        row.peaksRev = "p1"
        row.playbackStartMs = 500

        let local = ShownPeaks(row, peaks: peaks, peaksRev: nil)
        #expect(local.map { Array($0.values) } == Array(values[50..<150]))
        #expect(local?.loudest == 199)

        let server = ShownPeaks(row, peaks: peaks, peaksRev: "p1")
        #expect(server.map { Array($0.values) } == Array(values[25..<125]))
        #expect(ShownPeaks(row, peaks: peaks, peaksRev: "old") == nil)
        #expect(ShownPeaks(row, peaks: nil, peaksRev: nil) == nil)
    }

    @Test func slicingShownPeaksFloorsOffsetsToPointIndicesWithinTheTrim() throws {
        let values = (0..<200).map { UInt8($0 % 256) }
        let shown = try #require(ShownPeaks(recording(), peaks: Peaks(values: values), peaksRev: nil))
        let trimmed = Array(shown.values)

        let sliced = shown.sliced(fromMs: 400, toMs: 1000)

        #expect(Array(sliced.values) == Array(trimmed[20..<50]))
        #expect(sliced.loudest == shown.loudest)
        #expect(Array(sliced.sliced(fromMs: 20, toMs: 60).values) == Array(trimmed[21..<23]))
        #expect(shown.sliced(fromMs: 500, toMs: 500).values.isEmpty)
    }
}

@Suite struct ShownPeaksGridTests {
    @Test func aGridBarTakesTheLoudestPointItCoversWhereverTheGridStarts() throws {
        let values = (0..<200).map { UInt8($0 % 256) }
        // The trim keeps points 50 to 149, the loudest point in the file is 199.
        let shown = try #require(ShownPeaks(recording(), peaks: Peaks(values: values), peaksRev: nil))

        // 50 ms bars over 20 ms points: bar 1 covers 50-100 ms, points 2 to 4.
        #expect(shown.gridLevel(barMs: 50, index: 0) == CGFloat(51) / 199)
        #expect(shown.gridLevel(barMs: 50, index: 1) == CGFloat(54) / 199)
        // A bar narrower than a point still takes one.
        #expect(shown.gridLevel(barMs: 10, index: 3) == CGFloat(51) / 199)
        #expect(shown.gridLevel(barMs: 50, index: -1) == nil)
        #expect(shown.gridLevel(barMs: 50, index: 40) == nil)
    }
}
