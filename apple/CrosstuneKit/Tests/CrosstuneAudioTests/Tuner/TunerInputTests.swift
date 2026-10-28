import Foundation
import Synchronization
import Testing

@testable import CrosstuneAudio

private struct EngineFailed: Error {}

/// Replaces the engine, recording each call in order.
private final class FakeTunerEngine: TunerEngine {
    struct State {
        var log: [String] = []
        var failStart = false
        var activateError: (any Error)?
        /// Yields to playback while the setup is queued, as a play started meanwhile would.
        var yieldDuringActivate = false
        var stopped = false
        var pitch: ReferencePitch?
        var onReading: (@MainActor @Sendable (Reading?) -> Void)?
    }

    let state = Mutex(State())
    let registry: TunerRegistry

    init(registry: TunerRegistry) {
        self.registry = registry
    }

    var log: [String] { state.withLock { $0.log } }

    func activate(unlessYieldedSince yields: UInt64) async throws {
        if state.withLock({ $0.yieldDuringActivate }) {
            await registry.yieldToPlayback()
        }
        try state.withLock { state in
            state.log.append("activate")
            if let error = state.activateError { throw error }
        }
        guard registry.claims.yields == yields else { throw YieldedToPlayback() }
    }

    func start(
        pitch: ReferencePitch, onReading: @escaping @MainActor @Sendable (Reading?) -> Void,
        onChange _: @escaping @Sendable () -> Void
    ) async throws {
        try state.withLock { state in
            state.log.append("start")
            if state.failStart { throw EngineFailed() }
            state.pitch = pitch
            state.onReading = onReading
            state.stopped = false
        }
    }

    func isStopped() async -> Bool { state.withLock { $0.stopped } }

    func stop() async {
        state.withLock { state in
            state.log.append("stop")
            state.stopped = true
        }
    }

    func deactivate() async { state.withLock { $0.log.append("deactivate") } }

    /// Calls the reading callback the newest start was given, as the tap would.
    @MainActor func deliver(_ reading: Reading?) {
        state.withLock { $0.onReading }?(reading)
    }
}

@MainActor
private final class Heard {
    var readings: [Reading?] = []
    var ended = 0
    var yields: [TunerYield] = []
}

private let a4Reading = Reading(
    frequency: 440, note: Note(name: .a, octave: 4, cents: 0), atMs: 100)

private func sine(_ frequency: Double, seconds: Double, sampleRate: Double) -> [Float] {
    (0..<Int(seconds * sampleRate)).map { Float(0.3 * sin(2 * .pi * frequency * Double($0) / sampleRate)) }
}

extension Tuner {
    @MainActor
    @Suite struct TunerInputTests {
        private let registry = TunerRegistry(claims: AudioSessionClaims())
        private let engine: FakeTunerEngine
        private let heard = Heard()
        private let input: TunerInput

        init() {
            engine = FakeTunerEngine(registry: registry)
            input = TunerInput(engine: engine, registry: registry)
        }

        private func start(a4: Double = 440) async throws {
            let heard = heard
            try await input.start(
                a4: a4, onReading: { heard.readings.append($0) }, onEnded: { heard.ended += 1 },
                onYield: { heard.yields.append($0) })
        }

        @Test func aYieldWhileTheSetupIsQueuedOvertakesTheStartWithoutAFailure() async throws {
            engine.state.withLock { $0.yieldDuringActivate = true }

            await #expect(throws: TunerStartOvertaken.self) { try await start() }

            #expect(heard.ended == 0)
            #expect(!input.holdsMicrophone)
            #expect(engine.log == ["activate"])
        }

        @Test func activatesTheSessionBeforeTheEngineAndReleasesItAfter() async throws {
            try await start()
            await input.stop()

            #expect(engine.log == ["activate", "start", "stop", "deactivate"])
        }

        @Test func dropsReadingsTheTapSendsAfterAStop() async throws {
            try await start()
            engine.deliver(a4Reading)
            await input.stop()
            engine.deliver(a4Reading)

            #expect(heard.readings == [a4Reading])
        }

        @Test func passesTheReferencePitchToTheTap() async throws {
            try await start(a4: 442)
            let pitch = try #require(engine.state.withLock { $0.pitch })
            #expect(pitch.value == 442)

            input.setA4(445)

            #expect(pitch.value == 445)
        }

