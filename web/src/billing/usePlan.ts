import { useMemo, useSyncExternalStore } from 'react'
import { useDb } from '../db/DbProvider'
import { createSharedLiveQuery, type Shared, type Snapshot } from '../db/sharedLiveQuery'
import type { CrosstuneDb } from '../db/schema'
import type { LocalEntitlement } from '../db/types'
import { clamp } from '../math'
import { useFixedNow } from '../ui/useNow'
import { liveEntitlement } from './entitlement'
import {
  isPremium,
  livePaidSources,
  nextPlanChange,
  planOf,
  type PaidSource,
  type Plan,
} from './plan'

// setTimeout fires at once for a delay past a signed 32-bit integer.
const MAX_TIMER_MS = 2_147_483_647
// Timers pause while a device sleeps and run late in a background tab, so a slow check backs
// up the precise one.
const RECHECK_MS = 60_000

/** The account's entitlements row: undefined while it loads, null when none is stored. */
export const useEntitlement = createSharedLiveQuery(liveEntitlement)

type Failure = Snapshot<LocalEntitlement | null>['failure']

/** The row, its premium state, and its live paid stores on the device clock. Replaced only when
 * one changes, or the read fails, so a check that finds the same answer renders no plan reader. */
interface Judged {
  row: LocalEntitlement | null | undefined
  premium: boolean
  paid: PaidSource[]
  failure: Failure
}

/** The row and the time it was judged at. Replaced only when the row changes or the clock passes
 * an instant where the plan or a notice changes, so a notice reader renders exactly then. */
export interface PlanCheck {
  row: LocalEntitlement | null | undefined
  now: Date
}

interface PlanClock {
  get: () => Judged
  getCheck: () => PlanCheck & { failure: Failure }
  subscribe: (listener: () => void) => () => void
}

const UNJUDGED: Judged = { row: undefined, premium: false, paid: [], failure: undefined }

/**
 * One clock every plan reader shares: it judges the row again at the next instant the plan or a
 * notice would change, on a slow interval, and when the page becomes visible or focused, so an
 * expiring trial or grant turns free with no sync, even after the device slept. It runs while
 * anything reads it.
 */
function createPlanClock(rows: Shared<LocalEntitlement | null>): PlanClock {
  const listeners = new Set<() => void>()
  let judged = UNJUDGED
  let check: PlanCheck & { failure: Failure } = {
    row: undefined,
    now: new Date(),
    failure: undefined,
  }
  // The next instant `check` is good until; a recheck that finds another has passed one.
  let checkUntil: number | null = null
  let running: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let armedFor: number | null = null

  // A timer clamped to the largest delay, or one that fires early, finds the instant still
  // ahead on its recheck and arms again.
  function arm(next: number | null) {
    if (next === armedFor) return
    clearTimeout(timer)
    armedFor = next
    if (next === null) return
    timer = setTimeout(
      () => {
        armedFor = null
        recheck()
      },
      clamp(next - Date.now(), 0, MAX_TIMER_MS),
    )
  }

  /** Judges the row now, replacing each snapshot only when its answer changed. */
  function judge(): { changed: boolean; next: number | null } {
    const { value: row, failure } = rows.get()
    const now = new Date()
    const premium = row ? isPremium(row, now) : false
    const paid = row ? livePaidSources(row, now) : []
    const next = nextPlanChange(row, now)?.getTime() ?? null
    let changed = false
    if (
      row !== judged.row ||
      premium !== judged.premium ||
      paid.join() !== judged.paid.join() ||
      failure !== judged.failure
    ) {
      judged = { row, premium, paid, failure }
      changed = true
    }
    if (row !== check.row || next !== checkUntil || failure !== check.failure) {
      check = { row, now, failure }
      checkUntil = next
      changed = true
    }
    return { changed, next }
  }

  function recheck() {
    const { changed, next } = judge()
    if (changed) for (const listener of listeners) listener()
    arm(next)
  }

  function start(): () => void {
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck()
    }
    const unsubscribeRows = rows.subscribe(recheck)
    const interval = setInterval(recheck, RECHECK_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', recheck)
    recheck()
    return () => {
      unsubscribeRows()
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', recheck)
      clearTimeout(timer)
      armedFor = null
      judged = UNJUDGED
      check = { row: undefined, now: new Date(), failure: undefined }
      checkUntil = null
    }
  }

  // A reader renders before it subscribes, so until the clock runs each read judges the row the
  // shared query already holds, rather than showing unknown for a commit.
  return {
    get: () => {
      if (!running) judge()
      return judged
    },
    getCheck: () => {
      if (!running) judge()
      return check
    },
    subscribe(listener) {
      listeners.add(listener)
      running ??= start()
      return () => {
        listeners.delete(listener)
        // Deferred, so a commit that swaps one reader for another keeps the clock running.
        queueMicrotask(() => {
          if (listeners.size > 0 || !running) return
          running()
          running = null
        })
      }
    },
  }
}

