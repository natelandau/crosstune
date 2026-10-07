import { startAnalytics, trackWaitlistJoined } from './analytics'

export const JOINED = "You're on the list. We'll email you when your account is ready."
export const UNREACHABLE =
  "The waitlist can't be reached right now. Try again, or email support@crosstune.app."
export const PENDING = 'Joining…'
export const THANKS_PATH = '/waitlist/thanks'
// Set on join and cleared by the thanks page, so the page shows once per join. It holds the
// join's acquisition, which the thanks page moves to JOIN_EVENT_KEY until analytics sends it.
export const JOINED_KEY = 'crosstune:waitlist-joined'
export const JOIN_EVENT_KEY = 'crosstune:waitlist-join-event'

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
const ACQUISITION_KEYS = ['$referrer', '$referring_domain', ...UTM_KEYS]

export interface WaitlistClient {
  join(params: { emailAddress: string }): Promise<unknown>
}

const STATUS_ID = 'waitlist-status'

// Clerk rejects with `errors[0].longMessage`, written for the person who typed the email.
function messageFor(error: unknown): string {
  const first = (error as { errors?: { longMessage?: string; message?: string }[] } | null)
    ?.errors?.[0]
  return first?.longMessage ?? first?.message ?? UNREACHABLE
}

// Analytics keeps nothing between pages, so the thanks page would otherwise credit the join to
// this page. The values match what PostHog reads from the page itself.
function acquisition(): Record<string, string> {
  const referrer = document.referrer
  let domain = '$direct'
  try {
    if (referrer) domain = new URL(referrer).hostname
  } catch {
    domain = referrer
  }
  const found: Record<string, string> = {
    $referrer: referrer || '$direct',
    $referring_domain: domain,
  }
  const params = new URLSearchParams(location.search)
  for (const key of UTM_KEYS) {
    const value = params.get(key)
    if (value) found[key] = value
  }
  return found
}

// Storage can be blocked; without the flag the thanks page would bounce the visitor home.
function rememberJoin(): boolean {
  try {
    sessionStorage.setItem(JOINED_KEY, JSON.stringify(acquisition()))
    return true
  } catch {
    return false
  }
}

// Only acquisition keys leave the marker, so nothing else stored there reaches analytics.
function readAcquisition(stored: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  const found: Record<string, string> = {}
  for (const key of ACQUISITION_KEYS) {
    const value = (parsed as Record<string, unknown>)[key]
    if (typeof value === 'string') found[key] = value
  }
  return found
}

// Sends the join the thanks page was opened for. The form page cannot: it unloads on the
// navigation, often before analytics has loaded.
export async function reportJoin(token: string | undefined): Promise<void> {
  let stored: string | null
  try {
    stored = sessionStorage.getItem(JOIN_EVENT_KEY)
  } catch {
    return
  }
  if (stored === null) return
  try {
    await startAnalytics(token)
    await trackWaitlistJoined(readAcquisition(stored))
  } finally {
    try {
      sessionStorage.removeItem(JOIN_EVENT_KEY)
    } catch {
      // Storage that was readable a moment ago failing now leaves nothing more to do.
    }
  }
}

export function mountWaitlist(
  form: HTMLFormElement,
  load: () => Promise<WaitlistClient>,
  navigate: (path: string) => void = (path) => location.assign(path),
): void {
  const input = form.querySelector<HTMLInputElement>('input[type="email"]')!
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
  const status = form.querySelector<HTMLElement>('[data-waitlist-status]')!
  const label = button.textContent
  status.id ||= STATUS_ID

  let client: Promise<WaitlistClient> | null = null
  let attempted = false
  // A failed load is dropped so the next attempt can try again.
  const ensureClient = () => {
    attempted = true
    client ??= load().catch((error: unknown) => {
      client = null
      throw error
    })
    return client
  }

  const clearError = () => {
    status.textContent = ''
    input.removeAttribute('aria-invalid')
    input.removeAttribute('aria-describedby')
  }

  const showError = (message: string) => {
    status.textContent = message
    input.setAttribute('aria-invalid', 'true')
    input.setAttribute('aria-describedby', status.id)
  }

  let pending = false

  // Returning focus to the field after an error must not trigger another load.
  input.addEventListener('focus', () => {
    if (attempted) return
    // Failure surfaces on submit, where the visitor can act on it.
    ensureClient().catch(() => {})
  })
  input.addEventListener('input', clearError)

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (pending) return
    pending = true
    clearError()
    button.disabled = true
    button.textContent = PENDING
    status.textContent = PENDING
    try {
      const waitlist = await ensureClient()
      await waitlist.join({ emailAddress: input.value.trim() })
      // The status element itself becomes the confirmation so it keeps its scoped styles. It is
      // all a visitor with blocked storage sees, and what Back shows when the page comes from
      // bfcache.
      status.textContent = JOINED
      status.tabIndex = -1
      form.replaceWith(status)
      status.focus()
      if (rememberJoin()) navigate(THANKS_PATH)
      // Without the marker the thanks page never sends it, and this page stays, so it can.
      else void trackWaitlistJoined(acquisition())
    } catch (error) {
      showError(messageFor(error))
      button.disabled = false
      button.textContent = label
      input.focus()
      pending = false
    }
  })
}

export async function loadClerk(publishableKey: string | undefined): Promise<WaitlistClient> {
  if (!publishableKey) throw new Error('PUBLIC_CLERK_PUBLISHABLE_KEY is not set')
  const { Clerk } = await import('@clerk/clerk-js')
  const clerk = new Clerk(publishableKey)
  await clerk.load()
  // clerk-js 6.35 exposes no `clerk.waitlist`; `joinWaitlist` is the method it types.
  return { join: (params) => clerk.joinWaitlist(params) }
}
