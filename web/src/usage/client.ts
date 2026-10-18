import type { PostHogConfig } from 'posthog-js'
import { WEB_POSTHOG_CONFIG } from './config'
import type { EventName, EventProps, PersonProperties, Screen } from './events'
import { readSuperPropertyEnv, webSuperProperties } from './superProperties'
import { resolveSharingDefault, setSharingUsage, storedSharingChoice } from './usageSharing'

/**
 * Where the app reports. `send`, `screen`, `identify`, `setPerson`, and `reset` never throw,
 * and the sharing switches never reject, so a caller never guards a report.
 */
export interface AnalyticsClient {
  send<N extends EventName>(name: N, props: EventProps[N]): void
  screen(name: Screen): void
  identify(userId: string, person: PersonProperties, signedUpAt?: string): void
  setPerson(person: PersonProperties): void
  reset(): void
  /** The user ID last identified, or null after a reset. Read it before `identify`, which replaces it. */
  identifiedUser(): string | null
  /**
   * Runs `fn` once `identify` has run for `userId` on this page, at once if it already has. A
   * report made inside `fn` is attributed to that person, which one sent earlier would not be.
   */
  whenIdentified(userId: string, fn: () => void): void
  disableSharing(): Promise<void>
  enableSharing(): Promise<void>
  /** Whether usage is being reported now. False while the regional default is still pending. */
  isSharing(): boolean
  /** Calls `listener` whenever `isSharing` changes. Returns the unsubscribe. */
  subscribeSharing(listener: () => void): () => void
}

export const noopAnalytics: AnalyticsClient = {
  send() {},
  screen() {},
  identify() {},
  setPerson() {},
  reset() {},
  identifiedUser: () => null,
  whenIdentified() {},
  disableSharing: () => Promise.resolve(),
  enableSharing: () => Promise.resolve(),
  isSharing: () => false,
  subscribeSharing: () => () => {},
}

/** The `localStorage` key holding the last identified user ID, which sign-in reads to tell a new user from a returning one. */
export const USER_KEY = 'crosstune.analyticsUser'

function rememberedUser(storage: Storage | undefined): string | null {
  try {
    return (storage ?? localStorage).getItem(USER_KEY)
  } catch {
    return null
  }
}

/** The part of a PostHog instance the client calls. */
export interface PostHogLike {
  init(token: string, config: Partial<PostHogConfig>): unknown
  register(properties: Record<string, unknown>): void
  capture(
    event: string,
    properties?: Record<string, unknown>,
    options?: { send_instantly?: boolean },
  ): unknown
  identify(userId: string, set?: Record<string, unknown>, setOnce?: Record<string, unknown>): void
  setPersonProperties(set: Record<string, unknown>): void
  reset(): void
  opt_in_capturing(options?: { captureEventName?: false }): void
  opt_out_capturing(): void
}

export interface AnalyticsOptions {
  key?: string
  storage?: Storage
  load?: () => Promise<PostHogLike>
  /** Asks the API which privacy rules apply. Absent, the default stays off until the person turns sharing on. */
  fetchRegion?: () => Promise<{ consent_required: boolean | null }>
}

// Analytics is never worth competing with the page's own work.
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 3000 })
    } else {
      setTimeout(resolve, 1)
    }
  })
}

async function loadPostHog(): Promise<PostHogLike> {
  await whenIdle()
  const { default: posthog } = await import('posthog-js/dist/module.no-external')
  // `init`'s config type is the SDK's own; every other method is checked against PostHogLike.
  const checked: Omit<PostHogLike, 'init'> = posthog
  return checked as PostHogLike
}

function safely(fn: () => void): void {
  try {
    fn()
  } catch {
    // Analytics is optional; an SDK failure must not surface to the person using the app.
  }
}

function rememberUser(storage: Storage | undefined, userId: string | null): void {
  safely(() => {
    const store = storage ?? localStorage
    if (userId === null) store.removeItem(USER_KEY)
    else store.setItem(USER_KEY, userId)
  })
}

interface RememberedIdentity {
  userId: string
  person: PersonProperties
  signedUpAt?: string
}

/**
 * The web's analytics client. Without a key it is `noopAnalytics`. It loads the SDK only once
 * sharing is on: a stored choice, else the region's default, else the person turning it on.
 */
