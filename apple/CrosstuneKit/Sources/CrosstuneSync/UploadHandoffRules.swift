import CrosstuneStore

/// Where a hand-off stands: the worker may finish it, its slot ran out, or the app takes the
/// file back.
public enum HandoffStatus: String, Sendable {
    case live
    case expired
    case takeBack = "take_back"
}

/// What one step of the worker's run returned: an HTTP status, no answer at all, or not sent.
public enum StepOutcome: Hashable, Sendable {
    case status(Int)
    case networkError
    case skipped
}

/// How one run of the worker ended. `retryConfirm` means the bytes landed, so the next run
/// sends only the confirm.
public enum HandoffAttemptResult: String, Sendable {
    case uploaded
    case refused
    case retry
    case retryConfirm = "retry_confirm"
}

/// Decide whether the worker may still send a hand-off. Call it wherever the app and the worker
/// must agree on who owns the file.
public func handoffStatus(_ handoff: UploadHandoff, now: Timestamp) -> HandoffStatus {
    if handoff.expiresAt <= now { return .expired }
    if handoff.shouldTakeBack { return .takeBack }
    return .live
}

/// Decide how a run ended from what its upload and its confirm returned.
public func handoffAttemptResult(put: StepOutcome, confirm: StepOutcome) -> HandoffAttemptResult {
    switch put {
    case .networkError: return .retry
    case .status(let status) where !(200..<300).contains(status): return .retry
    default: break
    }
    switch confirm {
    case .status(let status) where (200..<300).contains(status): return .uploaded
    case .networkError: return .retryConfirm
    case .status(let status) where isRetryableStatus(status): return .retryConfirm
    default: return .refused
    }
}
