import { IonPage } from '@ionic/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { createList } from '../../commands/lists'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import { recordingRow, scanRow, tuneRow, userTuneRow } from '../../test/rows'
import { summaryLine } from '../stats/copy'
import { StatsSummaryRow } from './StatsSummaryRow'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const EMPTY = { tunes: 0, lists: 0, recordings: 0, scans: 0, ms: 0 }

const show = (engine = fakeEngine()) =>
  renderScreen(
    <IonPage>
      <StatsSummaryRow />
    </IonPage>,
    {
      db,
      engine,
      path: '/settings',
      route: '/settings',
      probes: { '/settings/stats': 'Stats probe' },
    },
  )

describe('StatsSummaryRow', () => {
  it('shows counts and recorded time', async () => {
    await db.tunes.bulkPut([tuneRow('t1', 'Sally Ann'), tuneRow('t2', 'Cluck Old Hen')])
    await db.user_tunes.bulkPut([
      userTuneRow('u1', 't1'),
      userTuneRow('u2', 't2', { archived_at: '2026-02-01T00:00:00.000Z' }),
    ])
    await createList(db, 'Jam')
    await db.recordings.bulkPut([
      recordingRow('r1', { duration_ms: 3_600_000 }),
      recordingRow('r2', { duration_ms: 720_000 }),
    ])
    show()
    const counts = { tunes: 1, lists: 1, recordings: 2, scans: 0, ms: 4_320_000 }
    await expect.element(page.getByRole('button', { name: summaryLine(counts) })).toBeVisible()
    expect(summaryLine(counts)).toBe('1 tune · 1 list · 2 recordings · 1 h 12 m')
  })

  it('adds the scans after the recordings once there are any', async () => {
    await db.tunes.put(tuneRow('t1', 'Sally Ann'))
    await db.user_tunes.put(userTuneRow('u1', 't1'))
    await db.scans.bulkPut([scanRow('s1', 't1'), scanRow('s2', 't1', { position: 1 })])
    show()
    const counts = { tunes: 1, lists: 0, recordings: 0, scans: 2, ms: 0 }
    await expect.element(page.getByRole('button', { name: summaryLine(counts) })).toBeVisible()
    expect(summaryLine(counts)).toBe('1 tune · 0 lists · 0 recordings · 2 scans · 0 m')
    expect(summaryLine({ ...counts, scans: 1 })).toContain(' · 1 scan · ')
  })

  it('never pulls history', async () => {
    const pullEvents = vi.fn(async () => {})
    show(fakeEngine({ pullEvents }))
    await expect.element(page.getByRole('button', { name: summaryLine(EMPTY) })).toBeVisible()
    expect(pullEvents).not.toHaveBeenCalled()
  })

  it('opens the stats page', async () => {
    show()
    await page.getByRole('button', { name: summaryLine(EMPTY) }).click()
    await expect.element(page.getByRole('heading', { name: 'Stats probe' })).toBeVisible()
  })
})
