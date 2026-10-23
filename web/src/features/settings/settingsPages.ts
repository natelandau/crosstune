import {
  ArrowDownUp,
  AudioLines,
  Gauge,
  ListMusic,
  RefreshCw,
  SunMoon,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { AudioQuality } from '../../api/vocabulary'
import { SETTINGS_PAGE_IDS, type SettingsPageId } from './settingsPaths'
import { AUDIO_QUALITY_NAMES } from '../../constants'
import { APPEARANCE_LABELS, type Appearance } from '../../theme/appearance'
import {
  a4Label,
  ACCOUNT,
  APPEARANCE,
  IMPORT_AND_EXPORT,
  RECORDINGS_SETTINGS,
  SYNC_AND_STORAGE,
  TUNER_SETTINGS_TITLE,
  TUNES,
} from './settingsCopy'

/** What the root reads once, so each category's summary is a plain pick from it. */
export interface SettingsValues {
  /**
   * The instruments played, empty until the settings row has been read so the row never flashes
   * Not set.
   */
  instruments: string
  quality: AudioQuality
  appearance: Appearance
  tunerA4Hz: number
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
    id: 'tunes',
    title: TUNES,
    icon: ListMusic,
    summary: (values) => values.instruments,
  },
  {
    id: 'recordings',
    title: RECORDINGS_SETTINGS,
    icon: AudioLines,
    summary: (values) => AUDIO_QUALITY_NAMES[values.quality],
  },
  {
    id: 'appearance',
    title: APPEARANCE,
    icon: SunMoon,
    summary: (values) => APPEARANCE_LABELS[values.appearance],
  },
  {
    id: 'tuner',
    title: TUNER_SETTINGS_TITLE,
    icon: Gauge,
    summary: (values) => a4Label(values.tunerA4Hz),
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
