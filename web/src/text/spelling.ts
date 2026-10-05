import { foldText } from './fold'

/** Code point order, never a locale collator, so the Swift client orders the same. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The trimmed spelling, or null for a value the fold calls blank. */
export function heldSpelling(value: string | null | undefined): string | null {
  const spelling = value?.trim()
  return spelling && foldText(spelling) !== '' ? spelling : null
}

export interface FoldGroup<T> {
  /** The spelling most members hold, ties to the first in code point order. */
  shown: string
  members: T[]
}

/**
 * Items grouped the way the catalog filter matches their trimmed spelling, so a group's shown
 * spelling filters to exactly its members. A blank spelling joins no group.
 */
export function groupByFold<T>(
  items: readonly T[],
  spellingOf: (item: T) => string | null | undefined,
): FoldGroup<T>[] {
  const groups = new Map<string, { spellings: Map<string, number>; members: T[] }>()
  for (const item of items) {
    const spelling = heldSpelling(spellingOf(item))
    if (spelling === null) continue
    const key = foldText(spelling)
    const group = groups.get(key) ?? { spellings: new Map<string, number>(), members: [] }
    groups.set(key, group)
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1)
    group.members.push(item)
  }
  return [...groups.values()].map(({ spellings, members }) => {
    const [shown] = [...spellings].sort(([a, x], [b, y]) => y - x || compareText(a, b))
    return { shown: shown![0], members }
  })
}
