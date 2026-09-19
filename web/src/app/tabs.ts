import { AudioLines, ListMusic, Music, Settings, type LucideIcon } from 'lucide-react'

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
