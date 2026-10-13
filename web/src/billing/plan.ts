import type { Notice } from '../api/types'
import type { LocalEntitlement } from '../db/types'
import { clamp } from '../math'

/** How long past its reported expiry an auto-renewing grant still counts, for a device that
 * has not synced the renewal. */
export const OFFLINE_LEEWAY_MS = 604_800_000
/** How long before a trial ends the reminder shows. */
export const TRIAL_REMINDER_MS = 259_200_000

export type PlanKind = 'unknown' | 'premium' | 'free'
type PlanSource = 'trial' | 'apple' | 'stripe' | 'comp'
export type PaidSource = 'apple' | 'stripe'

export interface Plan {
  kind: PlanKind
  /** The grant that makes the plan premium; null when the plan is free or unknown. */
  source: PlanSource | null
  /** The expiry the row reports for its grant, before the leeway; null for no grant or one that never expires. It is kept after the grant lapses. */
  premiumEndsAt: Date | null
  trialStartsAt: Date | null
  trialEndsAt: Date | null
  /** The premium or free quota; null while the plan is unknown. */
  quotaBytes: number | null
  /** Free: the quota counts scans only. */
  scansOnly: boolean
  /** Whether the live premium grant renews on its own; false unless premium. */
  autoRenews: boolean
  /** Every store still billing the account, the reported grant's included; empty unless
   * premium. A comp that outlasts a subscription is reported over it. */
  paidSources: PaidSource[]
}

const SOURCES: readonly string[] = ['trial', 'apple', 'stripe', 'comp']
const PAID_SOURCES: readonly PaidSource[] = ['apple', 'stripe']

