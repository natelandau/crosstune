import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { fakeEngine, testSession } from '../../test/providers'
import { AccountGroup, SIGN_OUT, SIGN_OUT_OFFLINE, SIGNED_IN_OFFLINE } from './AccountGroup'
import { signOutAndForget } from './signOut'

const clerk = vi.hoisted(() => ({
  signOut: vi.fn(async () => {}),
  user: null as { primaryEmailAddress?: { emailAddress: string } } | null,
}))

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: clerk.signOut }),
  useUser: () => ({ user: clerk.user }),
}))

vi.mock('./signOut', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  clerk.user = { primaryEmailAddress: { emailAddress: 'nate@example.com' } }
})

afterEach(async () => {
  await db.delete()
})

function show(options: { engine?: SyncEngine; offline?: boolean } = {}) {
  return renderIonic(<AccountGroup />, {
    db,
    engine: options.engine,
    session: options.offline
      ? { ...testSession, getToken: async () => null, offline: true }
      : testSession,
  })
}

const signOutRow = () => page.getByRole('button', { name: SIGN_OUT })

describe('AccountGroup', () => {
  it('names the signed-in account by its email', async () => {
    show()
    await expect.element(page.getByText('nate@example.com')).toBeVisible()
  })

  it('falls back to the user id when Clerk has no primary email', async () => {
    clerk.user = {}
    show()
    await expect.element(page.getByText('user_1')).toBeVisible()
  })

  it('says the session is offline and refuses to sign out without a connection', async () => {
    clerk.user = null
    show({ offline: true })
    await expect.element(page.getByText(SIGNED_IN_OFFLINE)).toBeVisible()
    await expect.element(page.getByText(SIGN_OUT_OFFLINE)).toBeVisible()
    await expect.element(signOutRow()).toBeDisabled()
  })

  it('signs out through signOutAndForget with this session and engine', async () => {
    const engine = fakeEngine()
    vi.mocked(signOutAndForget).mockResolvedValueOnce()
    show({ engine })
    await signOutRow().click()
    await vi.waitFor(() => expect(vi.mocked(signOutAndForget)).toHaveBeenCalledOnce())
    expect(vi.mocked(signOutAndForget)).toHaveBeenCalledWith(
      expect.objectContaining({ db, userId: 'user_1', engine }),
    )
  })

  it('shows a refused sign-out and leaves the row ready for another try', async () => {
    vi.mocked(signOutAndForget).mockRejectedValueOnce(new Error('Clerk unreachable'))
    show()
    await signOutRow().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Clerk unreachable')
    await expect.element(signOutRow()).toBeEnabled()
  })

  it('gives both rows a tap target a finger can hit', async () => {
    show()
    await expect.element(signOutRow()).toBeVisible()
    for (const item of document.querySelectorAll('ion-item')) {
      expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })
})
