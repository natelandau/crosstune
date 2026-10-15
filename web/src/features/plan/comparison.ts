import {
  Cloud,
  FileText,
  ListMusic,
  Mic,
  Play,
  RefreshCw,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import {
  FEATURE_CATALOG,
  FEATURE_PLAY,
  FEATURE_PRACTICE,
  FEATURE_RECORD,
  FEATURE_SCANS,
  FEATURE_STORAGE,
  FEATURE_SYNC,
  STORAGE_PREMIUM,
} from './planCopy'

/** What one plan holds of a feature: all of it, none of it, or how much. */
export type Cell = { kind: 'included' } | { kind: 'excluded' } | { kind: 'value'; text: string }

/** One row of the comparison. */
export interface Feature {
  title: string
  /** Shared with the member view's included list where the two name the same feature. */
  icon: LucideIcon
  free: Cell
  premium: Cell
}

const INCLUDED: Cell = { kind: 'included' }
const EXCLUDED: Cell = { kind: 'excluded' }
const value = (text: string): Cell => ({ kind: 'value', text })

/** The pricing spec's Free and Premium table, row for row. */
export const COMPARISON: readonly Feature[] = [
  { title: FEATURE_CATALOG, icon: ListMusic, free: INCLUDED, premium: INCLUDED },
  { title: FEATURE_SYNC, icon: RefreshCw, free: INCLUDED, premium: INCLUDED },
  { title: FEATURE_RECORD, icon: Mic, free: EXCLUDED, premium: INCLUDED },
  { title: FEATURE_PLAY, icon: Play, free: EXCLUDED, premium: INCLUDED },
  { title: FEATURE_PRACTICE, icon: SlidersHorizontal, free: EXCLUDED, premium: INCLUDED },
  { title: FEATURE_SCANS, icon: FileText, free: EXCLUDED, premium: INCLUDED },
  {
    title: FEATURE_STORAGE,
    icon: Cloud,
    free: EXCLUDED,
    premium: value(STORAGE_PREMIUM),
  },
]
