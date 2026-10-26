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

@Suite struct UnrequestedPlaysTests {
    private let start = ContinuousClock.now

    @Test func aPlayStillReportedFromBeforeThePauseIsPausedButNotCounted() {
        var unrequested = UnrequestedPlays()
        let first = unrequested.status(playing: true, at: start)
        let second = unrequested.status(playing: true, at: start + .seconds(0.01))
        #expect(first && second)
        #expect(unrequested.pausedAt == nil)
    }

    @Test func aPlayAfterAStoppedStatusIsCounted() {
        var unrequested = UnrequestedPlays()
        let before = unrequested.status(playing: true, at: start)
        let stopped = unrequested.status(playing: false, at: start + .seconds(0.05))
        #expect(before && !stopped)
        #expect(unrequested.pausedAt == nil)
        let unrequestedAt = start + .seconds(0.9)
        let paused = unrequested.status(playing: true, at: unrequestedAt)
        #expect(paused)
        #expect(unrequested.pausedAt == unrequestedAt)
    }

    @Test func aLaterPlayMovesTheCountOn() {
        var unrequested = UnrequestedPlays()
        _ = unrequested.status(playing: false, at: start)
        _ = unrequested.status(playing: true, at: start + .seconds(0.1))
        _ = unrequested.status(playing: true, at: start + .seconds(0.3))
        #expect(unrequested.pausedAt == start + .seconds(0.3))
    }
}

@Suite struct PreviousSettleTests {
    private let start = ContinuousClock.now

    @Test func waitsWhileNoUnrequestedPlayHasBeenPaused() {
        #expect(!previousHasSettled(waitingSince: start, unrequestedPausedAt: nil, now: start + .seconds(1.4)))
    }

    @Test func goesAheadOnceAnUnrequestedPlayWasPausedAQuarterSecondAgo() {
        let paused = start + .seconds(0.5)
        #expect(!previousHasSettled(waitingSince: start, unrequestedPausedAt: paused, now: paused + .seconds(0.2)))
        #expect(previousHasSettled(waitingSince: start, unrequestedPausedAt: paused, now: paused + .seconds(0.25)))
    }

    @Test func goesAheadAtOnceForAnUnrequestedPlayPausedBeforeTheWait() {
        let paused = start - .seconds(1)
        #expect(previousHasSettled(waitingSince: start, unrequestedPausedAt: paused, now: start))
    }

    @Test func givesUpWaitingAfterOneAndAHalfSeconds() {
        #expect(previousHasSettled(waitingSince: start, unrequestedPausedAt: nil, now: start + .seconds(1.5)))
    }
}
