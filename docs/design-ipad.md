# Crosstune iPad design rules

iPad at regular width. Read `design.md`, then `design-ios.md`. This page
wins at regular width. A compact iPad window (Slide Over, narrow) takes
only `design-ios.md`. The Mac and iPhone never take a rule from here.

## Principles

- iPhone's rows, zones, and tokens. The Mac's composition and tab order.
- Two jobs, one tap apart: the library and a recording's page (practice
  beside the recording's attributes).
- Practice gets the boldest design. Everything else stays quiet.

## Tokens

- `PadStyle`: iPad-only sizes and proportions. The iPad adds no color.
- A view never types a share, width, or height. A new iPad size is a
  `PadStyle` value.
- Layout reads size class, available width, and the shell's environment,
  never `userInterfaceIdiom`.

## Columns

- Columns leave room under the last row only while `PadBottomBar` shows.
- Choosing a row never pushes over the content column. It replaces the
  detail page.

## Rows and selection

- iPhone rows at touch sizes. Row controls stay visible with a pointer,
  since a control waiting for hover is invisible without one.
- The row whose page shows in the detail column is the list's selected
  row.

## Pages

- Images decode at their drawn size.
- A page fading out takes no taps.

## Framework limits

SwiftUI and iPadOS behavior that a new screen runs into.

- A column in the split carries the window's size class, regular however
  narrow the column. A view that draws larger in the split reads
  `inPadSplit`, and one that fits the column reads its width.
- A sheet's environment carries the presentation's size class, not the
  window's. The shell hands the window's width down as `windowIsRegular`.
- Never `NavigationSplitView`: in a narrow portrait window it floats the
  content column over the detail behind a scrim, and the tab view's
  sidebar is the one sidebar. Columns are a fixed pair splitting the width
  evenly, the content column never under `PadStyle.contentColumnMinWidth`.
- Selecting: bulk actions never go in the top bar. A 360pt column has no
  room, and iPadOS then drops Done.
- Nothing zooms out of the bottom bar: a cover or sheet cannot grow from an
  overlay capsule, and the system accessory, which can, crashes on iPadOS
  26.5.
