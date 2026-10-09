import { TUNE_LIMITS } from '../../api/vocabulary'
import { foldText } from '../../text/fold'
import type { CatalogEntry } from '../catalog/filters'
import type { PlainListRead } from './plainList'

export const IMPORT_LIMIT = 500

// Many lines that yield one row are likely a list in a shape the reader could not split.
const LONG_SINGLE_ROW_LINES = 20

export type ImportWarning = 'shortened'

export interface ImportRow {
  key: string
  title: string
  source: string
  duplicate: boolean
  included: boolean
  warnings: ImportWarning[]
}

export interface ImportReview {
  rows: ImportRow[]
  dropped: number
  lineCount: number
}

/**
 * Every catalog title and alternate title, folded, for checking many titles at once. A title
 * that folds to nothing names no tune, as `titleMatches` has it, so it is left out.
 */
export function foldedCatalogTitles(catalog: readonly CatalogEntry[]): Set<string> {
  const titles = new Set<string>()
  for (const { tune } of catalog) {
    for (const title of [tune.title, ...tune.alternate_titles]) {
      const folded = foldText(title)
      if (folded !== '') titles.add(folded)
    }
  }
  return titles
}

/**
 * True when the title matches a catalog tune's title or alternate title, archived tunes included,
 * given the catalog's `foldedCatalogTitles`.
 */
export function isDuplicate(title: string, catalogTitles: ReadonlySet<string>): boolean {
  const folded = foldText(title)
  return folded !== '' && catalogTitles.has(folded)
}

/**
 * Turns the candidates into review rows: titles cut to the tune limit, candidates whose titles
 * fold equal merged into the first, duplicates of the catalog unchecked, and rows past the import
 * limit counted in `dropped`. `fixtures/import/review.json` pins the rules for both clients.
 */
export function buildReview(read: PlainListRead, catalog: readonly CatalogEntry[]): ImportReview {
  const catalogTitles = foldedCatalogTitles(catalog)
  const rows: ImportRow[] = []
  const seen = new Set<string>()
  let dropped = 0

  for (const candidate of read.candidates) {
    const points = Array.from(candidate.title)
    const shortened = points.length > TUNE_LIMITS.title
    const title = shortened ? points.slice(0, TUNE_LIMITS.title).join('') : candidate.title

    const folded = foldText(title)
    if (folded !== '') {
      if (seen.has(folded)) continue
      seen.add(folded)
    }

    if (rows.length >= IMPORT_LIMIT) {
      dropped += 1
      continue
    }

    const duplicate = folded !== '' && catalogTitles.has(folded)
    rows.push({
      key: String(rows.length),
      title,
      source: candidate.source,
      duplicate,
      included: !duplicate,
      warnings: shortened ? ['shortened'] : [],
    })
  }

  return { rows, dropped, lineCount: read.lineCount }
}

/**
 * The rows with each duplicate flag checked against the catalog as it is now. The checks stay as
 * the musician left them.
 */
export function markDuplicates(rows: readonly ImportRow[], catalog: readonly CatalogEntry[]) {
  const catalogTitles = foldedCatalogTitles(catalog)
  return rows.map((row) => {
    const duplicate = isDuplicate(row.title, catalogTitles)
    return duplicate === row.duplicate ? row : { ...row, duplicate }
  })
}

/** True when the paste likely held more than the reader could use, so the help is worth showing. */
export function suggestsHelp(review: ImportReview): boolean {
  return (
    review.dropped > 0 ||
    review.rows.some((row) => row.warnings.length > 0) ||
    (review.rows.length === 1 && review.lineCount > LONG_SINGLE_ROW_LINES)
  )
}
