import { AudioLines, Gauge, ListMusic, Music, Settings, type LucideIcon } from 'lucide-react'

export const RECORD_LABEL = 'Start a new recording'
/** The visible word on the Record control, where the full label has no room. */
export const RECORD_TEXT = 'Record'

export interface TabSpec {
  tab: string
  href: string
  label: string
  icon: LucideIcon
}

/** Every destination, in the order the shortcuts and Quick Find list them. */
export const TABS = [
  { tab: 'catalog', href: '/catalog', label: 'Catalog', icon: Music },
  { tab: 'lists', href: '/lists', label: 'Lists', icon: ListMusic },
  { tab: 'recordings', href: '/recordings', label: 'Recordings', icon: AudioLines },
  { tab: 'tuner', href: '/tuner', label: 'Tuner', icon: Gauge },
  { tab: 'settings', href: '/settings', label: 'Settings', icon: Settings },
] as const satisfies readonly TabSpec[]

/** The phone tab bar's destinations, in bar order. Settings opens from the account button. */
export const PHONE_TABS = ['catalog', 'lists', 'tuner', 'recordings'] as const

/** A destination's name, as its tab shows it. */
export const tabLabel = (tab: (typeof TABS)[number]['tab']) =>
  TABS.find((spec) => spec.tab === tab)!.label

/** The phone tab bar's accessible name. */
export const TAB_BAR = 'Tabs'

/** The phone's account button's accessible name: it opens Settings, whatever its initials. */
export const ACCOUNT_BUTTON = tabLabel('settings')
