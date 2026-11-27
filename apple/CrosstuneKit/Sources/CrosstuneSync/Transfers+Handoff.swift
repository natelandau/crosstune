import CrosstuneAnalytics
import CrosstuneStore
import Foundation

/// What starting a live hand-off again did.
enum StartAgainOutcome {
    /// A task for the step the hand-off still owes is running.
    case started
    /// The upload has no audio left to send, so the hand-off is taken back.
    case noAudio
    /// The confirm was sent directly, and its answer, other than a refusal, applied to the
    /// hand-off. `failure` is the error behind a confirm that failed, nil when it landed.
    case settled(failure: (any Error)?)
    /// The confirm was sent directly and refused, so the hand-off is taken back.
    case refused
}

/// What settling a handed-off file leaves for the upload pass.
enum HandoffSettlement {
    /// The file asks for a new slot in this pass.
    case asksForSlot
    /// The file waits for a task, its backoff, or a later pass. `failure` is the error behind the
    /// hand-off's last failed attempt, nil when none failed, so the pass reports an upload that
    /// keeps failing.
    case waits(failure: (any Error)?)
}

extension Transfers {
    /// The user whose upload tasks this pass starts and whose finished tasks it handles.
    var userID: String { store.userID }

    /// Settle the hand-off a finished upload task belongs to. Call it for every task the
    /// background session reports, so a confirm answer or a failure reaches the file row. Only a
    /// confirmed upload settles the file here; every other outcome is left on the hand-off for
    /// the upload pass, whose signed-in rules take the file back.
    ///
    /// - Returns: How the attempt ended, or nil when the event no longer matches a hand-off.
    @discardableResult
    func handle(_ event: UploadEvent) async throws -> HandoffAttemptResult? {
        let id = event.tag.recordingID
        let handoff = try await store.read { db in try RecordingFile.fetchOne(db, key: id)?.handoff }
        // A task for a hand-off the pass has since replaced or taken back.
        guard let handoff, handoff.url == event.tag.url else { return nil }
        try checkStopped()

        let put: StepOutcome
        let confirm: StepOutcome
        var failure: (any Error)?
        var queuesConfirm = false
        switch (event.tag.step, event.outcome) {
        case (.put, .status(let status)) where (200..<300).contains(status):
            let landed = try await store.write { writer in
                try writer.updateFile(id, whileHolding: handoff) { $0.handoff?.putLanded = true }
            }
            guard landed else { return nil }
            put = event.outcome
            (confirm, failure) = try await confirmDirectly(id, handoff)
            queuesConfirm = true
        case (.put, let outcome):
            (put, confirm) = (outcome, .skipped)
        case (.confirm, let outcome):
            // A failed background confirm waits out its backoff; queuing another at once would
            // spend the hand-off's tries in seconds.
            (put, confirm) = (.skipped, outcome)
        }
        let result = handoffAttemptResult(put: put, confirm: confirm)
        try await apply(
            result, put: put, confirm: confirm, to: id, holding: handoff, failure: failure,
            queuesConfirm: queuesConfirm)
        return result
    }

    /// Start the step a live hand-off still owes: the confirm when its upload landed, sent
    /// directly while the app runs, and the upload otherwise.
    func startAgain(_ file: RecordingFile, _ handoff: UploadHandoff) async throws -> StartAgainOutcome {
        if handoff.putLanded {
            let (confirm, failure) = try await confirmDirectly(file.id, handoff)
            let result = handoffAttemptResult(put: .skipped, confirm: confirm)
            try await apply(
                result, put: .skipped, confirm: confirm, to: file.id, holding: handoff, failure: failure,
                queuesConfirm: true)
            return result == .refused ? .refused : .settled(failure: failure)
        }
        guard let fileName = file.fileName else { return .noAudio }
        let audio = store.audioFolder.appending(path: fileName)
        guard FileManager.default.fileExists(atPath: audio.path(percentEncoded: false)) else { return .noAudio }
        try checkStopped()
        uploads.startPut(tag(file.id, .put, handoff), file: audio, contentType: handoff.contentType)
        return .started
    }

    /// Send the token confirm for a hand-off whose upload landed, and return its outcome and the
    /// error behind a failed one.
    private func confirmDirectly(
        _ id: String, _ handoff: UploadHandoff
    ) async throws -> (outcome: StepOutcome, failure: (any Error)?) {
        try checkStopped()
        let answer: (outcome: StepOutcome, failure: (any Error)?)
        do {
            try await api.confirmUpload(recordingID: id, token: handoff.confirmToken)
            answer = (.status(204), nil)
        } catch {
            answer = (try confirmOutcome(of: error), error)
        }
        // The stop rule: an answer that arrives after a stop is dropped, never written.
        try checkStopped()
        return answer
    }

