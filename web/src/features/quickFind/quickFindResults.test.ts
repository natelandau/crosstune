import { describe, expect, it } from 'vitest'
import { recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { catalogEntries } from '../catalog/filters'
import { MAX_RESULTS } from '../catalog/tuneMatches'
import type { RecordingView } from '../recordings/useRecordings'
import { rankResults, type QuickFindCommand, type QuickFindItem } from './quickFindResults'

const tunes = catalogEntries(
  [
    tuneRow('t1', 'Angeline the Baker'),
    tuneRow('t2', "Baker's Hornpipe"),
    tuneRow('t3', "Soldier's Joy"),
    tuneRow('t4', 'Cluck Old Hen'),
  ],
  [
    userTuneRow('u1', 't1'),
    userTuneRow('u2', 't2'),
    userTuneRow('u3', 't3', { archived_at: '2026-01-01T00:00:00Z' }),
    userTuneRow('u4', 't4'),
  ],
)

const lists = [
  { id: 'l1', name: 'Thursday jam' },
  { id: 'l2', name: 'Contest set' },
]

const recordings: RecordingView[] = [
  {
    recording: recordingRow('r1', { label: 'Porch take' }),
    file: undefined,
    tuneId: null,
    tuneTitle: null,
  },
  {
    recording: recordingRow('r2', { label: null, tune_id: 't3' }),
    file: undefined,
    tuneId: 't3',
    tuneTitle: "Soldier's Joy",
  },
]

const commands: QuickFindCommand[] = [
  { id: 'newTune', label: 'New tune', run: () => {} },
  { id: 'goLists', label: 'Go to Lists', run: () => {} },
]

const rank = (query: string) => rankResults({ query, tunes, lists, recordings, commands })

const titles = (items: QuickFindItem[]) => items.map((item) => item.title)
const section = (query: string, id: string) =>
  rank(query).sections.find((one) => one.id === id)?.items ?? []

describe('rankResults', () => {
  it('puts a title prefix before a word match', () => {
    expect(titles(section('baker', 'tunes'))).toEqual(["Baker's Hornpipe", 'Angeline the Baker'])
  })

  it('gives commands only for an empty query', () => {
    const { sections } = rank('  ')
    expect(sections.map((one) => one.id)).toEqual(['commands'])
    expect(titles(sections[0]!.items)).toEqual(['New tune', 'Go to Lists'])
  })

  it('marks an archived tune', () => {
    const [joy] = section('soldier', 'tunes')
    expect(joy).toMatchObject({ kind: 'tune', tuneId: 't3', archived: true })
    const [hen] = section('cluck', 'tunes')
    expect(hen).toMatchObject({ kind: 'tune', tuneId: 't4', archived: false })
  })

  it('finds lists by name, recordings by label and tune title, and commands by label', () => {
    expect(titles(section('jam', 'lists'))).toEqual(['Thursday jam'])
    expect(section('porch', 'recordings')).toMatchObject([{ kind: 'recording', recordingId: 'r1' }])
    expect(section('soldier', 'recordings')).toMatchObject([
      { kind: 'recording', recordingId: 'r2', tuneId: 't3' },
    ])
    expect(titles(section('lists', 'commands'))).toEqual(['Go to Lists'])
  })

  it('orders sections commands, tunes, lists, recordings, and leaves out empty ones', () => {
    expect(rank('s').sections.map((one) => one.id)).toEqual([
      'commands',
      'tunes',
      'lists',
      'recordings',
    ])
    expect(rank('jam').sections.map((one) => one.id)).toEqual(['lists'])
    expect(rank('zzz').sections).toEqual([])
  })

  it('caps each found section', () => {
    const count = MAX_RESULTS + 3
    const many = catalogEntries(
      Array.from({ length: count }, (_, i) => tuneRow(`m${i}`, `Reel ${i}`)),
      Array.from({ length: count }, (_, i) => userTuneRow(`n${i}`, `m${i}`)),
    )
    const manyLists = Array.from({ length: count }, (_, i) => ({
      id: `l${i}`,
      name: `Reel set ${i}`,
    }))
    const manyRecordings: RecordingView[] = Array.from({ length: count }, (_, i) => ({
      recording: recordingRow(`r${i}`, { label: `Reel take ${i}` }),
      file: undefined,
      tuneId: null,
      tuneTitle: null,
    }))
    const found = rankResults({
      query: 'reel',
      tunes: many,
      lists: manyLists,
      recordings: manyRecordings,
      commands,
    })
    expect(found.sections.map((one) => [one.id, one.items.length])).toEqual([
      ['tunes', MAX_RESULTS],
      ['lists', MAX_RESULTS],
      ['recordings', MAX_RESULTS],
    ])
  })
})
