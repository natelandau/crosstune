/** Semitones above C for each note name. */
const NOTES = new Map([
  ['C', 0],
  ['D', 2],
  ['E', 4],
  ['F', 5],
  ['G', 7],
  ['A', 9],
  ['B', 11],
])

const ACCIDENTALS = new Map([
  ['', 0],
  ['#', 1],
  ['♯', 1],
  ['b', -1],
  ['♭', -1],
])

/**
 * The pitch class a stored key names, or null when the string is not one.
 *
 * The note is read from the first character and the accidental from the rest, so a leading `b`
 * is the note B while a trailing one is a flat. Mode lives in its own field, so anything past an
 * accidental (`Am`, `Dm7`) is not a key and gets no color rather than a guessed one. Lookups go
 * through a Map so an input such as `Bconstructor` cannot reach an inherited property.
 */
export function pitchClass(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  const note = NOTES.get(text.slice(0, 1).toUpperCase())
  const accidental = ACCIDENTALS.get(text.slice(1))
  if (note === undefined || accidental === undefined) return null
  return (note + accidental + 12) % 12
}
