import {
  ArrowDownUp,
  AudioLines,
  Guitar,
  ListPlus,
  Mic,
  RefreshCw,
  SunMoon,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { AudioQuality } from '../../api/vocabulary'
import { SETTINGS_PAGE_IDS, type SettingsPageId } from './settingsPaths'
import { AUDIO_QUALITY_NAMES } from '../../constants'
import { RECORDING } from '../../text/format'
import { APPEARANCE_LABELS, type Appearance } from '../../theme/appearance'
import { MUSIC_SERVICES } from './searchProviders'
import {
  ACCOUNT,
  APPEARANCE,
  IMPORT_AND_EXPORT,
  INSTRUMENTS,
  NEW_TUNES,
  SYNC_AND_STORAGE,
} from './settingsCopy'

/** What the root reads once, so each category's summary is a plain pick from it. */
export interface SettingsValues {
  /** Empty until the settings row has been read, so the row never flashes Not set. */
  instruments: string
  /** The genre a new tune starts with, empty until the settings row has been read. */
  newTunes: string
  services: string
  quality: AudioQuality
  appearance: Appearance
}

export interface SettingsPageSpec {
  id: SettingsPageId
  title: string
  icon: LucideIcon
  summary?: (values: SettingsValues) => string
}

/** Every settings page, in the order the root lists them. */
export const SETTINGS_PAGES: readonly SettingsPageSpec[] = [
  { id: 'account', title: ACCOUNT, icon: UserRound },
  {
    id: 'instruments',
    title: INSTRUMENTS,
    icon: Guitar,
    summary: (values) => values.instruments,
  },
  {
    id: 'new-tunes',
    title: NEW_TUNES,
    icon: ListPlus,
    summary: (values) => values.newTunes,
  },
  {
    id: 'music-services',
    title: MUSIC_SERVICES,
    icon: AudioLines,
    summary: (values) => values.services,
  },
  {
    id: 'recording',
    title: RECORDING,
    icon: Mic,
    summary: (values) => AUDIO_QUALITY_NAMES[values.quality],
  },
  {
    id: 'appearance',
    title: APPEARANCE,
    icon: SunMoon,
    summary: (values) => APPEARANCE_LABELS[values.appearance],
  },
  { id: 'sync', title: SYNC_AND_STORAGE, icon: RefreshCw },
  { id: 'import-export', title: IMPORT_AND_EXPORT, icon: ArrowDownUp },
]

export function isSettingsPage(id: string | undefined): id is SettingsPageId {
  return SETTINGS_PAGE_IDS.some((page) => page === id)
}

export function settingsPageSpec(id: SettingsPageId): SettingsPageSpec {
  return SETTINGS_PAGES.find((page) => page.id === id)!
}
