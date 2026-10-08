# Crosstune iPad design rules

Rules every iPad screen at regular width follows, beside the rules in
`design.md` and `design-ios.md`. Where they disagree, this page holds at
regular width. A compact iPad window, such as Slide Over or a narrow window,
takes `design-ios.md` and never a rule from this page. The Mac and the
iPhone never take a rule from this page. A view built only for the iPad
lives in `apple/CrosstuneKit/Sources/CrosstuneUI/Pad/`.

## Principles

These four rules decide a case that the rules below do not name.

1. One language, native forms. The iPad shares the iPhone's rows, zones,
   and tokens, and the Mac's composition and tab order, in the shape
   iPadOS gives it.
2. Two jobs, one tap apart. The library and the Stand are each first-class,
   and the foot capsule moves between them.
3. The detail column always holds a page, never a list, so a musician
   always knows where a tune appears.
4. The Stand gets the boldest design. Everything else stays quiet.

## Tokens

`PadStyle` holds the sizes and proportions only the iPad draws with: the
Stand's pane shares, the scan thumbnail height, and the foot capsule's
metrics. The iPad adds no color. Every color and every other size comes from
`BrandStyle`, `PageStyle`, and `PhoneStyle`, as on the iPhone.

- An iPad view never types a share, a width, or a height of its own. A new
  iPad size is a `PadStyle` value.
- Layout reads the size class, the available width, and the shell's
  environment, never `userInterfaceIdiom`. A column in the split reports a
  compact width, so a view that draws larger in the iPad's split reads
  `inPadSplit`, the one signal for either column of the split, never the
  size class or `detailTune`.
- Coral marks only its iOS places: the practice playhead, every loop
  handle, and the mark.
- Glass is for controls only: bars, the foot capsule, filter capsules, and
  pane controls.

## Shell

The root is a `TabView` with `.sidebarAdaptable`. iPadOS picks the sidebar
form or the top-bar form for the window, and the person's toggle always
wins. At accessibility text sizes the window starts in the top-bar form,
because the sidebar breaks its rows' words there.

- The tabs are Catalog, Recordings, Lists, and Settings. The iPad takes the
  Mac sidebar's order, the library before Lists, not the iPhone tab bar's.
  In the top-bar form these four are the whole bar.
- In the sidebar form, the status rows follow Catalog and the list rows
  follow Lists, each with its absolute count of non-archived tunes. A zero
  count hides. New list follows the list rows. It opens the new list sheet
  and never stays chosen.
- A sidebar row that is not a destination is a `Tab` with
  `.tabPlacement(.sidebarOnly)`, declared in sidebar order. Never wrap such
  rows in a `TabSection`, which draws below every loose tab. iPadOS cannot
  indent a tab, so these rows sit flush with Catalog.
- Out of the sidebar, every sidebar-only row hides, or the top bar keeps the
  last one chosen as an extra item. The rows hide one turn after the form
  changes, because hiding them during the change leaves the columns' top
  inset under the bar.
- A sidebar list row takes the list row's Edit and Delete, in its swipe
  actions and its context menu.
- The sync badge leads the sidebar's header in the sidebar form, and the
  catalog's toolbar in the top-bar form.
- The catalog's filter row keeps its Status capsule in both forms. The
  sidebar's status rows and the capsule write the one stored status filter
  that stats links and the Mac sidebar use, so a status set from anywhere
  shows as both.
- A form change, a rotation, or a resize keeps the tab, the open list, the
  tune in each detail column, the playing item, and each destination's
  scroll place.

## The foot

The foot capsule is the iPad's one app-wide control. It is our own glass
capsule, `PadFoot`, overlaid at the window's foot and centered, in every
form and posture. It is not the system's bottom accessory, which spans only
the detail column in the sidebar form.

- Idle, the capsule hugs Record: a red dot and "Record".
- While something is loaded, the player joins after Record, and the capsule
  grows to at most `PadStyle.footMaxWidth`. The player is the iPhone's
  accessory, with its tap, its skip swipe, and its haptic.
- The capsule hides while a screen is selecting. While a sheet, dialog, or
  file picker shows, Record dims and takes no press.
- Every column leaves `PadStyle.footClearance` under its last row, so the
  last row scrolls above the capsule.
- Record opens the record sheet and keeps the current tab.
- The capsule's height is fixed, so its text stops growing at the first
  accessibility size.

## Columns

Each tab is a two-column split: a content column and a detail column.

- The content column is the iPhone screen for its tab, in the iPhone's
  zones, with a large title that scrolls with the rows.
- The two columns are a fixed pair, with the content column between
  `PadStyle.contentColumnMinWidth` and `PadStyle.contentColumnMaxWidth`.
  Never use a `NavigationSplitView` here: in a narrow portrait window it
  floats the content column over the detail column behind a scrim, and the
  tab view's sidebar is the one sidebar.
- Choosing a row never pushes over the content column. A list's page pushes
  inside the Lists column. A tune page that opens a list shows it on the
  Lists tab.
