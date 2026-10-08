# Crosstune iPad design rules

iPad at regular width. Read `design.md`, then `design-ios.md`. This page
wins at regular width. A compact iPad window (Slide Over, narrow) takes
only `design-ios.md`. The Mac and iPhone never take a rule from here.

- iPad-only views: `apple/CrosstuneKit/Sources/CrosstuneUI/Pad/`.

## Principles

- iPhone's rows, zones, and tokens. The Mac's composition and tab order.
- Two jobs, one tap apart: the library and the Stand. The foot capsule
  moves between them.
- The Stand gets the boldest design. Everything else stays quiet.

## Tokens

- `PadStyle`: iPad-only sizes and proportions (Stand shares, scan
  thumbnail height, foot metrics). The iPad adds no color.
- A view never types a share, width, or height. A new iPad size is a
  `PadStyle` value.
- Layout reads size class, available width, and the shell's environment,
  never `userInterfaceIdiom`.
- A column in the split reports compact width. A view that draws larger in
  the split reads `inPadSplit`, never the size class or `detailTune`.
- A sheet's environment carries the presentation's size class, not the
  window's. The shell hands the window's width down as `windowIsRegular`.

## Shell

- Root: `TabView` with `.sidebarAdaptable`. iPadOS picks sidebar or top-bar
  form, and the person's toggle wins. At accessibility text sizes the
  window starts in top-bar form, because the sidebar breaks its rows'
  words.
- Top-bar form: the four tabs are the whole bar.
- Sidebar form: status rows follow Catalog, list rows follow Lists, then
  New list, which opens its sheet and never stays chosen.
- A sidebar row that is not a destination is a `Tab` with
  `.tabPlacement(.sidebarOnly)`, declared in sidebar order. Never in a
  `TabSection`, which draws below every loose tab. iPadOS cannot indent a
  tab, so these rows sit flush with Catalog.
- Leaving sidebar form: sidebar-only rows hide, or the top bar keeps the
  last chosen as an extra item. They hide one turn after the form change,
  because hiding during it leaves the columns' top inset under the bar.
- A sidebar list row takes Edit and Delete in swipe actions and context
  menu.
- Sync badge: sidebar header in sidebar form, catalog toolbar in top-bar
  form.
- The catalog keeps its Status capsule in both forms.
- A form change also keeps the open list and each destination's tune.

## The foot

- `PadFoot`: our own glass capsule, the iPad's one app-wide control,
  centered at the window foot in every form. Never the system bottom
  accessory, which spans only the detail column in sidebar form.
- Idle: Record only (red dot, "Record"). Loaded: the iPhone's player
  accessory joins after Record, with its tap, skip swipe, and haptic, up to
  `PadStyle.footMaxWidth`.
- Hidden while selecting. Behind a sheet, dialog, or file picker, Record
  dims and takes no press.
- Columns leave `PadStyle.footClearance` under the last row.
- Fixed height, so its text stops growing at the first accessibility size.

## Columns

- Each tab: content column plus detail column.
- Content column: the iPhone screen for its tab, iPhone zones, large title
  scrolling with the rows.
- Fixed pair. Content column between `PadStyle.contentColumnMinWidth` and
  `PadStyle.contentColumnMaxWidth`. Never `NavigationSplitView`: in a narrow
  portrait window it floats the content column over the detail behind a
  scrim, and the tab view's sidebar is the one sidebar.
- Choosing a row never pushes over the content column. A list's page pushes
  inside the Lists column. A list opened from a tune page shows on the
  Lists tab.
- Detail placeholder: "+" on touch, "⌘N" with a hardware keyboard.
- Settings: root in the content column, page in the detail column. A root
  row, account card, or stats card replaces the detail page, never pushes
  over the root.
- A grid that scrolls sideways on iPhone spreads to fit in the split.

## Rows and selection

- iPhone rows at touch sizes. Row controls stay visible with a pointer,
  since a control waiting for hover is invisible without one.
- Selecting: the column's bottom bar holds bulk actions as glyphs named in
  words. Select All leads the top bar, Done trails. Never move the actions
  to the top bar: a 360pt column has no room, and iPadOS then drops Done.

## Tune page

- The iPhone's document, centered in the detail column.
- Scan thumbnails `PadStyle.scanThumbnailHeight` tall, wrapping into rows,
  decoded at drawn size.
- Edit and More at the detail column's top-trailing edge.
- The fading-out page takes no taps.

## The Stand

Practice at regular width, beside the playing tune's scans and lyrics.
Labels and code still call it practice. `Stand` wraps practice,
`StandArrangement` picks the layout.

- Full-screen cover on the jet practice ground, dark scheme.
- Landscape: practice leads at `PadStyle.standPracticeShare`, reading
  trails.
- Portrait: practice over reading. Reading takes
  `PadStyle.standReadingShare` while practice's controls fit, then gives
  way down to `PadStyle.standReadingMinShare`. Whole controls beat a larger
  scan.
- Accessibility text sizes: panes stack in landscape too.
- Nothing to read (no scans or lyrics, unfiled take, link with no tune) or
  reading hidden: practice takes the Stand, capped at
  `PadStyle.standControlsMaxWidth`, centered.
- Header toggle hides or shows reading. The device remembers it.
- One layout whose axis changes, so practice keeps state across rotation
  and a hidden pane.
- A link the app plays itself stands on the same cover, its music card in
  place of the waveform. A provider embed opens the embed sheet.
- Swipe down, the chevron, or Escape closes it. Escape only once nothing
  else is open.
- List playing: header names the list and the tune's place in it.

### Reading pane

- Scans and lyrics: opens on Scans, with a Scans and Lyrics segmented
  control. One kind: no control.
- Scans page sideways on their own paper. The first shows from the start,
  so a pinch or double tap zooms at once. A single tap opens the
  full-window viewer.
- Lyrics at the lyrics reader's stored size.
- List playing: follows the list's tune. The old pane holds until the next
  has read.

## Sheets

- Every `.shellSheet()` sheet, record sheet included, is a centered `.form`
  sheet. Part-height sheets keep their detents. Full-screen readers and the
  Stand stay full screen.

## Motion

- Starts to play: the foot grows and the player slides in after Record.
- A list skips on the Stand: the next reading pane pushes in from the
  trailing edge.
- Rotation: panes move to the new arrangement.
- Nothing zooms out of the foot. The Stand and record sheet open plainly,
  because a cover or sheet cannot grow from an overlay capsule, and the
  system accessory that could crashes on iPadOS 26.5.
- A reader opened from the Stand opens plainly, since its source is behind
  the cover.

## Accessibility

- Every target at least 44pt.
- Lyric text (white) passes 7:1 on the practice ground in both appearances.
  A test asserts it.
