export const SHARE_USAGE_KEY = 'crosstune.shareUsageData'

/** Whether this device reports usage. On unless the person turned it off; storage that fails reads as on. */
export function isSharingUsage(storage?: Storage): boolean {
  try {
    return (storage ?? localStorage).getItem(SHARE_USAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setSharingUsage(on: boolean, storage?: Storage): void {
  try {
    ;(storage ?? localStorage).setItem(SHARE_USAGE_KEY, String(on))
  } catch {
    // Storage that cannot be written leaves the choice for this page load only.
  }
}
