import { screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createList } from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { forceTouch } from '../../test/pointer'
import { countAccountData, deleteAccountAndForget } from './deleteAccount'
import {
  CANNOT_UNDO,
  CONFIRM_LABEL,
  DELETE_ACCOUNT,
  DELETE_ACCOUNT_LEAD,
  DELETE_ACCOUNT_TITLE,
  DELETE_CONFIRMATION_TEXT,
  DELETE_FAILED,
  DELETING,
  SETTINGS_LINE,
  UNSYNCED_LINE,
} from './deleteAccountCopy'
import { DeleteAccountSheet } from './DeleteAccountSheet'

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: vi.fn(async () => {}) }),
}))

vi.mock('./deleteAccount', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

function show(onClose: () => void = () => {}) {
  return renderIonic(<DeleteAccountSheet open onClose={onClose} />, { db })
}

/** Mirrors how AccountGroup holds `open`, so a real dismiss round-trips back to false. */
function Host({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <DeleteAccountSheet
      open={open}
      onClose={() => {
        onClose()
        setOpen(false)
      }}
    />
  )
}

const deleteButton = () => page.getByRole('button', { name: DELETE_ACCOUNT })
const confirmField = () => page.getByLabelText(CONFIRM_LABEL)

describe('DeleteAccountSheet', () => {
  it('shows counts and omits zero lines', async () => {
    await createTune(db, { title: 'A' }, { status: 'known' })
    await createTune(db, { title: 'B' }, { status: 'known' })
    await createList(db, 'Tuesday jam')
    show()
    await expect.element(page.getByText('2 tunes')).toBeVisible()
    await expect.element(page.getByText('1 list')).toBeVisible()
    await expect.element(page.getByText(SETTINGS_LINE)).toBeVisible()
    await vi.waitFor(() => expect(screen.queryByText(/recording/i)).toBeNull())
  })

  it('opens at full height on touch, so its form is reachable without a drag', async () => {
    const restore = forceTouch()
    try {
      show()
      const modal = document.querySelector<HTMLIonModalElement>('ion-modal')
      if (!modal) throw new Error('No sheet is mounted')
      await vi.waitFor(() => expect(modal.initialBreakpoint).toBe(1))
      expect(modal.breakpoints).toEqual([0, 1])
      // Closed cleanly, rather than left mid-present, so touch's extra sheet-gesture setup
      // never resolves against a component the next test has already unmounted.
      await page.getByRole('button', { name: 'Cancel' }).click()
      await vi.waitFor(() => expect(document.querySelector('ion-modal.show-modal')).toBeNull())
    } finally {
      restore()
    }
  })

  it('names the dialog after the row, and shows the question once as a heading', async () => {
    show()
    const modal = document.querySelector('ion-modal')
    if (!modal) throw new Error('No sheet is mounted')
    await vi.waitFor(() => {
      const dialog = modal.shadowRoot?.querySelector('[role="dialog"]')
      expect(dialog?.getAttribute('aria-label')).toBe(DELETE_ACCOUNT)
    })
    await expect.element(page.getByRole('heading', { name: DELETE_ACCOUNT_TITLE })).toBeVisible()
    expect(screen.getAllByText(DELETE_ACCOUNT_TITLE)).toHaveLength(1)
  })

  it('hides the count list until counts resolve, and keeps delete disabled', async () => {
    vi.mocked(countAccountData).mockReturnValueOnce(new Promise(() => {}))
    show()
    await confirmField().fill('DELETE')
    expect(screen.queryByText(SETTINGS_LINE)).toBeNull()
    expect(screen.queryByText(UNSYNCED_LINE)).toBeNull()
    await expect.element(deleteButton()).toBeDisabled()
  })

  it('shows the warning without a count list when the counts cannot be read', async () => {
    vi.mocked(countAccountData).mockRejectedValueOnce(new Error('database broken'))
    show()
    await expect.element(page.getByText(UNSYNCED_LINE)).toBeVisible()
    await expect.element(page.getByText(DELETE_ACCOUNT_LEAD)).toBeVisible()
    await expect.element(page.getByText(CANNOT_UNDO)).toBeVisible()
    expect(screen.queryByText(SETTINGS_LINE)).toBeNull()
    expect(document.querySelector('ion-modal ul')).toBeNull()
    await confirmField().fill('DELETE')
    await expect.element(deleteButton()).toBeEnabled()
  })

  it('does not count anything while closed', async () => {
    renderIonic(<DeleteAccountSheet open={false} onClose={() => {}} />, { db })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(vi.mocked(countAccountData)).not.toHaveBeenCalled()
  })

  it('shows the confirmation prompt as the field placeholder', async () => {
    show()
    await vi.waitFor(() =>
      expect(document.querySelector('ion-input input')?.getAttribute('placeholder')).toBe(
        CONFIRM_LABEL,
      ),
    )
  })

  it('keeps delete disabled until DELETE is typed', async () => {
    show()
    await expect.element(deleteButton()).toBeDisabled()
    await confirmField().fill(DELETE_CONFIRMATION_TEXT.slice(0, -1))
    await expect.element(deleteButton()).toBeDisabled()
    await confirmField().fill('DELETE')
    await expect.element(deleteButton()).toBeEnabled()
  })

  it('enables delete for a case and space variant', async () => {
    show()
    await confirmField().fill(' delete ')
    await expect.element(deleteButton()).toBeEnabled()
  })

  it('pressing Enter in the field does not delete', async () => {
    show()
    await confirmField().fill('DELETE')
    await userEvent.keyboard('{Enter}')
    expect(vi.mocked(deleteAccountAndForget)).not.toHaveBeenCalled()
  })

  it('refuses dismissal while deleting', async () => {
    vi.mocked(deleteAccountAndForget).mockReturnValueOnce(new Promise(() => {}))
    show()
    await confirmField().fill('DELETE')
    await deleteButton().click()
    await expect.element(page.getByRole('button', { name: DELETING })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('heading', { name: DELETE_ACCOUNT_TITLE })).toBeVisible()
  })

  it('closes once on Cancel, after the sheet actually dismisses', async () => {
    const onClose = vi.fn()
    renderIonic(<Host onClose={onClose} />, { db })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('closes on Escape while nothing is in flight', async () => {
    const onClose = vi.fn()
    renderIonic(<Host onClose={onClose} />, { db })
    await expect.element(page.getByRole('heading', { name: DELETE_ACCOUNT_TITLE })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('shows the failure and keeps the text', async () => {
    vi.mocked(deleteAccountAndForget).mockRejectedValueOnce(new Error('server unreachable'))
    show()
    await confirmField().fill('DELETE')
    await deleteButton().click()
    await expect.element(page.getByText(DELETE_FAILED)).toBeVisible()
    await expect.element(confirmField()).toHaveValue('DELETE')
  })
})
