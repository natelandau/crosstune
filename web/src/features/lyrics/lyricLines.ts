/**
 * A lyrics body as verses of lines. A blank line, however many of them a paste carries, is one
 * verse break; every other line is a line of the song, kept as written apart from the whitespace
 * at either end: the reading view renders a line as ordinary text, which collapses an indent
 * anyway, and an indent that survived would read as a wrap.
 */
export function lyricLines(text: string | null | undefined): string[][] {
  if (!text) return []
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
  const verses: string[][] = []
  let verse: string[] = []
  for (const line of lines) {
    if (line === '') {
      if (verse.length > 0) verses.push(verse)
      verse = []
      continue
    }
    verse.push(line)
  }
  if (verse.length > 0) verses.push(verse)
  return verses
}

/** The opening lines, for a row that stands in for the whole body. */
export function lyricOpening(text: string | null | undefined, count: number): string[] {
  // slice(0, count) with a negative count counts back from the end, so it would return every
  // line but the last rather than none.
  return lyricLines(text).flat().slice(0, Math.max(0, count))
}