        @Test func restartsWhenTheEngineConfigurationChanges() async throws {
            try await start()
            await input.configurationChanged()

            #expect(engine.log == ["activate", "start", "start"])
            #expect(heard.ended == 0)
        }

        @Test func aFailedRestartEndsAndReleasesTheSession() async throws {
            try await start()
            engine.state.withLock { $0.failStart = true }
            await input.configurationChanged()

            #expect(heard.ended == 1)
            #expect(engine.log.suffix(2) == ["stop", "deactivate"])
        }

        @Test func anInterruptionStopsAndClearsTheReading() async throws {
            try await start()
            engine.deliver(a4Reading)
            await input.interruptionBegan()
            engine.deliver(a4Reading)

            #expect(engine.log == ["activate", "start", "stop"])
            #expect(heard.readings == [a4Reading, nil])
            #expect(heard.ended == 0)
        }

        @Test func listensAgainWhenTheInterruptionEnds() async throws {
            try await start()
            await input.interruptionBegan()
            await input.interruptionEnded()

            #expect(engine.log == ["activate", "start", "stop", "activate", "start"])
            engine.deliver(a4Reading)
            #expect(heard.readings == [nil, a4Reading])
        }

        @Test func waitsForTheNextInterruptionEndWhileAnotherAppKeepsTheSession() async throws {
            try await start()
            await input.interruptionBegan()
            let busy = NSError(domain: NSOSStatusErrorDomain, code: 0x2170_7269)
            #expect(TunerInput.isBusy(busy))
            engine.state.withLock { $0.activateError = busy }
            await input.interruptionEnded()

            #expect(heard.ended == 0)
            #expect(engine.log == ["activate", "start", "stop", "activate"])

            engine.state.withLock { $0.activateError = nil }
            await input.interruptionEnded()
            #expect(engine.log == ["activate", "start", "stop", "activate", "activate", "start"])
        }

        @Test func anotherActivationFailureAfterAnInterruptionEnds() async throws {
            try await start()
            await input.interruptionBegan()
            engine.state.withLock { $0.activateError = EngineFailed() }
            await input.interruptionEnded()

            #expect(heard.ended == 1)
            #expect(engine.log.suffix(2) == ["stop", "deactivate"])
        }

        @Test func holdsTheMicrophoneFromStartUntilStop() async throws {
            #expect(!input.holdsMicrophone)
            try await start()
            #expect(input.holdsMicrophone)
            await input.stop()
            #expect(!input.holdsMicrophone)
        }

        @Test func yieldingToPlaybackLetsGoAtOnceAndIgnoresTheSessionChange() async throws {
            try await start()
            engine.deliver(a4Reading)
            registry.yieldToPlayback()
            #expect(!input.holdsMicrophone)

            engine.deliver(a4Reading)
            engine.state.withLock { $0.failStart = true }
            await input.configurationChanged()

            #expect(heard.readings == [a4Reading])
            #expect(heard.ended == 0)
            #expect(engine.log == ["activate", "start"])

            await input.stop()
            #expect(engine.log == ["activate", "start", "stop", "deactivate"])
        }

        @Test func tellsAYieldedTunerWhenThePlayDidNotStart() async throws {
            try await start()
            registry.yieldToPlayback()
            #expect(heard.yields == [.yielded])

            await input.stop()
            registry.playbackDidNotStart()
            registry.playbackDidNotStart()
            #expect(heard.yields == [.yielded, .playbackDidNotStart])
        }

        @Test func aNewStartForgetsAnEarlierYield() async throws {
            try await start()
            registry.yieldToPlayback()
            try await start()
            registry.playbackDidNotStart()

            #expect(heard.yields == [.yielded])
        }

        @Test func anInterruptionEndAfterAStopDoesNothing() async throws {
            try await start()
            await input.interruptionBegan()
            await input.stop()
            await input.interruptionEnded()

            #expect(engine.log == ["activate", "start", "stop", "stop", "deactivate"])
        }

        @Test func aMediaServicesResetStartsOverOnANewSession() async throws {
            try await start()
            await input.mediaServicesReset()

            #expect(engine.log == ["activate", "start", "stop", "activate", "start"])
            #expect(heard.ended == 0)
        }

        @Test func aRouteChangeRestartsAnEngineItLeftStopped() async throws {
            try await start()
            await input.routeChanged()
            #expect(engine.log == ["activate", "start"])

            engine.state.withLock { $0.stopped = true }
            await input.routeChanged()
            #expect(engine.log == ["activate", "start", "start"])
        }
    }

