import { beforeEach, describe, expect, it } from 'vitest'
import type { Instrument } from '../../api/vocabulary'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { cardRows, attributeRows } from './attributeRows'
import type { TuneView } from './useTune'

let db: CrosstuneDb
const violin: ReadonlySet<Instrument> = new Set<Instrument>(['violin'])

beforeEach(() => {
  db = openTestDb()
})

async function view(
  tune: Partial<Parameters<typeof createTune>[1]> = {},
  user: Partial<Parameters<typeof createTune>[2]> = {},
): Promise<TuneView> {
  const ids = await createTune(db, { title: 'Test', ...tune }, { status: 'learning', ...user })
  const t = (await db.tunes.get(ids.tuneId))!
  const u = (await db.user_tunes.get(ids.userTuneId))!
  return { tune: t, userTune: u, links: [] }
}

describe('attributeRows', () => {
  it('orders the rows as the spec lists them', async () => {
    const rows = attributeRows(await view({ is_crooked: false }), violin)
    expect(rows.map((r) => r.id)).toEqual([
      'status',
      'key',
      'tuning:violin',
      'tune_type',
      'time_signature',
      'part_structure',
      'genre',
      'composer',
      'alternate_titles',
      'learned_from',
      'learned_on',
    ])
    expect(rows.find((r) => r.id === 'status')?.text).toBe('Learning')
  })

  it('groups the rows as the attributes column heads them', async () => {
    const rows = attributeRows(await view({ is_crooked: true }), violin)
    const group = (name: string) => rows.filter((r) => r.group === name).map((r) => r.id)
    expect(group('details')).toEqual([
      'status',
      'key',
      'tuning:violin',
      'tune_type',
      'time_signature',
      'part_structure',
      'is_crooked',
    ])
    expect(group('about')).toEqual(['genre', 'composer', 'alternate_titles'])
    expect(group('learned')).toEqual(['learned_from', 'learned_on'])
  })

  it('shows crooked only when on', async () => {
    const base = await view({ is_crooked: true })
    const on = attributeRows(base, violin)
    const ids = on.map((r) => r.id)
    expect(ids[ids.indexOf('part_structure') + 1]).toBe('is_crooked')
    expect(on.find((r) => r.id === 'is_crooked')?.text).toBe('Crooked')
    const off = attributeRows({ ...base, tune: { ...base.tune, is_crooked: false } }, violin)
    expect(off.map((r) => r.id)).not.toContain('is_crooked')
  })

  it('leaves out a mode of other and keeps the key', async () => {
    const text = async (modes: string[]) =>
      attributeRows(await view({ key: 'A', modes: modes as never }), violin).find(
        (r) => r.id === 'key',
      )?.text
    expect(await text(['other'])).toBe('A')
    expect(await text(['dorian', 'other'])).toBe('A dorian')
    expect(await text(['major'])).toBe('A major')
  })

  it('writes a capo alone', async () => {
    const rows = attributeRows(await view({ tunings: { violin: { capo: 2 } } as never }), violin)
    expect(rows.find((r) => r.id === 'tuning:violin')?.text).toBe('Capo 2')
  })

  it('has no row for an unplayed instrument with no value', async () => {
    const rows = attributeRows(await view({}), violin)
    expect(rows.map((r) => r.id)).not.toContain('tuning:mandolin')
  })

  it('formats the learned-on date', async () => {
    const rows = attributeRows(await view({}, { learned_on: '2024-03-05' }), violin)
    expect(rows.find((r) => r.id === 'learned_on')?.text).toBe('Mar 5, 2024')
  })

  it('adds a tuning row for an unplayed instrument that holds a value', async () => {
    const rows = attributeRows(
      await view({ tunings: { five_string_banjo: { tuning: 'gDGBD' } } }),
      violin,
    )
    expect(rows.map((r) => r.id)).toContain('tuning:five_string_banjo')
  })

  it('formats key with every mode', async () => {
    const rows = attributeRows(await view({ key: 'A', modes: ['dorian', 'mixolydian'] }), violin)
    expect(rows.find((r) => r.id === 'key')?.text).toBe('A dorian, B part mixolydian')
  })

  it('writes the tuning with its capo', async () => {
    const rows = attributeRows(
      await view({ tunings: { violin: { tuning: 'Open G (gDGBD)', capo: 2 } } }),
      violin,
    )
    expect(rows.find((r) => r.id === 'tuning:violin')?.text).toBe('Open G (gDGBD), capo 2')
  })

  it('leaves an unset attribute null', async () => {
    const rows = attributeRows(await view({}), violin)
    expect(rows.find((r) => r.id === 'genre')?.text).toBeNull()
  })

  it('folds parts into Type on the card', async () => {
    const rows = attributeRows(
      await view({ tune_type: 'Reel', part_structure: 'AABB', genre: 'Old-time' }),
      violin,
    )
    const { shown, more } = cardRows(rows)
    expect(shown.map((r) => r.id)).toEqual(['status', 'key', 'tuning:violin', 'tune_type'])
    expect(shown.find((r) => r.id === 'tune_type')?.text).toBe('Reel · AABB')
    expect(more.map((r) => r.id)).toEqual([
      'time_signature',
      'part_structure',
      'genre',
      'composer',
      'alternate_titles',
      'learned_from',
      'learned_on',
    ])
  })

  it('reads parts alone on the card when the type is empty', async () => {
    const rows = attributeRows(await view({ part_structure: 'AABB' }), violin)
    const type = cardRows(rows).shown.find((r) => r.id === 'tune_type')
    expect(type?.text).toBe('AABB')
  })
})
