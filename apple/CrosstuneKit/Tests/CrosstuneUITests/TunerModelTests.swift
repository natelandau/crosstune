import CrosstuneAudio
import CrosstuneTestSupport
import Foundation
import Testing

@testable import CrosstuneUI

private struct NoMicrophone: Error {}

/// Counts starts and stops, and lets a test push readings or end the input.
@MainActor
final class FakeTunerInput: TunerListening {
    var permission = true
    var failStart = false
    /// Throws as a start that playback overtook does.
    var overtakeStart = false
    /// Runs as a start begins, before it settles.
    var beforeStart: (@MainActor () -> Void)?
    private(set) var starts = 0
    private(set) var stops = 0
    /// The most sessions ever open at once.
    private(set) var mostOpen = 0
    private(set) var startA4s: [Double] = []
    private(set) var setA4s: [Double] = []
    private var onReading: (@MainActor @Sendable (Reading?) -> Void)?
    private var onEnded: (@MainActor @Sendable () -> Void)?
    private var onYield: (@MainActor @Sendable (TunerYield) -> Void)?
    /// Whether the engine runs, which a yield leaves running until a stop.
    private var running = false

    var open: Int { starts - stops }

    func requestPermission() async -> Bool {
        await Task.yield()
        return permission
    }

    func start(
        a4: Double, onReading: @escaping @MainActor @Sendable (Reading?) -> Void,
        onEnded: @escaping @MainActor @Sendable () -> Void,
        onYield: @escaping @MainActor @Sendable (TunerYield) -> Void
    ) async throws {
        beforeStart?()
        await Task.yield()
        if failStart { throw NoMicrophone() }
        if overtakeStart { throw TunerStartOvertaken() }
        starts += 1
        running = true
        mostOpen = max(mostOpen, open)
        startA4s.append(a4)
        self.onReading = onReading
        self.onEnded = onEnded
        self.onYield = onYield
    }

    func setA4(_ a4: Double) { setA4s.append(a4) }

    func stop() async {
        await Task.yield()
        guard running else { return }
        stops += 1
        running = false
        onReading = nil
        onEnded = nil
    }

    /// Lets go as `TunerInput` does when playback takes the session: callbacks first, the
    /// engine at the owner's stop.
    func yieldToPlayback() {
        let onYield = onYield
        onReading = nil
        onEnded = nil
        self.onYield = nil
        onYield?(.yielded)
        pendingYield = onYield
    }

    /// The play yielded to did not start.
    func playbackDidNotStart() {
        pendingYield?(.playbackDidNotStart)
        pendingYield = nil
    }

    private var pendingYield: (@MainActor @Sendable (TunerYield) -> Void)?

    func push(_ reading: Reading?) { onReading?(reading) }

    /// Ends as `TunerInput` does when the microphone goes away: it lets go of the session itself.
    func end() {
        let onEnded = onEnded
        stops += 1
        running = false
        onReading = nil
        self.onEnded = nil
        onEnded?()
    }
}

private let reading = Reading(frequency: 440, note: Note(name: .a, octave: 4, cents: 0), atMs: 100)

@MainActor
@Suite struct TunerModelTests {
    private let root = TemporaryRoot()
    private let input = FakeTunerInput()
    private let recorders = RecorderHost(makeInput: { ToneInput() })
    private let model: TunerModel

    init() {
        model = TunerModel(input: input, recorders: recorders)
    }

    private let window = UUID()

    private func update(
        client: UUID? = nil, shown: Bool = true, foreground: Bool = true, covered: Bool = false,
        playing: Bool = false, a4: Int? = 440
    ) async {
        await model.update(
            client: client ?? window, shown: shown, foreground: foreground, covered: covered, playing: playing,
            a4: a4)
    }

    @Test(arguments: [false, true], [false, true])
    func listensOnlyWhenShownForegroundAndUncovered(shown: Bool, foreground: Bool) async {
        for covered in [false, true] {
            await update(shown: shown, foreground: foreground, covered: covered)
            let listens = shown && foreground && !covered
            #expect(input.open == (listens ? 1 : 0))
            #expect(model.status == (listens ? .listening : .idle))
        }
    }

    @Test func neverHoldsTwoSessions() async {
        let steps = [true, false, true, false, true, false]
        var updates: [Task<Void, Never>] = []
        for shown in steps {
            updates.append(Task { await update(shown: shown) })
        }
        for update in updates { await update.value }

        #expect(input.mostOpen <= 1)
        #expect(input.open == 0)
        #expect(model.status == .idle)
    }

    @Test func coveredStopsAndUncoveringResumes() async {
        await update()
        await update(covered: true)
        #expect(input.open == 0)
        #expect(model.status == .idle)

        await update(covered: false)
        #expect(input.open == 1)
        #expect(input.starts == 2)
        #expect(model.status == .listening)
    }

    @Test func aPlayStopsListeningAndAPauseResumes() async {
        await update()
        input.push(reading)
        await update(playing: true)
        #expect(input.open == 0)
        #expect(model.status == .idle)
        #expect(model.reading == nil)

        await update(playing: false)
        #expect(input.open == 1)
        #expect(input.starts == 2)
        #expect(model.status == .listening)
    }

