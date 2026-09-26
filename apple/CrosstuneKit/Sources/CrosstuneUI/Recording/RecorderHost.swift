import CrosstuneAudio
import CrosstuneStore
import Observation

/// Holds the one ``Recorder`` the app records with, shared by every window, and which window's
/// record sheet has it. There is one microphone, so a second window's Record does nothing
/// while a sheet is up.
@MainActor
@Observable
public final class RecorderHost {
    private var held: (store: ObjectIdentifier, recorder: Recorder)?
    /// True while a record sheet is up in some window.
    public private(set) var isClaimed = false
    private let makeInput: @MainActor () -> (any AudioInput)?

    /// - Parameter makeInput: The microphone each new recorder uses; nil is the device's.
    public init(makeInput: @escaping @MainActor () -> (any AudioInput)? = { nil }) {
        self.makeInput = makeInput
    }

    /// The recorder for `store`. A different store, as after signing in as someone else, gets a
    /// recorder of its own.
    public func recorder(for store: CrosstuneStore) -> Recorder {
        if let held, held.store == ObjectIdentifier(store) { return held.recorder }
        let recorder = Recorder(store: store, input: makeInput())
        held = (ObjectIdentifier(store), recorder)
        return recorder
    }

    /// True when a record sheet over `store` could take the recorder now: no other sheet has
    /// it, and no take a closed sheet left behind is still being saved.
    public func isFree(for store: CrosstuneStore) -> Bool {
        let recorder = recorder(for: store)
        return !isClaimed && recorder.state == .idle && !recorder.isStarting
    }

    /// Takes the recorder for a record sheet over `store`. Nil when it is not free.
    public func claim(for store: CrosstuneStore) -> Recorder? {
        guard isFree(for: store) else { return nil }
        isClaimed = true
        return recorder(for: store)
    }

    /// True while a record sheet is up in some window, or a take is starting, recording, or
    /// being saved. Nothing plays meanwhile.
    public var isCapturing: Bool {
        isClaimed || held.map { $0.recorder.state != .idle || $0.recorder.isStarting } == true
    }

    /// Gives the recorder back once the sheet has gone.
    public func release() {
        isClaimed = false
    }
}
