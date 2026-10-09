import type { PostHogConfig } from 'posthog-js'
import { WEB_POSTHOG_CONFIG } from './config'
import type { EventName, EventProps, PersonProperties, Screen } from './events'
import { readSuperPropertyEnv, webSuperProperties } from './superProperties'
import { isSharingUsage, setSharingUsage } from './usageSharing'

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
  disableSharing(): Promise<void>
  enableSharing(): Promise<void>
}

export const noopAnalytics: AnalyticsClient = {
  send() {},
  screen() {},
  identify() {},
  setPerson() {},
  reset() {},
  identifiedUser: () => null,
  disableSharing: () => Promise.resolve(),
  enableSharing: () => Promise.resolve(),
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
  // The recorder is a separate script that registers itself on load, so replay only works when
  // it is imported beside the core.
  const [{ default: posthog }] = await Promise.all([
    import('posthog-js/dist/module.no-external'),
    import('posthog-js/dist/posthog-recorder'),
  ])
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
 * The web's analytics client. Without a key it is `noopAnalytics`. With sharing off it never
 * loads the SDK, and loads it only when the person turns sharing back on.
 */
export function startAnalytics({
  key,
  storage,
  load = loadPostHog,
}: AnalyticsOptions): AnalyticsClient {
  if (!key) return noopAnalytics

  let sharing = isSharingUsage(storage)
  let loading: Promise<PostHogLike | null> | null = null
  let identity: RememberedIdentity | null = null

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
    if (!sharing) return
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

  if (sharing) void ensure()

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
    },
    setPerson(person) {
      whenSharing((ph) => ph.setPersonProperties({ ...person }))
    },
    identifiedUser: () => rememberedUser(storage),
    reset() {
      identity = null
      rememberUser(storage, null)
      // With sharing off and nothing loaded there is no stored identity to clear.
      if (!sharing && !loading) return
      void ensure().then((ph) => {
        if (!ph) return
        safely(() => ph.reset())
        safely(() => registerSuper(ph))
        // `reset` clears the SDK's stored consent, which would silently opt the person back in.
        if (!sharing) safely(() => ph.opt_out_capturing())
      })
    },
    async disableSharing() {
      if (!sharing) return
      sharing = false
      const ph = await ensure()
      if (ph) {
        safely(() => ph.capture('usage_sharing_disabled', {}, { send_instantly: true }))
        safely(() => ph.opt_out_capturing())
      }
      setSharingUsage(false, storage)
    },
    async enableSharing() {
      const wasSharing = sharing
      sharing = true
      setSharingUsage(true, storage)
      const ph = await ensure()
      if (!ph || wasSharing) return
      safely(() => ph.opt_in_capturing({ captureEventName: false }))
      safely(() => applyIdentity(ph))
    },
  }
}