    /// Clear a hand-off the background session may no longer finish, and apply the signed-in
    /// rules to what it recorded. A confirm refused for its size fails the file. Any other
    /// refusal, or a hand-off out of tries, waits out the file's own backoff, even when its slot
    /// has also expired. Otherwise, an expired slot or one with no audio left to send costs no try
    /// and asks for a new slot at once.
    ///
    /// - Returns: Whether the file asks for a new slot in this pass, or waits with the error
    ///   behind the hand-off's last failed attempt. It waits with no error when the row no longer
    ///   holds the hand-off, or the take-back settled the file.
    func takeBack(_ file: RecordingFile, _ handoff: UploadHandoff, row: Recording?) async throws
        -> HandoffSettlement
    {
        let id = file.id
        guard handoff.shouldTakeBack else {
            let held = try await store.write { writer in
                try writer.updateFile(id, whileHolding: handoff) { stored in
                    stored.handoff = nil
                    stored.localState = .captured
                }
            }
            return held ? .asksForSlot : .waits(failure: nil)
        }
        if handoff.refusedStatus == 413 {
            // A stored message that only names the status is not repeated as the detail, so the
            // report names the status once.
            let detail = file.error == APIStatusError(status: 413).message ? nil : file.error
            let refusal = APIStatusError(status: 413, detail: detail)
            let held = try await store.write { writer in
                try writer.updateFile(id, whileHolding: handoff) { stored in
                    stored.handoff = nil
                    // The server deleted the file because it did not match the size declared.
                    stored.leaveRetryLoop(.failedUpload, error: refusal.message)
                }
            }
            if held {
                if let row { analytics.send(.uploadFailed(reason: .other, origin: RecordingOrigin(row))) }
                diagnostics.report(refusal, area: .upload)
            }
            return .waits(failure: nil)
        }
        try await store.write { writer in
            let now = Timestamp.now
            try writer.updateFile(id, whileHolding: handoff, at: now) { stored in
                stored.handoff = nil
                stored.scheduleRetry(at: now, error: stored.error)
            }
        }
        return .waits(failure: handoff.lastFailure.map(failureError))
    }

    func tag(_ id: String, _ step: UploadStep, _ handoff: UploadHandoff) -> UploadTaskTag {
        UploadTaskTag(recordingID: id, userID: userID, step: step, url: handoff.url)
    }

    /// Write a finished attempt to the hand-off it belongs to. With `queuesConfirm`, a direct
    /// confirm that failed for a reason worth retrying is queued as a background task, and only
    /// that task's answer counts a try, so one pass spends one. A direct confirm that is not
    /// queued counts its own try.
    private func apply(
        _ result: HandoffAttemptResult, put: StepOutcome, confirm: StepOutcome, to id: String,
        holding handoff: UploadHandoff, failure: (any Error)?, queuesConfirm: Bool
    ) async throws {
        let lastFailure = attemptFailure(put: put, confirm: confirm)
        let message = (failure ?? lastFailure.map(failureError)).map(transferMessage)
        switch result {
        case .uploaded:
            try await store.write { writer in
                try writer.updateFile(id, whileHolding: handoff) { file in
                    file.leaveRetryLoop(.uploaded)
                    file.handoff = nil
                }
            }
        case .refused:
            let status: Int? =
                if case .status(let status) = confirm { status } else { nil }
            try await store.write { writer in
                try writer.updateFile(id, whileHolding: handoff) { file in
                    file.handoff?.refused = true
                    file.handoff?.refusedStatus = status
                    file.handoff?.lastFailure = lastFailure
                    file.error = message
                }
            }
        case .retry, .retryConfirm:
            let fallsBack = queuesConfirm && result == .retryConfirm
            let queued = try await store.write { writer -> Bool in
                let now = Timestamp.now
                var queued = false
                try writer.updateFile(id, whileHolding: handoff, at: now) { file in
                    guard var held = file.handoff else { return }
                    file.nextAttemptAt = nextUploadAttempt(attempts: held.attempts, from: now)
                    // Queued only while the try it would count is not the last one.
                    queued = fallsBack && held.attempts + 1 < UploadHandoff.takeBackAttempts
                    if !queued { held.attempts += 1 }
                    held.lastFailure = lastFailure
                    file.handoff = held
                    file.error = message
                }
                return queued
            }
            guard queued else { return }
            try checkStopped()
            uploads.startConfirm(tag(id, .confirm, handoff), token: handoff.confirmToken)
        }
    }

    /// What the direct confirm returned, as the hand-off rules read it. An error that is neither
    /// an answer nor a lost connection is thrown, leaving the hand-off for the next pass.
    private func confirmOutcome(of error: any Error) throws -> StepOutcome {
        switch underlying(error) {
        case let refusal as APIStatusError: return .status(refusal.status)
        case is URLError: return .networkError
        default: throw error
        }
    }

    /// The failed step of an attempt, nil when neither step failed.
    private func attemptFailure(put: StepOutcome, confirm: StepOutcome) -> UploadHandoff.AttemptFailure? {
        switch (put, confirm) {
        case (.networkError, _), (_, .networkError): .network
        case (.status(let status), _) where !(200..<300).contains(status): .uploadStatus(status)
        case (_, .status(let status)) where !(200..<300).contains(status): .confirmStatus(status)
        default: nil
        }
    }

    /// The error a recorded failure stands for, of the type the transfer loop's classifiers and
    /// the file row's message read.
    func failureError(_ failure: UploadHandoff.AttemptFailure) -> any Error {
        switch failure {
        case .uploadStatus(let status): TransferError(status: status)
        case .confirmStatus(let status): APIStatusError(status: status)
        case .network: URLError(.networkConnectionLost)
        }
    }
}

extension RecordingFile {
    /// Send the file back to captured for a later pass, after a backoff that doubles with each
    /// failure in a row, keeping `error` as the reason it waits.
    mutating func scheduleRetry(at now: Timestamp, error: String?) {
        localState = .captured
        self.error = error
        nextAttemptAt = nextUploadAttempt(attempts: uploadAttempts, from: now)
        uploadAttempts += 1
    }
}
