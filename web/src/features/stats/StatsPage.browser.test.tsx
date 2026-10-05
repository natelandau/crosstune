import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { getMeta, setMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import { recordingRow, scanRow, scanViewRow, tuneRow, userTuneRow } from '../../test/rows'
import type { SyncEngine } from '../../sync/types'
import {
  catalogEntries,
  DEFAULT_FILTERS,
  FACET_LABELS,
  filterCatalog,
  META_CATALOG_FILTERS,
} from '../catalog/filters'
import { readSearchQuery, writeSearchQuery } from '../catalog/searchSession'
import { DETAIL_LABELS } from '../tune/detailFields'
import {
  ACTIVITY_HEADER,
  COUNTS_HEADER,
  dayDetail,
  keyCellLabel,
  keyModeCellLabel,
  onThisDayLine,
  RARITIES_HEADER,
  rarityLine,
  RECORDED_HEADER,
  recordedLine,
  scansLine,
  STATS_TITLE,
  TUNES_LABEL,
} from './copy'
import { StatsPage } from './StatsPage'
import type { Day } from './types'

// Noon UTC keeps every fixture instant on the same local date in any zone a runner uses.
const NOW = new Date('2026-10-04T12:00:00.000Z')

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const show = (engine?: SyncEngine) =>
  renderScreen(<StatsPage now={NOW} />, {
    db,
    engine,
    path: '/settings/stats',
    route: '/settings/stats',
    probes: { '/catalog': 'Catalog probe', '/settings/stats/tunes/:tuneId': 'Tune probe' },
  })

const TODAY = '2026-10-04'

const headings = () =>
  page
    .getByRole('heading', { level: 2 })
    .elements()
    .map((heading) => heading.textContent)

async function addTune(id: string, title: string, tune: Parameters<typeof tuneRow>[2] = {}) {
  await db.tunes.put(tuneRow(id, title, tune))
  await db.user_tunes.put(userTuneRow(`u-${id}`, id))
}

describe('StatsPage', () => {
  it('counts and recorded always show on an empty catalog', async () => {
    show()
    await expect.element(page.getByText(recordedLine(0, 0))).toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: STATS_TITLE, level: 1 }))
      .toBeInTheDocument()
    await expect.poll(headings).toEqual([COUNTS_HEADER, RECORDED_HEADER])
  })

  it('an unused attribute has no block', async () => {
    await addTune('t1', 'Sally Ann', { key: 'D', modes: ['major'] })
    show()
    await expect
      .element(page.getByRole('heading', { name: FACET_LABELS.key, level: 2 }))
      .toBeVisible()
    expect(headings()).not.toContain(DETAIL_LABELS.tune_type)
  })

  it('a key value opens the catalog filtered by that key', async () => {
    writeSearchQuery('catalog', 'reel')
    await setMeta(db, META_CATALOG_FILTERS, {
      ...DEFAULT_FILTERS,
      status: 'known',
      genre: 'Irish',
      archived: true,
    })
    await addTune('t1', 'Sally Ann', { key: 'D', modes: ['major'] })
    show()
    await page.getByRole('button', { name: keyCellLabel('D', 1) }).click()
    await expect.element(page.getByRole('heading', { name: 'Catalog probe' })).toBeVisible()
    await expect
      .poll(() => getMeta(db, META_CATALOG_FILTERS, null))
      .toEqual({ ...DEFAULT_FILTERS, key: 'D' })
    expect(readSearchQuery('catalog')).toBe('')
  })

  it('a key and mode cell filters by both', async () => {
    await addTune('t1', 'Sally Ann', { key: 'E', modes: ['dorian'] })
    show()
    await page.getByRole('button', { name: keyModeCellLabel('E', 'dorian', 1) }).click()
    await expect.element(page.getByRole('heading', { name: 'Catalog probe' })).toBeVisible()
    await expect
      .poll(() => getMeta(db, META_CATALOG_FILTERS, null))
      .toEqual({ ...DEFAULT_FILTERS, key: 'E', mode: 'dorian' })
  })

  it('a genre value opens the catalog filtered by that genre', async () => {
    await addTune('t1', 'Sally Ann', { genre: 'Irish' })
    show()
    await page.getByRole('button', { name: /^Irish/ }).click()
    await expect.element(page.getByRole('heading', { name: 'Catalog probe' })).toBeVisible()
    await expect
      .poll(() => getMeta(db, META_CATALOG_FILTERS, null))
      .toEqual({ ...DEFAULT_FILTERS, genre: 'Irish' })
  })

  it('a value the catalog would read as Any or No key only counts', async () => {
    await addTune('t1', 'Sally Ann', { genre: 'All', key: 'None', modes: ['major'] })
    show()
    await expect.element(page.getByText('All', { exact: true })).toBeVisible()
    expect(
      page
        .getByRole('button', {
          name: new RegExp(
            `^All|${keyCellLabel('None', 1)}|${keyModeCellLabel('None', 'major', 1)}`,
          ),
        })
        .elements(),
    ).toHaveLength(0)
  })

  it('time signature only counts', async () => {
    await addTune('t1', 'Sally Ann', { time_signature: '7/8' })
    show()
    await expect.element(page.getByText('7/8', { exact: true })).toBeVisible()
    expect(page.getByRole('button', { name: /7\/8/ }).elements()).toHaveLength(0)
  })

  it('a learned from value opens the catalog filtered by that name', async () => {
    const tunes = [tuneRow('t1', 'Sally Ann'), tuneRow('t2', 'Angeline the Baker')]
    const userTunes = [
      userTuneRow('u1', 't1', { learned_from: 'Kevin' }),
      userTuneRow('u2', 't2', { learned_from: 'Bruce' }),
    ]
    await db.tunes.bulkPut(tunes)
    await db.user_tunes.bulkPut(userTunes)
    show()
    await expect
      .element(page.getByRole('heading', { name: FACET_LABELS.learned_from, level: 2 }))
      .toBeVisible()
    await page.getByRole('button', { name: /^Kevin/ }).click()
    await expect.element(page.getByRole('heading', { name: 'Catalog probe' })).toBeVisible()
    await expect
      .poll(() => getMeta(db, META_CATALOG_FILTERS, null))
      .toEqual({ ...DEFAULT_FILTERS, learned_from: 'Kevin' })
    expect(
      filterCatalog(catalogEntries(tunes, userTunes), {
        ...DEFAULT_FILTERS,
        learned_from: 'Kevin',
      }).map((entry) => entry.tune.id),
    ).toEqual(['t1'])
  })

  it('a composer value opens the catalog filtered by that composer', async () => {
    await addTune('t1', 'Sally Ann', { composer: 'Ed Haley' })
    show()
    await page.getByRole('button', { name: /^Ed Haley/ }).click()
    await expect.element(page.getByRole('heading', { name: 'Catalog probe' })).toBeVisible()
    await expect
      .poll(() => getMeta(db, META_CATALOG_FILTERS, null))
      .toEqual({ ...DEFAULT_FILTERS, composer: 'Ed Haley' })
  })

  it('rarities show at most three', async () => {
    for (const [i, key] of ['A', 'B', 'C', 'D', 'E'].entries()) {
      await addTune(`t${i}`, `Tune ${key}`, { key, modes: ['major'] })
    }
    show()
    const first = rarityLine({ attribute: 'key_mode', value: 'A major', tune_id: 't0' })
    await expect.element(page.getByRole('button', { name: new RegExp(`^${first}`) })).toBeVisible()
    await expect
      .poll(
        () =>
          page.getByRole('list', { name: RARITIES_HEADER }).getByRole('button').elements().length,
      )
      .toBe(3)
  })

  it('a rarity opens its tune', async () => {
    for (const [i, key] of ['A', 'B', 'C'].entries()) {
      await addTune(`t${i}`, `Tune ${key}`, { key, modes: ['major'] })
    }
    show()
    const line = rarityLine({ attribute: 'key_mode', value: 'B major', tune_id: 't1' })
    await page.getByRole('button', { name: new RegExp(`^${line}`) }).click()
    await expect.element(page.getByRole('heading', { name: 'Tune probe' })).toBeVisible()
  })

  it('heatmap hidden under seven active days', async () => {
    const recordedOn = (day: number) =>
      recordingRow(`r${day}`, { added_at: `2026-09-${String(day).padStart(2, '0')}T12:00:00Z` })
    await db.recordings.bulkPut([1, 2, 3, 4, 5, 6].map(recordedOn))
    show()
    await expect.element(page.getByText(recordedLine(6, 0))).toBeVisible()
    expect(headings()).not.toContain(ACTIVITY_HEADER)
    await db.recordings.put(recordedOn(7))
    await expect
      .element(page.getByRole('heading', { name: ACTIVITY_HEADER, level: 2 }))
      .toBeVisible()
  })

  it('steps through the heatmap from the keyboard', async () => {
    await db.recordings.bulkPut(
      [21, 22, 23, 24, 25, 26, 27].map((day) =>
        recordingRow(`r${day}`, { added_at: `2026-09-${day}T12:00:00Z` }),
      ),
    )
    show()
    const grid = page.getByRole('group', { name: ACTIVITY_HEADER })
    await expect.element(grid).toBeVisible()
    grid.element().focus()
    await userEvent.keyboard('{End}')
    await userEvent.keyboard('{ArrowLeft}')
    const weekAgo: Day = {
      date: '2026-09-27',
      music_ms: 0,
      plays: 0,
      practice_sessions: 0,
      scan_views: 0,
      tunes_added: 0,
      recordings: 1,
      status_changes: 0,
      level: 1,
    }
    await expect.element(page.getByText(dayDetail(weekAgo, TODAY), { exact: true })).toBeVisible()
  })

  it('heatmap counts the scan views stored on the device', async () => {
    await db.scan_views.bulkPut(
      ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'].map(
        (date) => scanViewRow(`v-${date}`, { started_at: `${date}T12:00:00.000Z` }),
      ),
    )
    await db.scan_views.bulkPut(
      ['a', 'b'].map((n) => scanViewRow(`v-today-${n}`, { started_at: `${TODAY}T12:00:00.000Z` })),
    )
    show()
    const grid = page.getByRole('group', { name: ACTIVITY_HEADER })
    await expect.element(grid).toBeVisible()
    grid.element().focus()
    await userEvent.keyboard('{End}')
    const today: Day = {
      date: TODAY,
      music_ms: 0,
      plays: 0,
      practice_sessions: 0,
      scan_views: 2,
      tunes_added: 0,
      recordings: 0,
      status_changes: 0,
      level: 1,
    }
    await expect.element(page.getByText(dayDetail(today, TODAY), { exact: true })).toBeVisible()
  })

  it('counts scans in one line only once there are any', async () => {
    await addTune('t1', 'Sally Ann')
    show()
    const counts = () => page.getByRole('list', { name: COUNTS_HEADER }).query()?.textContent
    await expect.poll(counts).toMatch(new RegExp(`${TUNES_LABEL}\\s*1`))
    // The counts render from one read, so the tunes count above means the block is final.
    expect(counts()).not.toMatch(/scan/)
    await db.scans.bulkPut([scanRow('s1', 't1'), scanRow('s2', 't1', { position: 1 })])
    await expect.element(page.getByText(scansLine(2, 1), { exact: true })).toBeVisible()
  })

  it('stats page renders offline from local rows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pullEvents = vi.fn(async () => {
      throw new Error('offline')
    })
    await addTune('t1', 'Sally Ann')
    show(fakeEngine({ pullEvents }))
    await expect
      .poll(() => page.getByRole('list', { name: COUNTS_HEADER }).query()?.textContent)
      .toMatch(new RegExp(`${TUNES_LABEL}\\s*1`))
    await expect.poll(() => warn).toHaveBeenCalled()
    await expect.poll(() => pullEvents).toHaveBeenCalledTimes(1)
  })

  it('on this day shows an anniversary', async () => {
    await db.tunes.bulkPut([tuneRow('t1', 'Cluck Old Hen'), tuneRow('t2', 'Sally Ann')])
    await db.user_tunes.bulkPut([
      userTuneRow('u1', 't1', { created_at: '2024-01-01T12:00:00.000Z' }),
      userTuneRow('u2', 't2', { created_at: '2025-10-04T12:00:00.000Z' }),
    ])
    show()
    const line = onThisDayLine({ kind: 'tune_added', id: 't2', years: 1 }, 'Sally Ann')
    await expect.element(page.getByText(line)).toBeVisible()
  })
})