- The detail column holds a page or a placeholder, never a list. With no
  tune chosen it says "No tune selected" and how to add one: "+" on touch,
  "⌘N" while a hardware keyboard is attached. Settings' detail column says
  "No setting selected" until a category is chosen.
- Settings splits the iPhone's root and pages: the root in the content
  column, the chosen page in the detail column. A row on the root, the
  account card, or the stats card replaces the detail column's page and
  never pushes over the root.
- A grid that scrolls sideways on the iPhone, such as the stats key grid,
  spreads to fit in the iPad's split.

## Rows and selection

Rows are the iPhone's rows at the iPhone's touch sizes. Every target is at
least 44pt, and a row's controls stay visible with a pointer, because a
control that waits for hover is invisible without one.

- While selecting, the column's bottom bar holds the bulk actions as glyphs
  named in words. Select All leads the top bar and Done trails it.
- Never move the bulk actions to the top bar. A 360pt column has no room for
  Select All, the actions, and Done, and iPadOS then drops Done.

## Tune page

The tune page is the iPhone's document, set in the detail column.

- The page is at most `PageStyle.pageMaxWidth` wide, centered in the
  column.
- Scan thumbnails are `PadStyle.scanThumbnailHeight` tall in the detail
  column and wrap into rows. A thumbnail decodes at its drawn size, so it
  never stretches.
- Edit and More sit at the top-trailing edge of the detail column.
- The page on screen holds until the next tune has read, then cross-fades
  to it, so the column never goes blank. The page that fades out takes no
  taps.

## The Stand

The Stand is the practice screen at regular width: practice beside the
playing tune's scans and lyrics. In code and in every label it is still the
practice screen. `Stand` wraps practice, and `StandArrangement` picks the
layout.

- The Stand is a full-screen cover on the jet practice ground in every
  appearance, drawn in the dark scheme.
- In landscape, practice leads at `PadStyle.standPracticeShare` of the width
  and reading trails.
- In portrait, practice stands over reading. Reading takes
  `PadStyle.standReadingShare` of the height while practice's controls fit
  in the rest. If they do not fit, practice grows to the height its controls
  need, and reading gives way down to `PadStyle.standReadingMinShare`.
  Whole controls come before a larger scan.
- At accessibility text sizes the panes stack in landscape too.
- With nothing to read, or with reading hidden, practice takes the whole
  Stand, capped at `PadStyle.standControlsMaxWidth` and centered. Nothing to
  read means no scans and no lyrics, a take that is not filed under a tune,
  or a link with no tune.
- The header's toggle hides or shows the reading pane, and the device
  remembers the choice.
- The panes are one layout whose axis changes, so practice keeps its state
  across a rotation or a hidden pane.
- A link that the app plays itself stands on the same cover, with its music
  card in place of the waveform. A link in its provider's embed opens the
  embed sheet.
- A swipe down, the chevron, or Escape closes the Stand. Escape closes it once
  nothing else is open, as in practice.
- While a list plays, the Stand's header names the list and the tune's place in
  it.

### Reading pane

- A tune with scans and lyrics opens on Scans, with a Scans and Lyrics
  segmented control. A tune with one kind shows it with no control.
- Scans page sideways on their own paper. The first scan shows from the
  start, so a pinch or a double tap zooms it at once. A single tap opens the
  full-window viewer on that scan.
- Lyrics show at the lyrics reader's stored size, on the ground.
- While a list plays, the pane follows the tune the list is on. The last
  tune's pane holds until the next one has read.

## Sheets

- Every sheet marked `.shellSheet()` opens as a centered `.form` sheet,
  the record sheet included. A part-height sheet keeps its detents, and a
  full-screen reader or the Stand stays full screen.
- A sheet's own environment carries the presentation's size class, not the
  window's, so the shell hands the window's width down as
  `windowIsRegular`.

## Motion

Motion goes through the iOS motion gate, `phoneAnimation` and
`phoneTransition`. Under Reduce Motion each moment becomes a cross-fade or
happens at once.

| Moment                    | Motion                                                        |
| ------------------------- | ------------------------------------------------------------- |
| Something starts to play  | The foot capsule grows and the player slides in after Record  |
| Pick a tune               | The page cross-fades once the next tune has read              |
| A list skips on the Stand | The next tune's reading pane pushes in from the trailing edge |
| The Stand rotates         | The panes move to the new arrangement                         |
| Open a reader             | It zooms out of its thumbnail or row on the tune page         |

- Nothing zooms out of the foot capsule. The Stand opens as a plain
  full-screen cover and the record sheet as a plain `.form` sheet, because
  a cover or sheet cannot grow out of an overlay capsule, and the system
  accessory that could crashes on iPadOS 26.5.
- A reader opened from the Stand opens plainly, since nothing behind the
  cover is where it came from.

## Accessibility

- Labels and string constants are the iPhone's and the Mac's.
- Every target is at least 44pt.
- Dynamic Type scales everything. Rows and the filter row wrap as on the
  iPhone, and the Stand stacks its panes.
- Lyric text passes 7:1 on the practice ground in both appearances. A test
  asserts a contrast of at least 7:1 for white, the color lyrics draw in, on
  each ground.