function dateOf(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

/** The instant a grant stops counting, or null when it never expires. */
function endOf(expiresAt: string | null, autoRenews: boolean): number | null {
  if (expiresAt === null) return null
  return Date.parse(expiresAt) + (autoRenews ? OFFLINE_LEEWAY_MS : 0)
}

function grantEnd(row: LocalEntitlement): number | null {
  return endOf(row.premium_expires_at, row.auto_renews)
}

/** The row's paid grants, none for a row pulled from a server older than the field. */
function paidGrants(row: LocalEntitlement): LocalEntitlement['paid_grants'] {
  return row.paid_grants ?? []
}

/** The stores still billing the account at `now`, each judged as the reported grant is. */
export function livePaidSources(row: LocalEntitlement, now: Date): PaidSource[] {
  if (!isPremium(row, now)) return []
  const live = paidGrants(row)
    .filter((grant) => {
      const end = endOf(grant.expires_at, grant.auto_renews)
      return end === null || end > now.getTime()
    })
    .map((grant) => grant.source)
  return PAID_SOURCES.filter((paid) => paid === row.premium_source || live.includes(paid))
}

export function isPremium(row: LocalEntitlement, now: Date): boolean {
  if (row.premium_source === null) return false
  const end = grantEnd(row)
  return end === null || end > now.getTime()
}

/**
 * The plan a stored entitlements row gives at `now`. Expiry is judged by the device clock, so a
 * device that is offline or has not synced still turns free on time. No row means unknown, which
 * gates nothing: the server enforces, and a device that has not pulled must not flash disabled
 * rows.
 */
export function planFrom(row: LocalEntitlement | null | undefined, now: Date): Plan {
  return planOf(row, row ? isPremium(row, now) : false, row ? livePaidSources(row, now) : [])
}

/** The plan for a row once its premium state and live paid stores are known, so a hook can
 * rebuild it only when the row or either changes. */
export function planOf(
  row: LocalEntitlement | null | undefined,
  premium: boolean,
  paidSources: PaidSource[],
): Plan {
  if (!row) {
    return {
      kind: 'unknown',
      source: null,
      premiumEndsAt: null,
      trialStartsAt: null,
      trialEndsAt: null,
      quotaBytes: null,
      scansOnly: false,
      autoRenews: false,
      paidSources: [],
    }
  }
  const source = row.premium_source
  return {
    kind: premium ? 'premium' : 'free',
    source: premium && source !== null && SOURCES.includes(source) ? (source as PlanSource) : null,
    premiumEndsAt: source === null ? null : dateOf(row.premium_expires_at),
    trialStartsAt: dateOf(row.trial_starts_at),
    trialEndsAt: dateOf(row.trial_ends_at),
    quotaBytes: premium ? row.premium_quota_bytes : row.free_quota_bytes,
    scansOnly: !premium,
    autoRenews: premium && row.auto_renews,
    paidSources: premium ? paidSources : [],
  }
}

/** Only an account with no paid grant can buy one: free, or a trial. */
export function canSubscribe(plan: Plan): boolean {
  return plan.kind === 'free' || (plan.kind === 'premium' && plan.source === 'trial')
}

/** Whether the Plan sheet sells to the plan or confirms it. */
export type PlanMode = 'selling' | 'member'

/** A paid or comped plan is confirmed; every other plan, unknown and trial included, is sold to. */
export function planMode(plan: Plan): PlanMode {
  return plan.kind === 'premium' && plan.source !== 'trial' ? 'member' : 'selling'
}

/** How much of a trial has passed, from 0 at its start to 1 at its end and after. The server
 * sets the trial's length and can move its end, so both instants come from the row; without
 * them, or with an end not after the start, nothing has passed. */
export function trialProgress(startsAt: Date | null, endsAt: Date | null, now: Date): number {
  if (startsAt === null || endsAt === null) return 0
  const length = endsAt.getTime() - startsAt.getTime()
  if (length <= 0) return 0
  return clamp((now.getTime() - startsAt.getTime()) / length, 0, 1)
}

export function recordingsPlayable(plan: Plan): boolean {
  return plan.kind !== 'free'
}

/** The tune of the earliest live scan by creation time, then id: the one tune a free account's
 * scans open for. Null while there is no live scan. The scans in `excluded` are left out, as for
 * one the server refused and so never counts. */
export function scanTuneId(
  scans: readonly { tune_id: string; created_at: string; id: string; deleted_at: string | null }[],
  excluded: ReadonlySet<string> = new Set(),
): string | null {
  let first: (typeof scans)[number] | null = null
  for (const scan of scans) {
    if (scan.deleted_at !== null || excluded.has(scan.id)) continue
    if (first === null) {
      first = scan
      continue
    }
    const order = Date.parse(scan.created_at) - Date.parse(first.created_at)
    if (order < 0 || (order === 0 && scan.id < first.id)) first = scan
  }
  return first?.tune_id ?? null
}

export function scanOpens(plan: Plan, tuneId: string, scanTune: string | null): boolean {
  return plan.kind !== 'free' || scanTune === null || tuneId === scanTune
}

export type NoticeKind = Notice

/** The one notice to show now, in precedence order. Only a trial or a lapsed trial sees any.
 * The server never rewrites the row when a trial lapses, so a lapsed trial keeps its source. */
export function dueNotice(
  row: LocalEntitlement | null | undefined,
  now: Date,
  holdsRecordings: boolean,
): NoticeKind | null {
  if (!row) return null
  const plan = planFrom(row, now)
  const trialEnd = row.trial_ends_at === null ? null : Date.parse(row.trial_ends_at)
  const time = now.getTime()
  if (
    plan.kind === 'free' &&
    trialEnd !== null &&
    trialEnd <= time &&
    row.trial_end_seen_at === null &&
    (row.premium_source === null || row.premium_source === 'trial')
  ) {
    return 'trial_ended'
  }
  if (row.premium_source !== 'trial' || plan.kind !== 'premium') return null
  if (
    trialEnd !== null &&
    time < trialEnd &&
    time >= trialEnd - TRIAL_REMINDER_MS &&
    row.trial_reminder_seen_at === null
  ) {
    return 'trial_reminder'
  }
  if (holdsRecordings && row.recording_notice_seen_at === null) return 'first_recording'
  return null
}

/**
 * The next instant `planFrom` or `dueNotice` would answer differently for this row, or null
 * when none is ahead, so a hook can schedule one timer instead of polling.
 */
export function nextPlanChange(row: LocalEntitlement | null | undefined, now: Date): Date | null {
  if (!row) return null
  const candidates: number[] = []
  if (row.premium_source !== null) {
    const end = grantEnd(row)
    if (end !== null) candidates.push(end)
    for (const grant of paidGrants(row)) {
      const paidEnd = endOf(grant.expires_at, grant.auto_renews)
      if (paidEnd !== null) candidates.push(paidEnd)
    }
  }
  // Only a trial, or no grant, has trial instants; dueNotice never shows a comp or purchase any.
  if (
    row.trial_ends_at !== null &&
    (row.premium_source === null || row.premium_source === 'trial')
  ) {
    const trialEnd = Date.parse(row.trial_ends_at)
    candidates.push(trialEnd, trialEnd - TRIAL_REMINDER_MS)
  }
  const ahead = candidates.filter((instant) => instant > now.getTime())
  return ahead.length === 0 ? null : new Date(Math.min(...ahead))
}
