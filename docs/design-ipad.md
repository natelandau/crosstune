# Crosstune iPad design rules

iPad at regular width. Read `design.md`, then `design-ios.md`. This page
wins at regular width. A compact iPad window (Slide Over, narrow) takes
only `design-ios.md`. The Mac and iPhone never take a rule from here.

- iPad-only views: `apple/CrosstuneKit/Sources/CrosstuneUI/Pad/`.

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

## Shell

- Root: `TabView` with `.sidebarAdaptable`. iPadOS picks sidebar or top-bar
  form, and the person's toggle wins.
- Settings is a tab at regular width, since the bar has the room the
  phone lacks.
- iPadOS 27 and later: Record is the iPhone's prominent slot. iPadOS 26
  has no prominent role, so Record sits in the bottom bar there.
- A form change keeps every destination's state.

## Bottom bar

- `PadBottomBar`: our own glass capsule, centered at the window's bottom
  edge in every form.
- Holds the iPhone's player accessory while something is loaded, up to
  `PadStyle.bottomBarMaxWidth`. Hidden while a recording's page shows the
  loaded recording.
- Columns leave `PadStyle.bottomBarClearance` under the last row only
  while the capsule shows.
- Fixed height, so its text stops growing at the first accessibility size.

## Columns

- Each tab: a content column (the iPhone screen for that tab) plus a
  detail column.
- Choosing a row never pushes over the content column. It replaces the
  detail page.

## Rows and selection

- iPhone rows at touch sizes. Row controls stay visible with a pointer,
  since a control waiting for hover is invisible without one.
- The row of the recording whose page shows in the detail column is the
  list's selected row, as the open tune's is in the catalog.

## Pages

- Images decode at their drawn size.
- A page fading out takes no taps.

## Recording page

- A recording's page fills the detail column. Practice sits beside the
  attributes column on the page background, as on the Mac. No scans or
  lyrics.
- A column narrower than `RecordingPageArrangement.foldWidth` folds the
  page into the Practice and Details tabs, the Practice tab on
  `practiceBackground`.
- The page, not the practice view, owns the practice visit, so a fold or
  a tab switch keeps practice's state.

## Sheets

- Every `.shellSheet()` sheet is a centered `.form` sheet. Part-height
  sheets keep their detents. Full-screen readers stay full screen.

## Accessibility

- Every target at least 44pt.

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
- Selecting: the column's bottom toolbar holds bulk actions as glyphs named in
  words. Never the top bar: a 360pt column has no room, and iPadOS then
  drops Done.
- Nothing zooms out of the bottom bar: a cover or sheet cannot grow from an
  overlay capsule, and the system accessory, which can, crashes on iPadOS
  26.5.
