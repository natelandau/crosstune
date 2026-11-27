import { HANDOFF_TAKE_BACK_ATTEMPTS, type UploadHandoff } from '../db/recordings'
import { isRetryableStatus } from './retryableStatus'

/** Where a hand-off stands: the worker may finish it, its slot ran out, or the page takes the
 * file back. */
export type HandoffStatus = 'live' | 'expired' | 'take_back'

/** What a step of the worker's run returned: an HTTP status, no answer at all, or not sent. */
export type StepOutcome = number | 'network_error' | 'skipped'

/** How one run of the worker ended. `retry_confirm` means the bytes landed, so the next run
 * sends only the confirm. */
export type HandoffAttemptResult = 'uploaded' | 'refused' | 'retry' | 'retry_confirm'

/** Decide whether the worker may still send a hand-off. Call it wherever the page and the
 * worker must agree on who owns the file. Imports nothing the service worker cannot load. */
export function handoffStatus(handoff: UploadHandoff, nowMs: number): HandoffStatus {
  if (handoff.expires_at <= nowMs) return 'expired'
  if (handoff.refused || handoff.attempts >= HANDOFF_TAKE_BACK_ATTEMPTS) return 'take_back'
  return 'live'
}

/** Decide how a run ended from what its upload and its confirm returned. */
export function handoffAttemptResult(put: StepOutcome, confirm: StepOutcome): HandoffAttemptResult {
  if (put === 'network_error' || (put !== 'skipped' && !isSuccess(put))) return 'retry'
  if (isSuccess(confirm)) return 'uploaded'
  if (confirm === 'network_error' || (typeof confirm === 'number' && isRetryableStatus(confirm))) {
    return 'retry_confirm'
  }
  return 'refused'
}

const isSuccess = (outcome: StepOutcome) =>
  typeof outcome === 'number' && outcome >= 200 && outcome < 300
