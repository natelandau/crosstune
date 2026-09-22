import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createList } from '../../commands/lists'
import { LIST_NAME_REQUIRED, LIST_NOT_FOUND } from '../../commands/messages'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import {
  LIST_NAME_LABEL,
  LIST_NAME_PLACEHOLDER,
  ListNameSheet,
  NEW_LIST_TITLE,
  RENAME_LIST_TITLE,
  type ListNameTarget,
} from './ListNameSheet'

function Host({
  initial,
  onSaved = () => {},
  onClose = () => {},
}: {
  initial: ListNameTarget
  onSaved?: (id: string) => void
  onClose?: () => void
}) {
  const [target, setTarget] = useState<ListNameTarget | null>(initial)
  return (
    <ListNameSheet
      target={target}
      onClose={() => {
        onClose()
        setTarget(null)
      }}
      onSaved={(id) => {
        onSaved(id)
        setTarget(null)
      }}
    />
  )
}

const sheetOpen = () => document.querySelector('ion-modal:not(.overlay-hidden)') !== null

describe('ListNameSheet', () => {
  it('shows one named field with no header of its own', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByText(NEW_LIST_TITLE)).toBeVisible()
    const open = document.querySelector('ion-modal:not(.overlay-hidden)')!
    expect(open.querySelectorAll('h2')).toHaveLength(0)
    // Ionic hoists both onto the native input and leaves neither on the host.
    await vi.waitFor(() => {
      const input = open.querySelector('ion-input input')
      expect(input?.getAttribute('aria-label')).toBe(LIST_NAME_LABEL)
      expect((input as HTMLInputElement | null)?.placeholder).toBe(LIST_NAME_PLACEHOLDER)
    })
  })

  it('creates a list with a trimmed name', async () => {
    const db = openTestDb()
    const onSaved = vi.fn()
    renderIonic(<Host initial={{ kind: 'new' }} onSaved={onSaved} />, { db })
    await expect.element(page.getByText(NEW_LIST_TITLE)).toBeVisible()
    await page.getByLabelText(LIST_NAME_LABEL).fill('  Tuesday jam  ')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    const [list] = await db.lists.toArray()
    expect(list?.name).toBe('Tuesday jam')
    expect(onSaved).toHaveBeenCalledWith(list!.id)
  })

  it('requires a name and says so under the field', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new' }} />, { db })
    await page.getByLabelText(LIST_NAME_LABEL).fill('   ')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(LIST_NAME_REQUIRED)
    expect(await db.lists.count()).toBe(0)
  })

  it('renames with the current name filled in, and saves on Enter', async () => {
    const db = openTestDb()
    const listId = await createList(db, 'Tuesday jam')
    renderIonic(<Host initial={{ kind: 'rename', listId, name: 'Tuesday jam' }} />, { db })
    await expect.element(page.getByText(RENAME_LIST_TITLE)).toBeVisible()
    await expect.element(page.getByLabelText(LIST_NAME_LABEL)).toHaveValue('Tuesday jam')
    await page.getByLabelText(LIST_NAME_LABEL).fill('Wednesday jam')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(async () => expect((await db.lists.get(listId))?.name).toBe('Wednesday jam'))
  })

  it('creates once from two submits in the same tick', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new' }} />, { db })
    await page.getByLabelText(LIST_NAME_LABEL).fill('Tuesday jam')
    const form = document.querySelector('ion-modal form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(sheetOpen()).toBe(false))
    expect(await db.lists.count()).toBe(1)
  })

  it('discards the name on Cancel and reports the close once', async () => {
    const db = openTestDb()
    const onClose = vi.fn()
    renderIonic(<Host initial={{ kind: 'new' }} onClose={onClose} />, { db })
    await page.getByLabelText(LIST_NAME_LABEL).fill('Draft')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await vi.waitFor(() => expect(sheetOpen()).toBe(false))
    expect(onClose).toHaveBeenCalledOnce()
    expect(await db.lists.count()).toBe(0)
  })

  it('keeps a target set while the cancelled sheet is still closing, without a stale close', async () => {
    const db = openTestDb()
    const onClose = vi.fn()
    // Exposed through an effect so the test can apply the swap directly, outside any click's
    // actionability wait, right after Cancel starts the close.
    let swap = () => {}
    function SwapHost({ registerSwap }: { registerSwap: (fn: () => void) => void }) {
      const [target, setTarget] = useState<ListNameTarget | null>({ kind: 'new' })
      useEffect(() => {
        registerSwap(() => setTarget({ kind: 'rename', listId: 'l2', name: 'Old name' }))
      }, [registerSwap])
      return (
        <ListNameSheet
          target={target}
          onClose={() => {
            onClose()
            setTarget(null)
          }}
          onSaved={() => {}}
        />
      )
    }
    renderIonic(<SwapHost registerSwap={(fn) => (swap = fn)} />, { db })
    await expect.element(page.getByText(NEW_LIST_TITLE)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    // The parent opens a new target immediately, while the cancelled sheet is still animating closed.
    swap()
    await expect.element(page.getByText(RENAME_LIST_TITLE)).toBeVisible()
    // Long enough for the cancelled sheet's dismiss event to arrive after the swap.
    await new Promise((resolve) => setTimeout(resolve, 500))
    await expect.element(page.getByText(RENAME_LIST_TITLE)).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clears a stale save failure as the name is retyped', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'rename', listId: 'missing', name: 'Ghost' }} />, { db })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(LIST_NOT_FOUND)
    await page.getByLabelText(LIST_NAME_LABEL).fill('Ghost jam')
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  })
})