const clocks = new WeakMap<CrosstuneDb, PlanClock>()

function planClockFor(db: CrosstuneDb): PlanClock {
  let clock = clocks.get(db)
  if (!clock) {
    clock = createPlanClock(useEntitlement.sharedFor(db))
    clocks.set(db, clock)
  }
  return clock
}

const subscribeNothing = () => () => {}
const NO_ROW: Snapshot<LocalEntitlement | null> = { value: undefined }
const noRow = () => NO_ROW

/**
 * Reads a snapshot of the shared clock, or with a fixed now only the row, with no clock running
 * for it. A failed entitlements read is thrown during render, so an error boundary sees it,
 * unless `rethrow` is false, when the read reports it instead.
 */
function useClockRead<T extends { failure: Failure }>(
  read: (clock: PlanClock) => () => T,
  none: () => T,
  rethrow = true,
): {
  live: T
  fixedRow: LocalEntitlement | null | undefined
  fixedMs: number | undefined
  failed: boolean
} {
  const db = useDb()
  const fixedMs = useFixedNow()?.getTime()
  const clock = planClockFor(db)
  const rows = useEntitlement.sharedFor(db)
  const fixed = fixedMs !== undefined
  const live = useSyncExternalStore(
    fixed ? subscribeNothing : clock.subscribe,
    fixed ? none : read(clock),
  )
  const fixedRead = useSyncExternalStore(
    fixed ? rows.subscribe : subscribeNothing,
    fixed ? rows.get : noRow,
  )
  const failure = fixed ? fixedRead.failure : live.failure
  if (failure && rethrow) throw failure.caught
  return { live, fixedRow: fixedRead.value, fixedMs, failed: failure !== undefined }
}

const readJudged = (clock: PlanClock) => clock.get
const readCheck = (clock: PlanClock) => clock.getCheck
const NO_CHECK = { row: undefined, now: new Date(0), failure: undefined }

/**
 * The current plan, from the clock every reader shares, for a reader that shows the plan itself.
 * A failed entitlements read is thrown to the nearest error boundary. A fixed now judges the row
 * at that instant instead. Anything that decides whether to act on the plan reads
 * `usePlanOrUnknown` instead.
 */
export function usePlan(): Plan {
  return usePlanRead(true)
}

/**
 * The current plan, or unknown while the entitlements read fails. Every gating read uses it, as
 * does any reader above every error boundary: unknown gates nothing, the server still enforces,
 * and a failed read never takes down a screen that only consults the plan.
 */
export function usePlanOrUnknown(): Plan {
  return usePlanRead(false)
}

function usePlanRead(rethrow: boolean): Plan {
  const { live, fixedRow, fixedMs, failed } = useClockRead(readJudged, () => UNJUDGED, rethrow)
  const read = fixedMs === undefined ? live.row : fixedRow
  const row = failed ? null : read
  const premium =
    fixedMs === undefined ? live.premium : row ? isPremium(row, new Date(fixedMs)) : false
  const livePaid = live.paid
  // Rebuilt only when the row, its premium state, or its live paid stores change, so a consumer
  // can depend on it.
  return useMemo(() => {
    const paid =
      fixedMs === undefined ? livePaid : row ? livePaidSources(row, new Date(fixedMs)) : []
    return planOf(row, premium, paid)
  }, [row, premium, livePaid, fixedMs])
}

/**
 * The row and the time to judge notices at, renewed whenever the row changes or the shared clock
 * passes an instant where the plan or a notice changes. A fixed now is that time. The row is null
 * while the entitlements read fails, for a reader above every error boundary: no row shows no
 * notice.
 */
export function usePlanCheckOrUnknown(): PlanCheck {
  const { live, fixedRow, fixedMs, failed } = useClockRead(readCheck, () => NO_CHECK, false)
  const read = fixedMs === undefined ? live.row : fixedRow
  const row = failed ? null : read
  const at = fixedMs ?? live.now
  return useMemo(() => ({ row, now: typeof at === 'number' ? new Date(at) : at }), [row, at])
}
