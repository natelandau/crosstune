// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JOIN_WAITLIST } from '../src/components/actions'
import {
  JOINED,
  JOINED_KEY,
  JOIN_EVENT_KEY,
  PENDING,
  THANKS_PATH,
  UNREACHABLE,
  loadClerk,
  mountWaitlist,
  reportJoin,
  type WaitlistClient,
} from '../src/scripts/waitlist'

const analytics = vi.hoisted(() => ({
  startAnalytics: vi.fn(async () => {}),
  trackWaitlistJoined: vi.fn(async () => {}),
}))
vi.mock('../src/scripts/analytics', () => analytics)

let form: HTMLFormElement
let input: HTMLInputElement
let button: HTMLButtonElement
let status: HTMLElement
let navigate: ReturnType<typeof vi.fn<(path: string) => void>>

beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
  analytics.startAnalytics.mockClear()
  analytics.trackWaitlistJoined.mockClear()
  history.replaceState(null, '', '/')
  Object.defineProperty(document, 'referrer', { value: '', configurable: true })
  navigate = vi.fn()
  document.body.innerHTML = `
    <form data-waitlist>
      <input id="waitlist-email" type="email" name="email" required />
      <button type="submit">${JOIN_WAITLIST}</button>
      <p data-waitlist-status aria-live="polite"></p>
    </form>`
  form = document.querySelector('form')!
  input = form.querySelector('input')!
  button = form.querySelector('button')!
  status = form.querySelector('[data-waitlist-status]')!
})