    @Suite struct TunerTapTests {
        private let sampleRate = 48_000.0
        private let frames = 1024

        /// Feeds `samples` in tap-sized buffers and returns every reading the tap passed on.
        private func feed(_ tap: TunerTap, _ samples: [Float]) -> [Reading?] {
            var delivered: [Reading?] = []
            samples.withUnsafeBufferPointer { buffer in
                for at in stride(from: 0, to: buffer.count, by: frames) {
                    let chunk = UnsafeBufferPointer(rebasing: buffer[at..<min(at + frames, buffer.count)])
                    tap.process(chunk) { delivered.append($0) }
                }
            }
            return delivered
        }

        @Test func passesOneNilOnSilenceFromTheFirstBuffer() {
            let tap = TunerTap(sampleRate: sampleRate, pitch: ReferencePitch(440))

            let delivered = feed(tap, [Float](repeating: 0, count: 48_000))
            #expect(delivered.count == 1)
            #expect(delivered.first == .some(nil))
        }

        @Test func passesOneNilWhenTheNoteFades() throws {
            let tap = TunerTap(sampleRate: sampleRate, pitch: ReferencePitch(440))

            let note = feed(tap, sine(440, seconds: 0.5, sampleRate: sampleRate))
            #expect(note.first == .some(nil))
            #expect(note.count > 1)
            #expect(note.dropFirst().allSatisfy { $0?.note.name == .a })

            let after = feed(tap, [Float](repeating: 0, count: 48_000))
            #expect(after.last == .some(nil))
            #expect(after.filter { $0 == nil }.count == 1)
        }

        @Test func appliesANewReferencePitchBeforeTheNextBuffer() throws {
            let pitch = ReferencePitch(440)
            let tap = TunerTap(sampleRate: sampleRate, pitch: pitch)
            _ = feed(tap, sine(440, seconds: 0.5, sampleRate: sampleRate))

            pitch.value = 450
            let reading = try #require(feed(tap, sine(440, seconds: 0.05, sampleRate: sampleRate)).last ?? nil)

            #expect(reading.note.name == .a)
            #expect(reading.note.cents < -30)
        }
    }

    /// Records each session step, as the device's session would take it.
    private final class FakeSession: TunerSession {
        let steps = Mutex<[String]>([])

        func setUp() throws { steps.withLock { $0.append("setUp") } }
        func tearDown() { steps.withLock { $0.append("tearDown") } }
    }

    @Suite struct TunerRunnerTests {
        private let claims = AudioSessionClaims()
        private let session = FakeSession()
        private let player = AudioSessionOwner()

        private func playerReleases() -> Bool {
            var ran = false
            claims.release(player) { ran = true }
            return ran
        }

        @Test func aSetupAskedForBeforeAYieldLeavesTheSessionToThePlayer() async {
            let runner = TunerRunner(claims: claims, session: session)
            let asked = claims.yields
            claims.yieldToPlayback()
            claims.claim(player)

            await #expect(throws: YieldedToPlayback.self) { try await runner.activate(unlessYieldedSince: asked) }

            #expect(session.steps.withLock { $0 }.isEmpty)
            #expect(playerReleases())
        }

        @Test func aSetupBeforeThePlayersClaimNeverDeactivatesUnderIt() async throws {
            let runner = TunerRunner(claims: claims, session: session)
            try await runner.activate(unlessYieldedSince: claims.yields)
            claims.yieldToPlayback()
            claims.claim(player)

            await runner.deactivate()

            #expect(session.steps.withLock { $0 } == ["setUp"])
            #expect(playerReleases())
        }

        /// MusicKit plays on the session without claiming it, so the tuner's stop must not end it.
        @Test func aYieldWithNoClaimAfterItNeverDeactivates() async throws {
            let runner = TunerRunner(claims: claims, session: session)
            try await runner.activate(unlessYieldedSince: claims.yields)
            claims.yieldToPlayback()

            await runner.deactivate()

            #expect(session.steps.withLock { $0 } == ["setUp"])
        }

        @Test func aSetupWithNoYieldClaimsAndReleasesTheSession() async throws {
            let runner = TunerRunner(claims: claims, session: session)
            try await runner.activate(unlessYieldedSince: claims.yields)
            await runner.deactivate()

            #expect(session.steps.withLock { $0 } == ["setUp", "tearDown"])
        }
    }
}
