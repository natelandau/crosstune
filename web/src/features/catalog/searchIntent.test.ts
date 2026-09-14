import { describe, expect, it } from 'vitest'
import { songRow, userSongRow } from '../../test/rows'
import { catalogEntries, type CatalogEntry } from './filters'
import { enterAction, searchOutcome, type SearchOutcome } from './searchIntent'

const entries = catalogEntries(
  [
    songRow('s1', "Soldier's Joy"),
    songRow('s2', 'Cluck Old Hen', { alternate_titles: ['Cluckin Hen'] }),
    songRow('s3', 'Ashokan Farewell'),
    songRow('s4', 'Été Waltz'),
  ],
  [
    userSongRow('u1', 's1'),
    userSongRow('u2', 's2'),
    userSongRow('u3', 's3', { archived_at: 't' }),
    userSongRow('u4', 's4'),
  ],
)
const byId = (id: string) => entries.find((e) => e.song.id === id) as CatalogEntry

describe('searchOutcome', () => {
  it('offers nothing for an empty or blank query', () => {
    expect(searchOutcome(entries, entries, '', false)).toEqual({ kind: 'none' })
    expect(searchOutcome(entries, [], '   ', false)).toEqual({ kind: 'none' })
  })

  it('offers another song when a visible song matches the title or an alternate title', () => {
    expect(searchOutcome(entries, [byId('s1')], "soldier's joy", false)).toEqual({
      kind: 'create',
      title: "soldier's joy",
      another: true,
    })
    expect(searchOutcome(entries, [byId('s2')], 'cluckin hen', false)).toEqual({
      kind: 'create',
      title: 'cluckin hen',
      another: true,
    })
  })

  it('ignores case and accents when matching exactly', () => {
    expect(searchOutcome(entries, [byId('s4')], ' ete waltz ', false)).toMatchObject({
      another: true,
    })
  })

  it('points to an archived exact match while archived songs are hidden', () => {
    expect(searchOutcome(entries, [], 'ashokan farewell', false)).toEqual({
      kind: 'create',
      title: 'ashokan farewell',
      another: true,
      hidden: { entry: byId('s3'), reason: 'archived' },
    })
  })

  it('points to an exact match hidden by another filter', () => {
    expect(searchOutcome(entries, [], 'Ashokan Farewell', true)).toMatchObject({
      hidden: { entry: byId('s3'), reason: 'filtered' },
    })
    expect(searchOutcome(entries, [byId('s2')], "SOLDIER'S JOY", false)).toMatchObject({
      hidden: { entry: byId('s1'), reason: 'filtered' },
    })
  })

  it('offers to create the trimmed query when no song matches exactly', () => {
    expect(searchOutcome(entries, [byId('s1')], '  Soldier ', false)).toEqual({
      kind: 'create',
      title: 'Soldier',
      another: false,
    })
  })
})

describe('enterAction', () => {
  const none: SearchOutcome = { kind: 'none' }
  const create: SearchOutcome = { kind: 'create', title: 'Soldier', another: false }
  const hidden: SearchOutcome = {
    kind: 'create',
    title: 'Ashokan Farewell',
    another: true,
    hidden: { entry: byId('s3'), reason: 'archived' },
  }

  it('opens the only visible song whatever the outcome', () => {
    for (const outcome of [none, create, hidden]) {
      expect(enterAction('s', [byId('s1')], outcome)).toEqual({ kind: 'open', songId: 's1' })
    }
  })

  it('creates, opens the hidden match, or blurs when nothing is visible', () => {
    expect(enterAction('s', [], create)).toEqual({ kind: 'create', title: 'Soldier' })
    expect(enterAction('s', [], hidden)).toEqual({ kind: 'open', songId: 's3' })
    expect(enterAction('s', [], none)).toEqual({ kind: 'blur' })
  })

  it('blurs on a blank query even when one song is visible', () => {
    expect(enterAction('  ', [byId('s1')], none)).toEqual({ kind: 'blur' })
  })

  it('only blurs when several songs are visible', () => {
    for (const outcome of [none, create, hidden]) {
      expect(enterAction('o', [byId('s1'), byId('s2')], outcome)).toEqual({ kind: 'blur' })
    }
  })
})
