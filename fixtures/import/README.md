# Import fixtures

`plain-list.json` pins how a pasted or opened plain-text tune list becomes
candidate titles: `readPlainList` in
`web/src/features/import/plainList.ts` and the reader in
`apple/CrosstuneKit/Sources/CrosstuneCommands/Import/PlainListReader.swift`.
Each case is an `input`, the `titles` it yields in order, and the
`lineCount` of non-blank lines, headings included. Both clients must
produce the same values.

The rules, in order:

1. Split the text on `\r\n`, `\r`, and `\n`.
2. Trim each line with the whitespace JavaScript's `trim()` removes. That
   set, here called whitespace, is exactly U+0009 to U+000D, U+0020,
   U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F,
   U+3000, and U+FEFF. U+0085 is not in it and stays.
3. Skip a blank line. It is not counted.
4. Count every other line in `lineCount`.
5. A line that ends with `:` is a heading. Skip it. A heading is found
   before any marker is stripped.
6. Strip leading markers repeatedly until none match. A marker is a
   bullet (`-`, `*`, `•`, `◦`, `▪`), a number followed by `.` or
   `)`, `#` and a number, or a checkbox (`[ ]`, `[x]`, `[X]`, `☐`,
   `☑`, `✓`, `✔`). A marker counts only when whitespace or the end of
   the line follows it, and the whitespace that follows is stripped with
   it. The whitespace is the set from rule 2, so a non-breaking space, a
   tab, and U+3000 count. Trim the result. A number is ASCII digits `0`
   to `9` only; an Arabic-Indic digit is not a number and stays in the
   title.
7. Split the line on the three-character string space, slash, space
   (`" / "`), scanning left to right without overlap, so each separator
   uses its own characters: `A / / B` is `A` and `/ B`. Trim each part
   and drop the empty ones. Every part carries the trimmed original line
   as its source.

A line whose title is empty after these steps, such as `-` or `1.`,
yields no candidate. A slash without spaces, a dash inside a title,
`---`, a number that starts a title without `.` or `)`, and a
parenthetical all stay in the title.

## review.json

`review.json` pins how candidate titles become review rows: `buildReview`
in `web/src/features/import/review.ts` and the builder in
`apple/CrosstuneKit/Sources/CrosstuneCommands/Import/ImportReview.swift`.
Each case holds a `catalog` of existing tunes (`title`, `alternate_titles`,
`archived`), the `titles` read from a list, and the `expected` rows in
order. Both clients must produce the same rows.

The rules, in order:

1. Cut a title longer than 200 code points to its first 200 code points
   and give the row the warning `shortened`. Count code points, not UTF-16
   units or grapheme clusters. The cut title is not trimmed again, so a
   space at the cut stays. A title of exactly 200 code points is kept
   whole, with no warning.
2. Fold each cut title with the shared fold (`fixtures/text/fold.json`).
   Two candidates whose folded titles are equal become one row, the
   first. Shortening comes first, so two titles that differ only past
   the cut merge. A title that folds to nothing is never merged.
3. A row is a duplicate when its title matches the title or an alternate
   title of any catalog tune under the same fold. Archived tunes count.
   A title that folds to nothing is never a duplicate, and a catalog
   title that folds to nothing matches nothing.
4. A duplicate starts unchecked; every other row starts checked.
5. Keep the first 500 rows after merging. Count the rest in `dropped`.
   A row dropped past the limit still holds its folded title, so a later
   candidate that folds the same merges into it and is not counted
   again.
6. Offer help when any row has a warning, when `dropped` is above zero,
   or when exactly one row came from a list of more than 20 lines.

The cases here hold fewer than 500 titles, so they never reach the
limit. The limit, merging before the limit is counted, and the help rule
are pinned by each client's unit tests instead.
