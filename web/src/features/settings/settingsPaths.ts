/** The settings pages, each its own address under /settings. */
export const SETTINGS_PAGE_IDS = [
  'account',
  'instruments',
  'new-tunes',
  'music-services',
  'recording',
  'appearance',
  'sync',
] as const

export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number]

export const settingsPagePath = (page: SettingsPageId) => `/settings/${page}`

/** The stats page, which Settings opens from its stats block. */
export const SETTINGS_STATS_PATH = '/settings/stats'

/** A tune opened from the stats page. */
export const statsTunePath = (tuneId: string) => `${SETTINGS_STATS_PATH}/tunes/${tuneId}`
