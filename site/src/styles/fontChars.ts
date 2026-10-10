// The characters the site's subset fonts keep: Basic Latin, the typographic punctuation the copy
// uses, and the symbols the demos draw. A test fails when a built page uses one outside this set.
export const FONT_CHARS = [
  ...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCodePoint(0x20 + i)),
  ' ', // no-break space
  '·',
  '–',
  '‘',
  '’',
  '“',
  '”',
  '…',
  '•',
  '›',
  '↓',
  '−',
  '▶',
  '♯',
  '♭',
].join('')
