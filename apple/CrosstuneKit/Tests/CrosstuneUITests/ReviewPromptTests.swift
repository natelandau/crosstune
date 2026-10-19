import CrosstuneAnalytics
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private let tuneID = "6f1c2a9e-7d3b-4e0a-9c1f-2b8d4a6e5c70"
private let recordingID = "0b7e4f2a-3c1d-4a9b-8e6f-5d2c1b0a9f83"

private let tuneCreated = AnalyticsEvent.tuneCreated(source: .catalog, fieldsSet: [.title], tuneID: tuneID)
private let recordingSaved = AnalyticsEvent.recordingSaved(seconds: 30, recordingID: recordingID, tuneID: tuneID)
private let practiceEnded = AnalyticsEvent.practiceEnded(
    PracticeReport(
        source: .recordingsList, durationMs: 150_000, usedLoops: true, usedSpeed: false, usedPitch: false,
        kind: .recorded, recordingID: recordingID, tuneID: tuneID))

@MainActor
struct ReviewPromptTests {
    private let suite = TemporaryDefaults("review-prompt")
    private let clock = Clock()

    /// A clock the test moves by hand.
    final class Clock {
        var now = Date(timeIntervalSince1970: 1_800_000_000)
    }

    private func prompt() -> ReviewPrompt {
        let clock = clock
        return ReviewPrompt(defaults: suite.defaults, now: { clock.now })
    }

    private func open(_ prompt: ReviewPrompt, times: Int) {
        for _ in 0..<times {
            prompt.leftForeground()
            prompt.opened()
        }
    }

    /// Ten opens, a week gone, and every milestone but the last noted.
    private func almostReady() -> ReviewPrompt {
        let prompt = prompt()
        open(prompt, times: ReviewPrompt.opensNeeded)
        clock.now = clock.now.addingTimeInterval(8 * 86_400)
        prompt.note(tuneCreated)
        prompt.note(recordingSaved)
        return prompt
    }

    @Test func isDueOnceEveryMilestoneOpensAndAWeekHaveCome() {
        let prompt = almostReady()
        #expect(!prompt.isDue)

        prompt.note(practiceEnded)

        #expect(prompt.isDue)
    }

    @Test func waitsForTheTenthOpen() {
        let prompt = prompt()
        open(prompt, times: ReviewPrompt.opensNeeded - 1)
        clock.now = clock.now.addingTimeInterval(8 * 86_400)
        for event in [tuneCreated, recordingSaved, practiceEnded] { prompt.note(event) }
        #expect(!prompt.isDue)

        open(prompt, times: 1)
        prompt.note(practiceEnded)

        #expect(prompt.isDue)
    }

    @Test func countsAnOpenOnlyAfterTheBackground() {
        let prompt = prompt()
        open(prompt, times: ReviewPrompt.opensNeeded - 1)
        clock.now = clock.now.addingTimeInterval(8 * 86_400)
        prompt.opened()
        for event in [tuneCreated, recordingSaved, practiceEnded] { prompt.note(event) }

        #expect(!prompt.isDue)
    }

    @Test func aMilestoneOnTheWayOutCountsButDoesNotMakeItDue() {
        let prompt = almostReady()
        prompt.leftForeground()
        prompt.note(practiceEnded)
        #expect(!prompt.isDue)

        prompt.opened()
        prompt.note(tuneCreated)

        #expect(prompt.isDue)
    }

    @Test func waitsAWeekFromTheFirstOpen() {
        let prompt = prompt()
        open(prompt, times: ReviewPrompt.opensNeeded)
        clock.now = clock.now.addingTimeInterval(6 * 86_400)
        for event in [tuneCreated, recordingSaved, practiceEnded] { prompt.note(event) }
        #expect(!prompt.isDue)

        clock.now = clock.now.addingTimeInterval(86_400)
        prompt.note(practiceEnded)

        #expect(prompt.isDue)
    }

    @Test func becomesDueOnlyAtAMilestone() {
        let prompt = prompt()
        prompt.opened()
        for event in [tuneCreated, recordingSaved, practiceEnded] { prompt.note(event) }
        clock.now = clock.now.addingTimeInterval(8 * 86_400)
        open(prompt, times: ReviewPrompt.opensNeeded - 1)
        prompt.note(.searchPerformed(resultCount: 3, tookOffer: false))
        #expect(!prompt.isDue)

        prompt.note(recordingSaved)

        #expect(prompt.isDue)
    }

    @Test func neverAsksTwiceOnOneDevice() {
        let prompt = almostReady()
        prompt.note(practiceEnded)
        prompt.asked()
        #expect(!prompt.isDue)

        let relaunched = self.prompt()
        open(relaunched, times: 20)
        relaunched.note(practiceEnded)

        #expect(!relaunched.isDue)
    }

    @Test func countsAnImportThatAddedTunesAndAnImportedRecording() {
        let prompt = prompt()
        open(prompt, times: ReviewPrompt.opensNeeded)
        clock.now = clock.now.addingTimeInterval(8 * 86_400)

        prompt.note(.importCompleted(reader: .plain, added: 0, skipped: 2, list: .none))
        prompt.note(.audioImported(fileCount: 1, format: .flac))
        prompt.note(practiceEnded)
        #expect(!prompt.isDue)

        prompt.note(.importCompleted(reader: .plain, added: 4, skipped: 0, list: .none))

        #expect(prompt.isDue)
    }
}
