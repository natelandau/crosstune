import type { Equivalence } from './types'

export interface EquivalenceEntry {
  id: string
  /** The length of one unit. Absent for `tune`, whose unit is the musician's own recordings. */
  unit_ms?: number
  min_ms: number
  max_ms: number
}

/** Curated comparisons for the recorded total, in pick order. The Swift module keeps the same list. */
export const EQUIVALENCES: readonly EquivalenceEntry[] = [
  { id: 'tune', min_ms: 60_000, max_ms: Infinity },
  { id: 'lp_side', unit_ms: 1_320_000, min_ms: 1_320_000, max_ms: 21_600_000 },
  { id: 'boston_dublin', unit_ms: 23_400_000, min_ms: 23_400_000, max_ms: 360_000_000 },
  { id: 'work_week', unit_ms: 144_000_000, min_ms: 144_000_000, max_ms: Infinity },
  { id: 'cross_country', unit_ms: 147_600_000, min_ms: 147_600_000, max_ms: Infinity },
]

const TEMPLATES: Record<string, (n: string, one: boolean, title: string) => string> = {
  tune: (n, one, title) => `About ${n} ${one ? 'time' : 'times'} through ${title}`,
  lp_side: (n, one) => `About ${n} ${one ? 'side' : 'sides'} of an LP`,
  boston_dublin: (n, one) => `About ${n} ${one ? 'flight' : 'flights'} from Boston to Dublin`,
  work_week: (n, one) => `About ${n} working ${one ? 'week' : 'weeks'}`,
  cross_country: (n, one) => `About ${n} ${one ? 'drive' : 'drives'} from New York to Los Angeles`,
}

/** The line under the recorded total. `tuneTitle` names the tune of a `tune` equivalence. */
export function equivalenceText(eq: Equivalence, tuneTitle?: string): string {
  const template = TEMPLATES[eq.id]
  if (!template) throw new Error(`No text for equivalence ${eq.id}`)
  return template(eq.n.toLocaleString('en-US'), eq.n === 1, tuneTitle ?? '')
}
