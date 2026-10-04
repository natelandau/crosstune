import type { ScanViewContext } from '../../api/vocabulary'

/** Time on screen a look at a tune's scans needs to count. A glance at how a tune starts is short. */
export const SCAN_VIEW_THRESHOLD_MS = 3_000

/** Where the viewer was opened from. */
export interface ScanViewOrigin {
  context: ScanViewContext
  listId?: string
}

/** One view, timed on the injected clock. */
export interface ScanViewRecord {
  tuneId: string
  context: ScanViewContext
  listId: string | null
  startedAt: number
  viewedMs: number
}

interface OpenViewer {
  tuneId: string
  origin: ScanViewOrigin
  /** When the view under way started, or null while the page is out of the foreground. */
  since: number | null
}

/**
 * Times the open scan viewer while the page is in the foreground. Leaving the foreground ends
 * the view and coming back starts a new one, so a viewer left open overnight is two short views,
 * not one long one. A view is written when it ends having met the threshold.
 */
export class ScanViewLog {
  #open: OpenViewer | null = null

  constructor(
    private readonly now: () => number,
    private readonly write: (record: ScanViewRecord) => void,
  ) {}

  /** Ends any open viewer, then starts a view of `tuneId`'s scans. */
  start(tuneId: string, origin: ScanViewOrigin): void {
    this.end()
    this.#open = { tuneId, origin, since: this.now() }
  }

  /** The page entered or left the foreground. */
  visible(isVisible: boolean): void {
    const open = this.#open
    if (!open) return
    if (isVisible) {
      open.since ??= this.now()
      return
    }
    this.#finish(open)
    open.since = null
  }

  /** Writes the view under way if it met the threshold, and closes the viewer. */
  end(): void {
    const open = this.#open
    if (!open) return
    this.#open = null
    this.#finish(open)
  }

  #finish(open: OpenViewer): void {
    if (open.since === null) return
    const viewedMs = this.now() - open.since
    if (viewedMs < SCAN_VIEW_THRESHOLD_MS) return
    this.write({
      tuneId: open.tuneId,
      context: open.origin.context,
      listId: open.origin.listId ?? null,
      startedAt: open.since,
      viewedMs,
    })
  }
}