export function startAnalytics({
  key,
  storage,
  load = loadPostHog,
  fetchRegion = () => Promise.resolve({ consent_required: null }),
}: AnalyticsOptions): AnalyticsClient {
  if (!key) return noopAnalytics

  // 'pending' until a stored choice, the regional default, or the person decides.
  const stored = storedSharingChoice(storage)
  let state: 'pending' | 'on' | 'off' = stored === null ? 'pending' : stored ? 'on' : 'off'
  // Work made while the default is pending waits here, in memory only, and goes out only if
  // the default turns sharing on.
  const BUFFER_LIMIT = 100
  let buffered: ((ph: PostHogLike) => void)[] = []
  const listeners = new Set<() => void>()
  const setState = (next: 'on' | 'off') => {
    if (state === next) return
    state = next
    for (const listener of [...listeners]) safely(listener)
  }
  let loading: Promise<PostHogLike | null> | null = null
  let identity: RememberedIdentity | null = null
  let waiting: { userId: string; fn: () => void }[] = []

  const registerSuper = (ph: PostHogLike) => ph.register(webSuperProperties(readSuperPropertyEnv()))

  // One load for the page; a failed load resolves to null and the client stays silent.
  const ensure = (): Promise<PostHogLike | null> => {
    loading ??= (async () => {
      try {
        const ph = await load()
        ph.init(key, WEB_POSTHOG_CONFIG)
        safely(() => registerSuper(ph))
        return ph
      } catch {
        return null
      }
    })()
    return loading
  }

  // Calls queue on the one load promise, so they reach the SDK in the order they were made.
  const whenSharing = (fn: (ph: PostHogLike) => void): void => {
    if (state === 'pending') {
      buffered.push(fn)
      if (buffered.length > BUFFER_LIMIT) buffered.shift()
      return
    }
    if (state === 'off') return
    void ensure().then((ph) => {
      if (ph) safely(() => fn(ph))
    })
  }

  const applyIdentity = (ph: PostHogLike) => {
    if (!identity) return
    const { userId, person, signedUpAt } = identity
    ph.identify(
      userId,
      { ...person },
      signedUpAt === undefined ? undefined : { signed_up_at: signedUpAt },
    )
  }

  if (state === 'on') void ensure()
  else if (state === 'pending') {
    void resolveSharingDefault(fetchRegion, storage).then((on) => {
      // The person already chose while the request was in flight.
      if (state !== 'pending') return
      const work = buffered
      buffered = []
      setState(on ? 'on' : 'off')
      if (!on) return
      void ensure().then((ph) => {
        if (!ph) return
        for (const fn of work) {
          if (state !== 'on') return
          safely(() => fn(ph))
        }
      })
    })
  }

  return {
    send(name, props) {
      const properties: Record<string, unknown> = { ...props }
      if (name === 'setting_changed') {
        const change = props as EventProps['setting_changed']
        properties.$set = { [`setting_${change.setting}`]: change.value }
      }
      whenSharing((ph) => ph.capture(name, properties))
    },
    screen(name) {
      whenSharing((ph) => ph.capture('$screen', { $screen_name: name, screen: name }))
    },
    identify(userId, person, signedUpAt) {
      identity = { userId, person, ...(signedUpAt === undefined ? {} : { signedUpAt }) }
      rememberUser(storage, userId)
      whenSharing(applyIdentity)
      // Reports queue behind the identify above, so they reach the SDK after it. A waiter for
      // another user is stale once someone else is identified.
      const ready = waiting.filter((waiter) => waiter.userId === userId)
      waiting = []
      for (const { fn } of ready) safely(fn)
    },
    whenIdentified(userId, fn) {
      if (identity?.userId === userId) safely(fn)
      else waiting.push({ userId, fn })
    },
    setPerson(person) {
      whenSharing((ph) => ph.setPersonProperties({ ...person }))
    },
    identifiedUser: () => rememberedUser(storage),
    reset() {
      identity = null
      // Work buffered for the signed-out person must never flush under whoever comes next.
      buffered = []
      rememberUser(storage, null)
      // With sharing off and nothing loaded there is no stored identity to clear.
      if (state !== 'on' && !loading) return
      void ensure().then((ph) => {
        if (!ph) return
        safely(() => ph.reset())
        safely(() => registerSuper(ph))
        // `reset` clears the SDK's stored consent, which would silently opt the person back in.
        if (state !== 'on') safely(() => ph.opt_out_capturing())
      })
    },
    async disableSharing() {
      const wasSharing = state === 'on'
      buffered = []
      setState('off')
      setSharingUsage(false, storage)
      if (!wasSharing) return
      const ph = await ensure()
      if (ph) {
        safely(() => ph.capture('usage_sharing_disabled', {}, { send_instantly: true }))
        safely(() => ph.opt_out_capturing())
      }
    },
    async enableSharing() {
      const wasSharing = state === 'on'
      buffered = []
      setSharingUsage(true, storage)
      setState('on')
      const ph = await ensure()
      if (!ph || wasSharing) return
      safely(() => ph.opt_in_capturing({ captureEventName: false }))
      safely(() => applyIdentity(ph))
    },
    isSharing: () => state === 'on',
    subscribeSharing(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}
