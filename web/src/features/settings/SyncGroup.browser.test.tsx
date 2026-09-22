import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { countInvalidChanges } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { SYNC_STATUS_LABELS, TRANSFER_STATUS_LABELS } from '../../sync/labels'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import type { SyncEngine } from '../../sync/types'
import { ONE_REJECTED, SYNC_NOW, SyncGroup } from './SyncGroup'

const TWO_REJECTED = '2 changes were rejected by the server and are only on this device.'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

const show = (engine?: SyncEngine) => renderIonic(<SyncGroup />, { db, engine })

const syncButton = () => page.getByRole('button', { name: SYNC_NOW })

describe('SyncGroup', () => {
  it('reports a failing sync and a stalled recording transfer', async () => {
    show(fakeEngine({ status: () => 'error', transferStatus: () => 'transferring' }))
    await expect.element(page.getByText('Status')).toBeVisible()
    await expect.element(page.getByText(SYNC_STATUS_LABELS.error)).toBeVisible()
    await expect.element(page.getByText('Recordings')).toBeVisible()
    await expect.element(page.getByText('Transferring')).toBeVisible()
  })

  it('reports a clean sync and an up to date transfer', async () => {
    show()
    await expect.element(page.getByText('Synced')).toBeVisible()
    await expect.element(page.getByText(TRANSFER_STATUS_LABELS.idle)).toBeVisible()
  })

  it('names the one change the server rejected', async () => {
    await countInvalidChanges(db, 1)
    show()
    await expect.element(page.getByText(ONE_REJECTED)).toBeVisible()
  })

  it('names several changes the server rejected, in the plural', async () => {
    await countInvalidChanges(db, 2)
    show()
    await expect.element(page.getByText(TWO_REJECTED)).toBeVisible()
  })

  it('sets the rejected count in the footnote role, not the row label size', async () => {
    await countInvalidChanges(db, 1)
    renderIonic(
      <>
        <p data-reference className="type-footnote">
          reference
        </p>
        <SyncGroup />
      </>,
      { db },
    )
    await expect.element(page.getByText(ONE_REJECTED)).toBeVisible()
    const rejected = page.getByText(ONE_REJECTED).element()
    const reference = document.querySelector('[data-reference]')!
    expect(getComputedStyle(rejected).fontSize).toBe(getComputedStyle(reference).fontSize)
    expect(getComputedStyle(rejected).fontWeight).toBe(getComputedStyle(reference).fontWeight)
  })

  it('says nothing about rejections with none recorded', async () => {
    show()
    await expect.element(syncButton()).toBeVisible()
    expect(page.getByText(ONE_REJECTED).elements()).toHaveLength(0)
    expect(page.getByText(/rejected by the server/).elements()).toHaveLength(0)
  })

  it('syncs once and disables the button while the call is in flight', async () => {
    let release: () => void = () => {}
    const sync = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    show(fakeEngine({ sync }))
    await syncButton().click()
    expect(sync).toHaveBeenCalledOnce()
    await expect.element(syncButton()).toBeDisabled()
    release()
    await expect.element(syncButton()).toBeEnabled()
  })

  it('shows a refused sync under the group and re-enables the button', async () => {
    show(fakeEngine({ sync: vi.fn().mockRejectedValue(new Error('Sync is unavailable')) }))
    await syncButton().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Sync is unavailable')
    await expect.element(syncButton()).toBeEnabled()
  })

  it('gives every row a tap target a finger can hit', async () => {
    show()
    await expect.element(syncButton()).toBeVisible()
    for (const item of document.querySelectorAll('ion-item')) {
      expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })
})
