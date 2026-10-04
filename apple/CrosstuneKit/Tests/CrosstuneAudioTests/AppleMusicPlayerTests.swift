import Foundation
import Testing

@testable import CrosstuneAudio

@Suite struct GuardMoveTests {
    @Test func aMoveForwardNearTheEndIsTheSongFinishing() {
        #expect(trackEnd(fromIndex: 1, toIndex: 2, positionBefore: 197, duration: 200) == .finished)
        #expect(trackEnd(fromIndex: 1, toIndex: 2, positionBefore: 199.6, duration: 200) == .finished)
    }

    @Test func anyOtherMoveForwardIsNext() {
        #expect(trackEnd(fromIndex: 1, toIndex: 2, positionBefore: 196.9, duration: 200) == .next)
        #expect(trackEnd(fromIndex: 1, toIndex: 2, positionBefore: 0, duration: 200) == .next)
        #expect(trackEnd(fromIndex: 1, toIndex: 2, positionBefore: 199, duration: nil) == .next)
    }

    @Test func aMoveBackIsPreviousWithThePositionBeforeIt() {
        #expect(trackEnd(fromIndex: 1, toIndex: 0, positionBefore: 42.5, duration: 200) == .previous(elapsed: 42.5))
        #expect(trackEnd(fromIndex: 1, toIndex: 0, positionBefore: 199, duration: 200) == .previous(elapsed: 199))
    }

    @Test func noMoveIsNoEnd() {
        #expect(trackEnd(fromIndex: 1, toIndex: 1, positionBefore: 199, duration: 200) == nil)
    }
}

@Suite struct SongPositionTests {
    @Test func followsReadingsThatMoveOn() {
        var position = SongPosition()
        for reading in [0.25, 0.5, 0.75, 10, 10.25] { position.reading(reading) }
        #expect(position.seconds == 10.25)
    }

    @Test func ignoresASingleReadingThatFallsByMoreThanASecond() {
        var position = SongPosition()
        position.reading(254.8)
        position.reading(255)
        position.reading(0.3)
        #expect(position.seconds == 255)
    }

    @Test func keepsASecondLowReadingInARow() {
        var position = SongPosition()
        position.reading(120)
        position.reading(5)
        #expect(position.seconds == 120)
        position.reading(5.25)
        #expect(position.seconds == 5.25)
    }

    @Test func keepsASmallFall() {
        var position = SongPosition()
        position.reading(30)
        position.reading(29.2)
        #expect(position.seconds == 29.2)
    }

    @Test func aReadingAfterAnIgnoredOneStartsTheCheckOver() {
        var position = SongPosition()
        position.reading(100)
        position.reading(0.2)
        position.reading(100.5)
        position.reading(0.3)
        #expect(position.seconds == 100.5)
    }
}

@Suite struct SongPositionSeekTests {
    @Test func aSeekBackIsTakenAtOnceAndTheNextReadingFollowsIt() {
        var position = SongPosition()
        position.reading(100)
        position.seek(to: 85)
        #expect(position.seconds == 85)
        position.reading(85.25)
        #expect(position.seconds == 85.25)
    }

    @Test func aSeekClearsASetAsideReading() {
        var position = SongPosition()
        position.reading(100)
        position.reading(0.2)
        position.seek(to: 199.8)
        position.reading(0.1)
        #expect(position.seconds == 199.8)
    }
}

@Suite struct StrayPlaysTests {
    private let start = ContinuousClock.now

    @Test func aPlayStillReportedFromBeforeThePauseIsPausedButNotCounted() {
        var strays = StrayPlays()
        let first = strays.status(playing: true, at: start)
        let second = strays.status(playing: true, at: start + .seconds(0.01))
        #expect(first && second)
        #expect(strays.pausedAt == nil)
    }

    @Test func aPlayAfterAStoppedStatusIsCounted() {
        var strays = StrayPlays()
        let before = strays.status(playing: true, at: start)
        let stopped = strays.status(playing: false, at: start + .seconds(0.05))
        #expect(before && !stopped)
        #expect(strays.pausedAt == nil)
        let stray = start + .seconds(0.9)
        let paused = strays.status(playing: true, at: stray)
        #expect(paused)
        #expect(strays.pausedAt == stray)
    }

    @Test func aLaterPlayMovesTheCountOn() {
        var strays = StrayPlays()
        _ = strays.status(playing: false, at: start)
        _ = strays.status(playing: true, at: start + .seconds(0.1))
        _ = strays.status(playing: true, at: start + .seconds(0.3))
        #expect(strays.pausedAt == start + .seconds(0.3))
    }
}

@Suite struct PreviousSettleTests {
    private let start = ContinuousClock.now

    @Test func waitsWhileNoStrayPlayHasBeenPaused() {
        #expect(!previousHasSettled(waitingSince: start, strayPausedAt: nil, now: start + .seconds(1.4)))
    }

    @Test func goesAheadOnceAStrayPlayWasPausedAQuarterSecondAgo() {
        let paused = start + .seconds(0.5)
        #expect(!previousHasSettled(waitingSince: start, strayPausedAt: paused, now: paused + .seconds(0.2)))
        #expect(previousHasSettled(waitingSince: start, strayPausedAt: paused, now: paused + .seconds(0.25)))
    }

    @Test func goesAheadAtOnceForAStrayPlayPausedBeforeTheWait() {
        let paused = start - .seconds(1)
        #expect(previousHasSettled(waitingSince: start, strayPausedAt: paused, now: start))
    }

    @Test func givesUpWaitingAfterOneAndAHalfSeconds() {
        #expect(previousHasSettled(waitingSince: start, strayPausedAt: nil, now: start + .seconds(1.5)))
    }
}
