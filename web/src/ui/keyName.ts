/** A key field's and key filter's label. */
export const KEY = 'Key'

/** The name of the key filter and key choice for tunes with no key, shown as a question mark. */
export const UNKNOWN_KEY = 'Unknown key'

const ACCIDENTAL_WORDS = new Map([
  ['#', 'sharp'],
  ['♯', 'sharp'],
  ['b', 'flat'],
  ['♭', 'flat'],
])

/**
 * A key as a screen reader should say it: "F sharp", "B flat". A screen reader reads `#` as
 * "number" and a trailing `b` as a letter, so a pill named by its text alone is misheard.
 * Text that is not a note and one accidental passes through unchanged.
 */
export function spokenKey(key: string): string {
  const text = key.trim()
  const word = ACCIDENTAL_WORDS.get(text.slice(1))
  if (text.length !== 2 || word === undefined || !/^[A-Ga-g]$/.test(text[0]!)) return text
  return `${text[0]!.toUpperCase()} ${word}`
}
