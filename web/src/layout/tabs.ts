import { AudioLines, ListMusic, Music, Settings, type LucideIcon } from 'lucide-react'

export const RECORD_LABEL = 'Start a new recording'
/** The visible word on the Record control, where the full label has no room. */
export const RECORD_TEXT = 'Record'

export interface TabSpec {
  tab: string
  href: string
  label: string
  icon: LucideIcon
}

/** The four destinations, in bar order. The record button sits between the second and third. */
export const TABS = [
  { tab: 'catalog', href: '/catalog', label: 'Catalog', icon: Music },
  { tab: 'lists', href: '/lists', label: 'Lists', icon: ListMusic },
  { tab: 'recordings', href: '/recordings', label: 'Recordings', icon: AudioLines },
  { tab: 'settings', href: '/settings', label: 'Settings', icon: Settings },
] as const satisfies readonly TabSpec[]

/** A destination's name, as its tab shows it. */
export const tabLabel = (tab: (typeof TABS)[number]['tab']) =>
  TABS.find((spec) => spec.tab === tab)!.label

/** The phone tab bar's accessible name. */
export const TAB_BAR = 'Tabs'
