export interface PlainCandidate {
  title: string
  source: string
}

export interface PlainListRead {
  candidates: PlainCandidate[]
  lineCount: number
}

// One marker: a bullet, a number, or a checkbox. It counts only before whitespace or the end of
// the line, so "1952 Waltz" and "-Sally" keep their text.
const LEADING_MARKER = /^(?:[-*•◦▪]|\d+[.)]|#\d+|\[[ xX]\]|[☐☑✓✔])(?:\s+|$)/

// The same rules, in the same order, are in `fixtures/import/README.md`.
export function readPlainList(text: string): PlainListRead {
  const candidates: PlainCandidate[] = []
  let lineCount = 0

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const source = raw.trim()
    if (source === '') continue
    lineCount += 1
    if (source.endsWith(':')) continue

    let line = source
    let next = line.replace(LEADING_MARKER, '').trim()
    while (next !== line) {
      line = next
      next = line.replace(LEADING_MARKER, '').trim()
    }

    for (const part of line.split(' / ')) {
      const title = part.trim()
      if (title !== '') candidates.push({ title, source })
    }
  }

  return { candidates, lineCount }
}
