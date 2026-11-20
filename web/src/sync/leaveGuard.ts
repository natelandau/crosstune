import { liveQuery } from 'dexie'
import type { CrosstuneDb } from '../db/schema'
import { clamp, MAX_TIMER_MS } from '../math'
import { isLiveHandoff, pageWouldUpload, readUploadQueue } from './transfers'

interface Evaluation {
  waiting: boolean
  /** When the earliest live hand-off expires, which can make the page upload it; null if none. */
  wakeAt: number | null
}

async function evaluate(db: CrosstuneDb, isOnline: () => boolean): Promise<Evaluation> {
  if (!isOnline()) return { waiting: false, wakeAt: null }
  const queue = await readUploadQueue(db, ['captured', 'uploading'])
  if (!queue) return { waiting: false, wakeAt: null }
  const nowMs = Date.now()
  let waiting = false
  let wakeAt: number | null = null
  for (const [i, file] of queue.files.entries()) {
    // A live hand-off belongs to the worker, which finishes it with the tab closed.
    if (isLiveHandoff(file, nowMs)) wakeAt = Math.min(wakeAt ?? Infinity, file.handoff.expires_at)
    else if (pageWouldUpload(queue.rows[i], file, queue.storage, nowMs)) waiting = true
  }
  return { waiting, wakeAt }
}

/** Whether the page holds a recording it would upload now and no worker covers. */
export async function pageUploadWaiting(
  db: CrosstuneDb,
  isOnline: () => boolean,
): Promise<boolean> {
  return (await evaluate(db, isOnline)).waiting
}

/** Ask before the tab closes while pageUploadWaiting is true. Returns the stop function. */
export function startLeaveGuard(
  db: CrosstuneDb,
  {
    target = window,
    isOnline = () => navigator.onLine,
  }: { target?: Window; isOnline?: () => boolean } = {},
): () => void {
  let attached = false
  let stopped = false
  let ticket = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault()
    // Legacy browsers only prompt when returnValue is set; empty keeps the browser's own text.
    event.returnValue = ''
  }
  // Each evaluation takes a ticket when it starts; only the latest started may set the state,
  // so a slow older answer never overwrites a newer one.
  const run = async () => ({ ticket: ++ticket, result: await evaluate(db, isOnline) })
  const apply = ({ ticket: mine, result }: { ticket: number; result: Evaluation }) => {
    if (stopped || mine !== ticket) return
    if (result.waiting !== attached) {
      attached = result.waiting
      // A listener only while it matters keeps the page eligible for the back/forward cache.
      if (attached) target.addEventListener('beforeunload', onBeforeUnload)
      else target.removeEventListener('beforeunload', onBeforeUnload)
    }
    // Expiry is a point in time, not a database change, so nothing else would re-evaluate.
    if (timer) clearTimeout(timer)
    timer = null
    if (result.wakeAt !== null) {
      timer = setTimeout(refresh, clamp(result.wakeAt - Date.now() + 1, 1, MAX_TIMER_MS))
    }
  }
  function refresh() {
    run().then(apply, (error) => {
      console.warn('leave guard: queue check failed', error)
    })
  }

  const subscription = liveQuery(run).subscribe({
    next: apply,
    error(error) {
      console.warn('leave guard: queue watch failed', error)
    },
  })
  // Connectivity is not in the database, so the query does not rerun when it changes.
  target.addEventListener('online', refresh)
  target.addEventListener('offline', refresh)

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    subscription.unsubscribe()
    target.removeEventListener('online', refresh)
    target.removeEventListener('offline', refresh)
    target.removeEventListener('beforeunload', onBeforeUnload)
  }
}