    @Test func aPlayHeardFromAnotherWindowHoldsEveryWindow() async {
        let (first, second) = (UUID(), UUID())
        await update(client: first)
        await update(client: second, playing: true)
        #expect(input.open == 0)

        await update(client: first, playing: false)
        #expect(input.open == 1)
    }

    @Test func aYieldToAPlayThatFailsListensAgain() async throws {
        await update()
        input.yieldToPlayback()
        #expect(model.status == .idle)
        try await eventually { input.open == 0 }

        input.playbackDidNotStart()
        try await eventually { model.status == .listening }
        #expect(input.open == 1)
        #expect(input.starts == 2)
        #expect(input.mostOpen == 1)
    }

    @Test func aYieldWaitsForThePlayToStartWithoutRestarting() async throws {
        await update()
        input.yieldToPlayback()
        // An update before the screen sees the play does not take the session back.
        await update(a4: 442)
        #expect(input.open == 0)
        #expect(model.status == .idle)

        await update(playing: true)
        await update(playing: false)
        #expect(input.open == 1)
        #expect(model.status == .listening)
        // A late notice for a play that did start changes nothing.
        input.playbackDidNotStart()
        #expect(input.starts == 2)
    }

    @Test func aYieldIsForgottenOnceTheTunerIsLeft() async throws {
        await update()
        input.yieldToPlayback()
        try await eventually { input.open == 0 }

        // The screen leaves while the play runs, the play ends, and the screen comes back.
        await update(shown: false)
        await update()
        #expect(input.open == 1)
        #expect(model.status == .listening)
    }

    @Test func recordingClaimsTheMicFirst() async throws {
        let store = try root.open()
        _ = recorders.claim(for: store)
        await update()
        #expect(input.starts == 0)

        recorders.release()
        await update()
        #expect(input.open == 1)
    }

    @Test func deniedPermissionShowsDenied() async {
        input.permission = false
        await update()

        #expect(model.status == .denied)
        #expect(input.starts == 0)
    }

    @Test func asksAgainOnTheNextVisitAfterADenial() async {
        input.permission = false
        await update()
        input.permission = true
        await update(a4: 442)
        #expect(input.starts == 0)

        await update(foreground: false)
        await update()
        #expect(input.open == 1)
        #expect(model.status == .listening)
    }

    @Test func anEndedInputShowsUnavailable() async {
        await update()
        input.push(reading)
        input.end()

        #expect(model.status == .unavailable)
        #expect(model.reading == nil)
        await update()
        #expect(input.starts == 1)
    }

    @Test func aStartPlaybackOvertookIsNoFailureAndTheNextUpdateStartsAgain() async {
        input.overtakeStart = true
        await update()
        #expect(model.status == .idle)

        input.overtakeStart = false
        await update()
        #expect(model.status == .listening)
        #expect(input.open == 1)
    }

    @Test func aFailedStartShowsUnavailable() async {
        input.failStart = true
        await update()

        #expect(model.status == .unavailable)
        #expect(input.open == 0)
    }

    @Test func aStartThatFailsAfterLeavingTriesAgainOnTheNextVisit() async {
        input.failStart = true
        var leaving: Task<Void, Never>?
        input.beforeStart = { leaving = Task { await update(shown: false) } }
        await update()
        await leaving?.value

        input.failStart = false
        input.beforeStart = nil
        await update()
        #expect(input.open == 1)
        #expect(model.status == .listening)
    }

    @Test func showsTheReadingsTheInputHears() async {
        await update()
        input.push(reading)
        #expect(model.reading == reading)

        input.push(nil)
        #expect(model.reading == nil)
    }

    @Test func clearsTheReadingWhenItStops() async {
        await update()
        input.push(reading)
        await update(shown: false)

        #expect(model.reading == nil)
    }

    @Test func aReferencePitchChangeReachesTheInput() async {
        await update(a4: 442)
        #expect(input.startA4s == [442])

        await update(a4: 445)
        #expect(input.setA4s == [445])
        #expect(input.starts == 1)
    }

    @Test func aWindowWithNoPitchKeepsTheOneSet() async {
        let (first, second) = (UUID(), UUID())
        await update(client: first, a4: 442)
        await update(client: second, a4: nil)
        await update(client: first, shown: false, a4: nil)

        #expect(input.startA4s == [442])
        #expect(input.setA4s.isEmpty)
        #expect(input.open == 1)
    }

    @Test func listensBeforeThePitchLoadsAndTakesItWhenItDoes() async {
        await update(a4: nil)
        #expect(input.startA4s == [440])

        await update(a4: 445)
        #expect(input.setA4s == [445])
    }

    @Test func listensWhileAnyWindowWants() async {
        let (first, second) = (UUID(), UUID())
        await update(client: first)
        await update(client: second)
        #expect(input.open == 1)
        #expect(input.starts == 1)

        await update(client: second, shown: false)
        #expect(input.open == 1)
        #expect(model.status == .listening)

        await update(client: first, shown: false)
        #expect(input.open == 0)
        #expect(model.status == .idle)
    }

    @Test func aCoveredWindowLeavesAnotherListening() async {
        let (first, second) = (UUID(), UUID())
        await update(client: first)
        await update(client: second, covered: true)
        #expect(input.open == 1)

        await update(client: first, foreground: false)
        #expect(input.open == 0)
    }
}
