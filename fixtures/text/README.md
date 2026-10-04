# Text fixtures

`fold.json` pins the fold every client uses to decide that two pieces of
text are the same: `foldText` in `web/src/text/fold.ts` and in
`apple/CrosstuneKit/Sources/CrosstuneVocabulary/TextFold.swift`. Each case
is an `input` and the `key` it folds to, and both clients must produce the
key's exact code units.

The fold, in order:

1. Trim the whitespace JavaScript's `trim()` removes. U+FEFF and U+00A0
   go; U+0085 stays.
2. Decompose to Unicode NFD.
3. Remove every nonspacing mark (General_Category Mn). Spacing marks stay.
4. Lowercase with JavaScript's `toLowerCase()`, which reads no locale.
5. Replace final sigma `ς` with `σ`. Clients disagree on where a word
   ends, and a word must still be found at the start of a longer one.

Two values are the same when their keys are equal. A value whose key is
empty, such as one holding only whitespace or combining marks, is blank:
it is no filter option, matches no filter, and counts in no stats group.

The fold never reads the reader's locale, so `İ` folds to `i` and `ı` stays
`ı` on every device, and `ß` stays apart from `ss`. Letters with a built-in
stroke, such as `ø`, `đ`, and `ł`, have no decomposition, so they do not
match `o`, `d`, and `l`.

Each client ships its own Unicode tables, so a character newer than one
client's tables, such as U+105C9, may fold differently on the two clients.
