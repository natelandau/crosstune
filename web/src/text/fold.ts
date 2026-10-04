/**
 * The one rule every client uses to decide that two pieces of text are the same, ignoring case,
 * accents, and outer whitespace. It never reads the reader's locale, so every device and the
 * Swift client fold a value to the same key; `fixtures/text/fold.json` pins it. Final sigma
 * becomes plain sigma: engines disagree on where a word ends, and a word's stem must still be found
 * inside a longer word.
 *
 * Ordering is a separate question: lists still sort with a locale collator.
 */
export function foldText(text: string): string {
  return text
    .trim()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replaceAll('\u03c2', '\u03c3')
}

/** True when two values fold to the same key. */
export function sameText(a: string, b: string): boolean {
  return foldText(a) === foldText(b)
}

/** True when the folded needle appears anywhere in the folded haystack. */
export function containsText(haystack: string, needle: string): boolean {
  return foldText(haystack).includes(foldText(needle))
}
