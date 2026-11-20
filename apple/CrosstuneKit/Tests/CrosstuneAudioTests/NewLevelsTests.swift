import Testing

@testable import CrosstuneAudio

struct NewLevelsTests {
    @Test func takesOnlyLevelsSinceLastCall() {
        var levels = NewLevels()
        #expect(levels.take([1, 2, 3], total: 3) == [1, 2, 3])
        #expect(levels.take([2, 3, 4, 5], total: 5) == [4, 5])
        // A smaller total is a new recording.
        #expect(levels.take([9], total: 1) == [9])

        // A window shorter than the count is not overread.
        var fresh = NewLevels()
        #expect(fresh.take([1, 2], total: 400) == [1, 2])
    }
}
