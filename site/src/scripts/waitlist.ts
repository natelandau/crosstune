export const JOINED = "You're on the list. We'll email you when your account is ready."
export const UNREACHABLE =
  "The waitlist can't be reached right now. Try again, or email support@crosstune.app."
export const PENDING = 'Joining…'
export const THANKS_PATH = '/waitlist/thanks'
// Set on join and cleared by the thanks page, so the page shows once per join.
export const JOINED_KEY = 'crosstune:waitlist-joined'

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

// Storage can be blocked; without the flag the thanks page would bounce the visitor home.
function rememberJoin(): boolean {
  try {
    sessionStorage.setItem(JOINED_KEY, '1')
    return true
  } catch {
    return false
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
      // The status element itself becomes the confirmation so it keeps its scoped styles. It is all a
      // visitor with blocked storage sees, and what Back shows when the page comes from bfcache.
      status.textContent = JOINED
      status.tabIndex = -1
      form.replaceWith(status)
      status.focus()
      if (rememberJoin()) navigate(THANKS_PATH)
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
