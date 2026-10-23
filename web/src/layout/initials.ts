/** The first letters of a name's first and last words, uppercased; one word gives one letter. */
export function initials(name: string | null | undefined): string | null {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? []
  const first = words[0]
  if (!first) return null
  const last = words.length > 1 ? words.at(-1)! : ''
  return (firstLetter(first) + firstLetter(last)).toUpperCase()
}

// By code point, so a letter outside the Basic Multilingual Plane is never split in half.
const firstLetter = (word: string) => [...word][0] ?? ''
