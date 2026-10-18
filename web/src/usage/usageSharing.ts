export const SHARE_USAGE_KEY = 'crosstune.shareUsageData'

/** The choice stored on this device, or null when none is stored or storage cannot be read. */
export function storedSharingChoice(storage?: Storage): boolean | null {
  try {
    const value = (storage ?? localStorage).getItem(SHARE_USAGE_KEY)
    if (value === 'true') return true
    if (value === 'false') return false
    return null
  } catch {
    return null
  }
}

export function setSharingUsage(on: boolean, storage?: Storage): void {
  try {
    ;(storage ?? localStorage).setItem(SHARE_USAGE_KEY, String(on))
  } catch {
    // Storage that cannot be written leaves the choice for this page load only.
  }
}

/**
 * Whether this device reports usage. A stored choice wins. Otherwise the region decides and the
 * answer is stored: on where consent is not required, off where it is. An unknown region, a
 * failed request, or no network leaves the choice unmade, so nothing is stored and sharing is off.
 */
export async function resolveSharingDefault(
  fetchRegion: () => Promise<{ consent_required: boolean | null }>,
  storage?: Storage,
): Promise<boolean> {
  const stored = storedSharingChoice(storage)
  if (stored !== null) return stored
  let consentRequired: boolean | null
  try {
    consentRequired = (await fetchRegion()).consent_required
  } catch {
    return false
  }
  if (consentRequired === null) return false
  // A choice made while the request was in flight outranks the regional default.
  const chosen = storedSharingChoice(storage)
  if (chosen !== null) return chosen
  const on = !consentRequired
  setSharingUsage(on, storage)
  return on
}