const submit = (email = 'fiddler@example.com') => {
  input.value = email
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(join: WaitlistClient['join']) {
  const client: WaitlistClient = { join }
  const load = vi.fn(async () => client)
  mountWaitlist(form, load, navigate)
  return load
}

describe('mountWaitlist', () => {
  it('loads the client on first focus only, however often it focuses', () => {
    const load = setup(vi.fn())
    expect(load).not.toHaveBeenCalled()
    input.dispatchEvent(new FocusEvent('focus'))
    input.dispatchEvent(new FocusEvent('focus'))
    input.dispatchEvent(new FocusEvent('focus'))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('joins once and disables the button while pending', async () => {
    let finish: (value: unknown) => void = () => {}
    const join = vi.fn(() => new Promise((resolve) => (finish = resolve)))
    setup(join)
    submit()
    await settle()
    expect(join).toHaveBeenCalledWith({ emailAddress: 'fiddler@example.com' })
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe(PENDING)
    expect(status.textContent).toBe(PENDING)
    submit()
    await settle()
    expect(join).toHaveBeenCalledTimes(1)
    finish({})
    await settle()
  })

  it('replaces the form with the success message and focuses it', async () => {
    setup(vi.fn(async () => ({})))
    submit()
    await settle()
    expect(document.body.contains(form)).toBe(false)
    const message = document.querySelector('p')!
    expect(message).toBe(status)
    expect(message.textContent).toBe(JOINED)
    expect(message.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(message)
  })

  it('remembers the join and goes to the thanks page', async () => {
    setup(vi.fn(async () => ({})))
    submit()
    await settle()
    expect(sessionStorage.getItem(JOINED_KEY)).not.toBeNull()
    expect(navigate).toHaveBeenCalledWith(THANKS_PATH)
  })

  it("carries the visit's referrer and UTM to the thanks page, and nothing else", async () => {
    history.replaceState(null, '', '/?utm_source=newsletter&utm_campaign=fall&ref=x#waitlist')
    Object.defineProperty(document, 'referrer', {
      value: 'https://forum.example/thread/1',
      configurable: true,
    })
    setup(vi.fn(async () => ({})))
    submit('private@example.com')
    await settle()
    expect(JSON.parse(sessionStorage.getItem(JOINED_KEY)!)).toEqual({
      $referrer: 'https://forum.example/thread/1',
      $referring_domain: 'forum.example',
      utm_source: 'newsletter',
      utm_campaign: 'fall',
    })
  })

  it('marks a visit with no referrer as direct', async () => {
    setup(vi.fn(async () => ({})))
    submit()
    await settle()
    expect(JSON.parse(sessionStorage.getItem(JOINED_KEY)!)).toEqual({
      $referrer: '$direct',
      $referring_domain: '$direct',
    })
  })

  it('leaves tracking to the thanks page, which outlives the navigation', async () => {
    setup(vi.fn(async () => ({})))
    submit()
    await settle()
    expect(analytics.trackWaitlistJoined).not.toHaveBeenCalled()
  })

  it('stays on the inline confirmation when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    setup(vi.fn(async () => ({})))
    submit()
    await settle()
    expect(navigate).not.toHaveBeenCalled()
    expect(status.textContent).toBe(JOINED)
  })

  it('tracks the join itself when storage is blocked, since nothing navigates', async () => {
    history.replaceState(null, '', '/?utm_source=newsletter')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    setup(vi.fn(async () => ({})))
    submit('private@example.com')
    await settle()
    expect(analytics.trackWaitlistJoined).toHaveBeenCalledTimes(1)
    expect(analytics.trackWaitlistJoined).toHaveBeenCalledWith({
      $referrer: '$direct',
      $referring_domain: '$direct',
      utm_source: 'newsletter',
    })
  })

  it('does not leave the page when the join fails', async () => {
    setup(
      vi.fn(async () => {
        throw { errors: [{ longMessage: 'Nope.' }] }
      }),
    )
    submit()
    await settle()
    expect(navigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(JOINED_KEY)).toBeNull()
    expect(analytics.trackWaitlistJoined).not.toHaveBeenCalled()
  })

  it("shows Clerk's message, marks the input, and re-enables the button", async () => {
    setup(
      vi.fn(async () => {
        throw { errors: [{ longMessage: 'That email is already on the list.' }] }
      }),
    )
    submit()
    await settle()
    expect(status.textContent).toBe('That email is already on the list.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(status.id).toBeTruthy()
    expect(input.getAttribute('aria-describedby')).toBe(status.id)
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe(JOIN_WAITLIST)
    expect(document.activeElement).toBe(input)
  })

  it('says the waitlist is unreachable when the client will not load', async () => {
    const load = vi.fn(async () => {
      throw new Error('blocked')
    })
    mountWaitlist(form, load, navigate)
    submit()
    await settle()
    expect(status.textContent).toBe(UNREACHABLE)
    expect(button.disabled).toBe(false)
  })

  it('loads again on a second submit after a failed load', async () => {
    const load = vi.fn<() => Promise<WaitlistClient>>().mockRejectedValueOnce(new Error('blocked'))
    load.mockResolvedValue({ join: vi.fn(async () => ({})) })
    mountWaitlist(form, load, navigate)
    submit()
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    submit()
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
    expect(status.textContent).toBe(JOINED)
  })

  it('makes one load and one join when focus and submit race the load', async () => {
    const join = vi.fn(async () => ({}))
    let resolve: (client: WaitlistClient) => void = () => {}
    const load = vi.fn(() => new Promise<WaitlistClient>((r) => (resolve = r)))
    mountWaitlist(form, load, navigate)
    input.dispatchEvent(new FocusEvent('focus'))
    submit()
    await settle()
    resolve({ join })
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    expect(join).toHaveBeenCalledTimes(1)
  })

  it('clears an error when the email is edited', async () => {
    setup(
      vi.fn(async () => {
        throw { errors: [{ longMessage: 'Nope.' }] }
      }),
    )
    submit()
    await settle()
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(status.textContent).toBe('')
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    expect(input.hasAttribute('aria-describedby')).toBe(false)
  })
})

const clerkMock = vi.hoisted(() => ({
  load: vi.fn(async () => {}),
  joinWaitlist: vi.fn(async () => ({})),
  key: '',
}))
describe('reportJoin', () => {
  const acquisition = { $referrer: 'https://forum.example/', utm_source: 'newsletter' }

  it('sends the pending join once analytics starts, then clears it', async () => {
    sessionStorage.setItem(JOIN_EVENT_KEY, JSON.stringify(acquisition))
    await reportJoin('phc_x')
    expect(analytics.startAnalytics).toHaveBeenCalledWith('phc_x')
    expect(analytics.trackWaitlistJoined).toHaveBeenCalledTimes(1)
    expect(analytics.trackWaitlistJoined).toHaveBeenCalledWith(acquisition)
    expect(sessionStorage.getItem(JOIN_EVENT_KEY)).toBeNull()
  })

  it('sends a join only once, however often the page runs', async () => {
    sessionStorage.setItem(JOIN_EVENT_KEY, JSON.stringify(acquisition))
    await reportJoin('phc_x')
    await reportJoin('phc_x')
    expect(analytics.trackWaitlistJoined).toHaveBeenCalledTimes(1)
  })

  it('sends nothing without a pending join', async () => {
    await reportJoin('phc_x')
    expect(analytics.trackWaitlistJoined).not.toHaveBeenCalled()
  })

  it('sends only acquisition properties from the marker', async () => {
    sessionStorage.setItem(
      JOIN_EVENT_KEY,
      JSON.stringify({ ...acquisition, email: 'private@example.com', utm_term: 3 }),
    )
    await reportJoin('phc_x')
    expect(analytics.trackWaitlistJoined).toHaveBeenCalledWith(acquisition)
  })

  it('sends the join without properties when the marker is unreadable', async () => {
    sessionStorage.setItem(JOIN_EVENT_KEY, 'not json')
    await reportJoin('phc_x')
    expect(analytics.trackWaitlistJoined).toHaveBeenCalledWith({})
  })
})

vi.mock('@clerk/clerk-js', () => ({
  Clerk: class {
    constructor(key: string) {
      clerkMock.key = key
    }
    load = clerkMock.load
    joinWaitlist = clerkMock.joinWaitlist
  },
}))

describe('loadClerk', () => {
  it('constructs, loads, and maps join to joinWaitlist', async () => {
    const client = await loadClerk('pk_test_abc')
    expect(clerkMock.key).toBe('pk_test_abc')
    expect(clerkMock.load).toHaveBeenCalledTimes(1)
    await client.join({ emailAddress: 'a@b.co' })
    expect(clerkMock.joinWaitlist).toHaveBeenCalledWith({ emailAddress: 'a@b.co' })
  })

  it('rejects without a publishable key', async () => {
    await expect(loadClerk(undefined)).rejects.toThrow()
  })
})
