import { describe, expect, test } from 'vitest'
import cases from '../../../../fixtures/import/review.json'
import { tuneRow, userTuneRow } from '../../test/rows'
import type { CatalogEntry } from '../catalog/filters'
import type { PlainListRead } from './plainList'
import {
  buildReview,
  foldedCatalogTitles,
  IMPORT_LIMIT,
  isDuplicate,
  suggestsHelp,
  type ImportReview,
  type ImportRow,
} from './review'

interface CatalogCase {
  title: string
  alternate_titles: string[]
  archived: boolean
}

function entries(catalog: CatalogCase[]): CatalogEntry[] {
  return catalog.map((c, i) => ({
    tune: tuneRow(`t${i}`, c.title, { alternate_titles: c.alternate_titles }),
    userTune: userTuneRow(`u${i}`, `t${i}`, {
      archived_at: c.archived ? '2026-01-02T00:00:00.000Z' : null,
    }),
  }))
}

function readOf(titles: string[], lineCount = titles.length): PlainListRead {
  return { candidates: titles.map((title) => ({ title, source: title })), lineCount }
}

function review(rows: Partial<ImportRow>[], extra: Partial<ImportReview> = {}): ImportReview {
  return {
    rows: rows.map((r, i) => ({
      key: String(i),
      title: `Tune ${i}`,
      source: `Tune ${i}`,
      duplicate: false,
      included: true,
      warnings: [],
      ...r,
    })),
    dropped: 0,
    lineCount: rows.length,
    ...extra,
  }
}

describe('buildReview', () => {
  // The Swift client reads the same file, so both clients build the same rows.
  test.each(cases)('$name', (c) => {
    const built = buildReview(readOf(c.titles), entries(c.catalog))
    expect(
      built.rows.map((r) => ({ title: r.title, duplicate: r.duplicate, warnings: r.warnings })),
    ).toEqual(c.expected)
    expect(built.rows.map((r) => r.included)).toEqual(c.expected.map((r) => !r.duplicate))
    expect(built.rows.map((r) => r.key)).toEqual(c.expected.map((_, i) => String(i)))
  })

  test('drops rows past the limit', () => {
    const titles = Array.from({ length: IMPORT_LIMIT + 1 }, (_, i) => `Tune ${i}`)
    const built = buildReview(readOf(titles), [])
    expect(built.rows).toHaveLength(IMPORT_LIMIT)
    expect(built.dropped).toBe(1)
  })

  test('counts the limit after merging', () => {
    const titles = [...Array.from({ length: IMPORT_LIMIT }, (_, i) => `Tune ${i}`), 'tune 0']
    const built = buildReview(readOf(titles), [])
    expect(built.rows).toHaveLength(IMPORT_LIMIT)
    expect(built.dropped).toBe(0)
  })

  test('merges a later copy of a dropped row instead of dropping it again', () => {
    const titles = [
      ...Array.from({ length: IMPORT_LIMIT }, (_, i) => `Tune ${i}`),
      'Extra',
      'extra',
    ]
    const built = buildReview(readOf(titles), [])
    expect(built.rows).toHaveLength(IMPORT_LIMIT)
    expect(built.dropped).toBe(1)
  })

  test('carries the source line and the line count', () => {
    const built = buildReview({ candidates: [{ title: 'A', source: 'A / B' }], lineCount: 3 }, [])
    expect(built.rows[0]?.source).toBe('A / B')
    expect(built.lineCount).toBe(3)
  })
})

describe('suggestsHelp', () => {
  test('a warning suggests help', () => {
    expect(suggestsHelp(review([{}, { warnings: ['shortened'] }]))).toBe(true)
  })

  test('dropped rows suggest help', () => {
    expect(suggestsHelp(review([{}, {}], { dropped: 1 }))).toBe(true)
  })

  test('one row from 21 lines suggests help', () => {
    expect(suggestsHelp(review([{}], { lineCount: 21 }))).toBe(true)
  })

  test('one row from 20 lines does not', () => {
    expect(suggestsHelp(review([{}], { lineCount: 20 }))).toBe(false)
  })

  test('a clean list of several rows does not', () => {
    expect(suggestsHelp(review([{}, {}, {}], { lineCount: 30 }))).toBe(false)
  })
})

describe('isDuplicate', () => {
  const catalog = foldedCatalogTitles(
    entries([{ title: 'Fête', alternate_titles: [], archived: false }]),
  )

  test('follows an edited title', () => {
    expect(isDuplicate('Fete', catalog)).toBe(true)
    expect(isDuplicate('Other', catalog)).toBe(false)
  })

  test('a blank title is never a duplicate', () => {
    expect(isDuplicate('', catalog)).toBe(false)
    expect(isDuplicate('   ', catalog)).toBe(false)
    const blank = entries([{ title: '', alternate_titles: [], archived: false }])
    expect(isDuplicate('', foldedCatalogTitles(blank))).toBe(false)
  })
})
