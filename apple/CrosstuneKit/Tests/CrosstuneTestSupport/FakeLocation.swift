import CrosstuneRecording
import CrosstuneStore
import Foundation

/// A device position that answers at once, or waits for ``answer()`` while ``holds`` is set.
@MainActor
public final class FakeLocation: LocationProvider {
    public var fix: Coordinate?
    public var holds = false
    /// Answers a cancelled request with nothing at once, as the device's provider does. Off, a
    /// cancelled request still waits for ``answer()``, so a test can land a fix after it.
    public var answersCancelledAtOnce = false
    public private(set) var requests = 0
    private var pending: [(key: Int, continuation: CheckedContinuation<Coordinate?, Never>)] = []
    private var nextKey = 0

    public init(_ fix: Coordinate? = nil) {
        self.fix = fix
    }

    public func currentLocation() async -> Coordinate? {
        requests += 1
        guard holds else { return fix }
        let key = nextKey
        nextKey += 1
        return await withTaskCancellationHandler {
            await withCheckedContinuation { pending.append((key, $0)) }
        } onCancel: {
            Task { @MainActor [weak self] in self?.cancelled(key) }
        }
    }

    private func cancelled(_ key: Int) {
        guard answersCancelledAtOnce, let index = pending.firstIndex(where: { $0.key == key }) else { return }
        pending.remove(at: index).continuation.resume(returning: nil)
    }

    /// Waits until `count` requests are held.
    public func hasText(count: Int = 1) async {
        while pending.count < count { await Task.yield() }
    }

    /// Answers every held request with ``fix``, as one fix answers every caller.
    public func answer() async {
        await hasText()
        let answered = pending
        pending = []
        for request in answered { request.continuation.resume(returning: fix) }
    }
}
