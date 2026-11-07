/** The region `locale` names once filled out, such as `US` for `en`; null when it names none. */
export function deviceRegion(locale: string = navigator.language): string | null {
  try {
    return new Intl.Locale(locale).maximize().region ?? null
  } catch {
    return null
  }
}
