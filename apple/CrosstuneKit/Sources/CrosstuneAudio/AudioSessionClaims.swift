import Synchronization

/// One user of the app's audio session, such as the recorder, the player, or the tuner.
struct AudioSessionOwner: Equatable, Sendable {
    private static let next = Atomic<UInt64>(0)
    private let id: UInt64

    init() {
        id = Self.next.add(1, ordering: .relaxed).newValue
    }
}

/// A tuner's session setup that playback overtook: it was asked for before a yield to playback
/// and would have run after it.
struct YieldedToPlayback: Error {}

/// Tracks which owner set up the app's one audio session last, so an owner done with it never
/// deactivates it under another that set it up since. Each owner works on its own queue.
final class AudioSessionClaims: Sendable {
    static let shared = AudioSessionClaims()

    private struct State {
        var holder: AudioSessionOwner?
        var yields: UInt64 = 0
    }

    private let state = Mutex(State())

    /// How many times the session went to playback or another owner's claim, read as a tuner
    /// asks for its setup.
    var yields: UInt64 { state.withLock { $0.yields } }

    /// Call before `owner` sets up and activates the session. Counts as a yield, so a tuner
    /// setup asked for before it never lands over the recorder's or the player's session.
    func claim(_ owner: AudioSessionOwner) {
        state.withLock {
            $0.holder = owner
            $0.yields += 1
        }
    }

    /// Marks a yield to playback, so a tuner setup asked for before it never runs after it.
    /// Waits out a setup under way, so the player's claim always lands after it.
    func yieldToPlayback() {
        state.withLock { $0.yields += 1 }
    }

    /// Claims the session for `owner` and runs `activate` under the lock, unless playback was
    /// yielded to since `yields` was read: then it throws ``YieldedToPlayback`` and neither
    /// claims nor touches the session.
    func claim(_ owner: AudioSessionOwner, unlessYieldedSince yields: UInt64, _ activate: () throws -> Void)
        throws
    {
        try state.withLock { state in
            guard state.yields == yields else { throw YieldedToPlayback() }
            state.holder = owner
            try activate()
        }
    }

    /// Runs `deactivate` only when no other owner claimed the session since `owner` did, and,
    /// given the `yields` read at the claim, playback was not yielded to since: a play that sets
    /// no session of its own, such as MusicKit's, may already be starting on it. It runs under
    /// the lock, so a claim cannot land between the check and the deactivation, and a claim made
    /// meanwhile waits until that deactivation finishes.
    func release(_ owner: AudioSessionOwner, unlessYieldedSince yields: UInt64? = nil, _ deactivate: () -> Void) {
        state.withLock { state in
            guard state.holder == owner else { return }
            state.holder = nil
            if let yields, state.yields != yields { return }
            deactivate()
        }
    }
}
