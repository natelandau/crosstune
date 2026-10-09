import { formatBytes } from '../../text/format'

export const SIGN_OUT = 'Sign out'
export const ACCOUNT_OFFLINE = 'Signing out and deleting your account need a connection.'
export const SIGNED_IN_OFFLINE = 'Signed in (offline)'
export const TEXT_SIZE_LABEL = 'Text size'
export const THEME_LABEL = 'Theme'
export const QUALITY_LABEL = 'Quality'
/** The Sync group's rows: the sync state, then the recording transfers. */
export const SYNC_STATUS_LABEL = 'Status'
export const TRANSFERS_LABEL = 'Recordings'
export const APPEARANCE_HELP =
  'These apply to this device only. System follows the phone when it switches.'
export const QUALITY_HELP = 'Higher quality makes larger files.'
export const REMOVE_DOWNLOADS = 'Remove downloaded audio'
export const REMOVE_DOWNLOADS_HELP =
  'Frees up space on this device. Your recordings stay in your account and download again when you play them. Anything not yet saved to your account is kept.'
export const ONE_REJECTED = '1 change was rejected by the server and is only on this device.'
export const rejectedChanges = (count: number) =>
  count === 1
    ? ONE_REJECTED
    : `${count} changes were rejected by the server and are only on this device.`
export const SYNC_NOW = 'Sync now'
export const audioOnDevice = (bytes: number) => `${formatBytes(bytes)} of audio on this device`
export const KEEP_OFFLINE_HELP =
  'Your recordings are always saved to your account and show up on every device you sign in on. A recording is kept on this device once you play it here. Turn this on to download every recording ahead of time, so all of them play even with no signal.'

/** Settings group names, which are also the settings pages' titles. */
export const ACCOUNT = 'Account'
export const INSTRUMENTS = 'Instruments'
export const NEW_TUNES = 'New tunes'
export const APPEARANCE = 'Appearance'
export const SYNC = 'Sync'
export const SYNC_AND_STORAGE = 'Sync and storage'
export const IMPORT_AND_EXPORT = 'Import and export'

export const IMPORT_HEADER = 'Import'
export const IMPORT_HELP =
  'Add many tunes at once. You will get a chance to review before Crosstune adds them.'
export const MORE_INFO = 'More info'
export const EXPORT_HEADER = 'Export'
export const EXPORT_HELP =
  'Save your tunes, recordings, and scans to your device in a single zip file.'

export const USAGE_DATA_TITLE = 'Share usage data'
export const USAGE_DATA_HELP =
  'Sends which features you use, never your tunes, notes, or recordings.'

export const aboutLine = (version: string) => `Crosstune ${version}`

export const SETTINGS_CATEGORIES = 'Settings categories'
