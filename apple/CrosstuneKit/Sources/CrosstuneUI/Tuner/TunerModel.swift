import CrosstuneAudio
import Foundation
import Observation

/// Listens through the microphone while the Tuner can be seen in any window, and holds what it
/// hears. The app makes one, so windows never open the microphone twice or release the audio
/// session under one another.
@MainActor
@Observable
public final class TunerModel {
    public enum Status: Equatable { case idle, listening, denied, unavailable }

    public private(set) var status: Status = .idle
    public private(set) var reading: Reading?

    @ObservationIgnored private let input: any TunerListening
    @ObservationIgnored private let recorders: RecorderHost
    @ObservationIgnored private var wanted = false
    /// The windows that want to listen now.
    @ObservationIgnored private var wanting: Set<UUID> = []
    @ObservationIgnored private var a4 = 440
    /// True from asking the input to start until asking it to stop, or until it ends.
    @ObservationIgnored private var open = false
    /// Set once playback took the session while listening was wanted, and cleared once it no
    /// longer is, as while the play runs, or the play did not start, so the tuner never takes
    /// the session back from a play about to begin.
    @ObservationIgnored private var yielded = false
    /// Set by a denial or a failed microphone while listening is wanted, and cleared once it no
    /// longer is, so the next visit tries again but nothing retries in a loop meanwhile. Each
    /// lands after an await, so one that lands once the window has gone is not kept.
    @ObservationIgnored private var heldOff = false
    /// Changes with every start and stop, so a callback from an earlier session is ignored.
    @ObservationIgnored private var session = 0
    /// The newest update's work. Each waits for the one before, so a start never overlaps
    /// the stop before it.
    @ObservationIgnored private var settled: Task<Void, Never>?

    public init(input: any TunerListening, recorders: RecorderHost) {
        self.input = input
        self.recorders = recorders
    }

    /// Single entry point for every lifecycle signal, one `client` per window; listens while any
    /// client is shown, foreground, and uncovered, nothing plays, and no record sheet or take
    /// holds the microphone. Each window calls it again whenever `recorders.isCapturing`
    /// changes, as well as when any argument does, and with `shown` false as it goes. The player
    /// and the reference pitch are the app's, so the newest call's `playing` and `a4` hold for
    /// every window. A nil `a4`, from a window whose settings have not loaded or that does not
    /// want to listen, keeps the pitch another window set.
    public func update(
        client: UUID, shown: Bool, foreground: Bool, covered: Bool, playing: Bool, a4: Int?
    ) async {
        if shown && foreground && !covered {
            wanting.insert(client)
        } else {
            wanting.remove(client)
        }
        // A record sheet or a take being saved has the microphone first, and a play stops the
        // tuner, which would hear it.
        wanted = !wanting.isEmpty && !recorders.isCapturing && !playing
        if !wanted {
            heldOff = false
            yielded = false
        }
        if let a4, a4 != self.a4 {
            self.a4 = a4
            if open { input.setA4(Double(a4)) }
        }
        await enqueue { await self.settle() }.value
    }

    /// Runs `work` after every earlier update's, so a start never overlaps the stop before it.
    @discardableResult private func enqueue(_ work: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let previous = settled
        let next = Task {
            await previous?.value
            await work()
        }
        settled = next
        return next
    }

    /// Starts or stops the input to match the newest update.
    private func settle() async {
        if wanted, !open, !heldOff, !yielded {
            await start()
        } else if !wanted, open {
            open = false
            session += 1
            reading = nil
            status = .idle
            await input.stop()
        }
    }

    private func start() async {
        guard await input.requestPermission() else {
            heldOff = wanted
            status = .denied
            return
        }
        guard wanted else { return }
        session += 1
        let current = session
        open = true
        do {
            try await input.start(
                a4: Double(a4),
                onReading: { [weak self] reading in
                    guard let self, self.session == current else { return }
                    self.reading = reading
                },
                onEnded: { [weak self] in
                    guard let self, self.session == current else { return }
                    self.fail()
                },
                onYield: { [weak self] event in
                    guard let self else { return }
                    switch event {
                    case .yielded:
                        guard session == current else { return }
                        yieldedToPlayback()
                    case .playbackDidNotStart:
                        guard yielded else { return }
                        yielded = false
                        enqueue { await self.settle() }
                    }
                })
            if session == current { status = .listening }
        } catch is TunerStartOvertaken {
            // Playback took the session first: the next update starts again if still wanted.
            if session == current {
                open = false
                status = .idle
            }
        } catch {
            if session == current { fail() }
        }
    }

    /// Playback took the session: the input already let go of it, so only its engine is
    /// stopped, and the tuner waits for the play to start or not before listening again.
    private func yieldedToPlayback() {
        open = false
        yielded = wanted
        session += 1
        reading = nil
        status = .idle
        enqueue { await self.input.stop() }
    }

    private func fail() {
        open = false
        heldOff = wanted
        session += 1
        reading = nil
        status = .unavailable
    }
}
