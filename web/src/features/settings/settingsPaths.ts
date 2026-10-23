/** The settings pages, each its own address under /settings. */
export const SETTINGS_PAGE_IDS = [
  'account',
  'tunes',
  'recordings',
  'appearance',
  'sync',
  'import-export',
] as const

export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number]

export const settingsPagePath = (page: SettingsPageId) => `/settings/${page}`

/** The groups an address can open a page at, each the id of its group's region. */
export const SETTINGS_GROUPS = {
  plan: 'plan',
  instruments: 'instruments',
  newTunes: 'new-tunes',
  musicServices: 'music-services',
  recording: 'recording',
  savedLocations: 'saved-locations',
} as const

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[keyof typeof SETTINGS_GROUPS]

/** A page scrolled to one of its groups, so a link to a group lands on it. */
export const settingsGroupPath = (page: SettingsPageId, group: SettingsGroupId) =>
  `${settingsPagePath(page)}#${group}`

/** Where an old address's setting now lives: a page, and the group on it. */
export interface SettingsGroupAddress {
  page: SettingsPageId
  group: SettingsGroupId
}

/**
 * Pages that once had their own address, each now a group of the page named here. Their
 * addresses redirect to that group, so a bookmark or a link from an older build still opens the
 * setting.
 */
export const LEGACY_SETTINGS_PAGES: Record<string, SettingsGroupAddress> = {
  instruments: { page: 'tunes', group: SETTINGS_GROUPS.instruments },
  'new-tunes': { page: 'tunes', group: SETTINGS_GROUPS.newTunes },
  'music-services': { page: 'tunes', group: SETTINGS_GROUPS.musicServices },
  recording: { page: 'recordings', group: SETTINGS_GROUPS.recording },
  'saved-locations': { page: 'recordings', group: SETTINGS_GROUPS.savedLocations },
}

/** The page and group an old address's setting moved to, or undefined for any other address. */
export function legacySettingsGroup(id: string | undefined): SettingsGroupAddress | undefined {
  return id !== undefined && Object.hasOwn(LEGACY_SETTINGS_PAGES, id)
    ? LEGACY_SETTINGS_PAGES[id]
    : undefined
}

/** The segment between the Recordings page and a saved location's ID. */
export const SAVED_LOCATIONS_SEGMENT = 'locations'

/** One saved location, opened from the Recordings page. */
export const savedLocationPath = (placeId: string) =>
  `${settingsPagePath('recordings')}/${SAVED_LOCATIONS_SEGMENT}/${placeId}`

/** The stats page, which Settings opens from its stats block. */
export const SETTINGS_STATS_PATH = '/settings/stats'

/** A tune opened from the stats page. */
export const statsTunePath = (tuneId: string) => `${SETTINGS_STATS_PATH}/tunes/${tuneId}`
