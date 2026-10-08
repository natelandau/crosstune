# Crosstune Mac design rules

Rules every Mac screen follows, beside the rules in `design.md`. Where the
two pages disagree, this page holds on the Mac. iPhone and iPad never take a
rule from this page. A view built only for the Mac lives in
`apple/CrosstuneKit/Sources/CrosstuneUI/Mac/`, and a Mac branch in a shared
view never changes how iPhone or iPad draw it. The Mac follows Apple's Human
Interface Guidelines for presentation: native SwiftUI controls, SF Symbols,
and system materials and fonts.

## Tokens

`MacStyle` is the one source of Mac type and size, and takes its colors
from `BrandStyle`, which every platform shares. A Mac view never types a
color value, a text size, or a row height of its own. A glyph's size is not
a text size.

- Slate is the accent, lighter in dark mode. It marks every chosen state,
  the selection, focus rings, and default buttons.
- A window or scene root carries `.tint(BrandStyle.accent)`, so slate tints
  the selection, chosen controls, and primary buttons.
- SwiftUI's tint does not reach what AppKit draws itself, such as list
  selection, focus rings, default buttons, alerts, menus, and the Settings
  tabs. The `AccentColor` asset colors those.
- A label on a slate fill is white in light mode and near-black in dark
  mode, because the dark slate is a light color.
- Coral marks only the selected sidebar row's glyph, the playhead of
  anything that plays back, and every loop handle. An editing strip's
  playhead, such as trim's, stays plain. A loop handle is coral whatever
  its loop's color, and the loop's color stays on its band and tab.
- Status, key, loop, and recording colors are the same as on every
  platform.
- Text takes one of five roles, all SF Pro, and never a SwiftUI text style,
  so every screen draws one scale:

  | Role            | Size and weight |
  | --------------- | --------------- |
  | Body            | 13              |
  | Secondary       | 11              |
  | Section heading | 15 semibold     |
  | Column title    | 22 bold         |
  | Page title      | 26 bold         |

- Mac text does not scale with Dynamic Type, so the Mac has no text size
  setting. The light, dark, and system appearance setting applies as
  everywhere.
- Controls are sized for a pointer, never padded to a 44pt touch target: a
  row is 32pt, a sidebar row and a pane control 28pt, a filter control and
  a section heading's control 24pt.
- `macGlass` is the one glass surface. Under Reduce Transparency or
  Increase Contrast it draws an opaque slate-tinted fill instead.
- Depth comes from glass layers only: the sidebar, the toolbar, pane
  controls, and the dock. No row, card, or section casts a shadow.

## Shell and toolbar

The window is a split view: sidebar, content column, detail column. The
toolbar is unified and shows no window title text.

- A control sits over the pane it acts on. A Mac toolbar puts a content
  column's trailing items over the detail column, so every column, the
  detail column included, puts its own controls in its `paneBar`.
  `paneBar` is the one pane-control bar.
- A pane control is a glass capsule. Every glyph-only pane control is the
  same width, so a row of them reads as one set. A menu in the pane bar
  shows no chevron. The control that leads its set, such as a list's Play,
  is a slate capsule.
- A selection's bulk actions take the pane bar's trailing place while the
  selection lasts, as in Finder and Mail. A search field in the bar stays,
  so a query in force stays in sight.
- A column's title is the first row of its list and scrolls with the rows.
  The toolbar shows the title only while that row is scrolled away, so the
  title never reads twice. A selecting column keeps its count in the
  toolbar. `ColumnTitle` with `columnTitled` is the one implementation.
- Controls on the title's line move into the pane bar once the title
  scrolls away, so the bar adds no empty band at rest.
- View > Sort By carries the sort of the screen that shows, when it has
  one.
- A pane bar's search field is the app's own, so it can carry the filter
  control at its trailing edge. The system field takes no accessory.
- System undo, Cmd-Z and the Edit menu, plus a short banner with an Undo
  button, takes the place of a toast.

## Sidebar

- The sidebar takes the slate wash from `MacStyle.sidebarTint`, drawn under
  the list. A container background does not reach the floating sidebar
  pane.
- The catalog's statuses sit indented under Catalog. The sidebar selection
  and the catalog's status filter are one value: Catalog shows every
  status, and a status row sets its status. A status set from anywhere,
  such as a stats link, selects its row, and a jump to the catalog never
  clears it. Key, sheet filters, and the query carry across a status
  pick.
- A count beside a row is absolute: non-archived tunes, whatever the
  filters. The column's header gives the narrowed count. A zero count is
  hidden, as in Mail.
- The selected row's glyph turns coral, except a status glyph, which keeps
  its status color because the color is its meaning.
- Record is a compact glass capsule at the sidebar's foot, a red dot and
  "Record", with the full name and shortcut in its tooltip, so it never
  truncates.

## Content columns

A content column runs, from the top: pane bar, column title, filter row,
sort header, rows.

- Everything above the rows starts at the rows' leading edge.
- Groups take plain headings in the section heading role, never inset
  cards.
- A filter control is a quiet capsule a step lower than the pane bar, so
  the bar stays the column's chrome. It takes the slate wash once it
  narrows the list.
- A facet filter is a pull-down that reads its facet and value: "Key: Any",
  "Key: D". A facet whose values carry color opens a popover of pills,
  because a menu draws its images in one color. Choosing a value closes it.
- A Filters control with nothing to choose leaves the screen, never shows
  disabled. Recordings shows Filters only while an import gives the sources
  something to tell apart or a source is set.
- A set sheet filter is a slate token that removes it. Tokens trail the
  controls on one row while it fits and wrap under them when it does not.
- Nothing scrolls sideways where it can wrap or spread, because a mouse
  scrolls up and down.
- A list reorders by dragging the row and has no grip. Move is in the row's
  context menu and its accessibility actions.
- Files dragged over a column show `DropOverlay`, a slate outline inset
  under the pane bar and never crossing it.

## Rows

- A tune row is one line with no separator: position in a list, status
  glyph, title, tunings in secondary, then the compact key pill at the
  trailing edge, so keys line up down the column.
- The title keeps its width first. Tunings truncate, then drop out, rather
  than shrink to a lone ellipsis.
- A status glyph's word is also its tooltip.
- A selected row takes the soft inset slate highlight and keeps every
  glyph's own color. The row a playing list is on takes a lighter slate
  wash in the same inset shape.
- A recording or link row is two lines: the title in body, the details in
  secondary. An idle play glyph is secondary and the loaded item's glyph
  takes the tint, so the one loaded item stands out.
- A row control used on demand, such as a list row's Play, shows on hover
  and keyboard focus through `revealedOnHover`. Hidden, it keeps its place,
  its tab stop, and its name. A row reserves trailing room only for such a
  control, and every other action goes in its context menu.

## Pages

A page is a view that reads as a document, such as the tune page or stats.

- A page is a scrolling column at most 680pt wide, centered, with 32pt
  margins. Its title is in the page title role, selectable, and in the
  content, never only in the toolbar.
- A section is a heading in the section heading role with its controls
  trailing as small glass controls, then its content 8pt below, with 28pt
  between sections and no card. A heading keeps its height with or without
  controls.
- An empty section says so in one quiet line, with the way to fill it.
- A row on a page stops at a set width short of the column, so its
  trailing controls stay near its title.
- A wrapped line of facts joined by middle dots breaks after a dot, never
  before one.
- Moving to another tune cross-fades. The page on screen stays until the
  next one has read, so the pane never goes blank.
- Stats is a document page. Each block is the simplest chart that shows
  its point: the status split as one bar in the status colors, and each
  breakdown value over a thin slate bar sized by its share.
- A stats breakdown of more than 8 values shows the top 8 and a "Show all"
  row with the full count, which expands it in place.

## Player dock

- The player is a glass bar, 48pt tall, docked edge to edge across the foot
  of the detail column, with a hairline on top. The page scrolls to its end
  above it, under a soft scroll edge.
- The dock shows over the empty detail column too. It stands down while
  the practice view shows, since that view is the player in full.
- An embed or music card grows up out of the bar. The whole dock, bar
  included, stays within `PlayerPanel.maxShare` of the detail column. With
  no room left, the embed plays on out of sight.
- While a list plays, previous, next, shuffle, and repeat join the bar.
- The scrubber is a thin line with a coral playhead. It takes keyboard
  focus, and the arrow keys move it, as they move a slider.
- A link that the app plays itself, such as an Apple Music link through
  MusicKit, starts in the bar like a recording and does not open in full. A
  link in its provider's embed opens in full, because the embed holds its
  only controls.

## Recording

- A Mac sheet is its own window, so nothing morphs from the window into a
  sheet. A control that opens a sheet answers with a symbol effect, such as
  the Record capsule's bounce.
- The practice view takes the detail column, not a sheet, so the sidebar
  and the list stay in reach while the musician practices. A click on a
  recording in Recordings opens it there, paused. The dock's expand opens
  the loaded recording there.
- Opening any tune closes the practice view. Close shows the tune it
  covered. A recording opened and closed without a play leaves nothing
  loaded.
- The recording's title is the practice view's heading, in the page title
  role. Close and the recording's menu sit in its `paneBar`.
- In the recording sheet, a Stop that cannot run dims as a whole disc,
  never only its label.
- The record control and the menu commands that open a sheet stand down
  while a sheet, dialog, or file picker is up. The record control and the
  Record command also stand down while a screen is selecting.

## Forms and Settings

- A form is a centered sheet in the grouped form style. A closed choice is a
  native pop-up button, except where the values carry color, such as the
  key's pill grid.
- A segmented control is allowed for a short closed choice. A tune's status
  is set with one, a segment per word. A system segment shows an image or a
  word, never both, and the words are what a musician chooses by. When
  tunes disagree, no segment is chosen.
- A closed choice where picking the shown value again must register, such
  as time signature, is a menu, which the Mac draws as a pull-down. A picker
  skips the write when the same value is picked again. The menu's label is
  plain text, so only the system's indicator shows.
- A sheet's controls are native Mac controls: bordered buttons, segmented
  controls, and pop-up buttons, not the capsule fills iPhone and iPad use. A
  segmented control keeps the chosen value visible while the window is
  inactive.
- Settings is a window of tabs. It opens on the last tab shown.
- Every Settings tab is the same fixed size, and a long tab scrolls.
  Resizing the window per tab saves its frame during layout, which makes
  AppKit throw.
- Nothing pushes inside a Settings tab, because a push puts Back among the
  tabs. A deeper screen, such as stats, opens as a sheet.

## Motion

- Motion only shows what changed, such as a tune arriving, a status
  changing, or the dock appearing. Nothing animates under Reduce Motion.
- A status glyph changes by a symbol replace transition, so the change of
  shape reads as the change of status.
- Native motion, SwiftUI transitions and symbol effects, may move beyond
  the record control, the live waveform, and a playing list's speaker.

## Privacy

- A shared view that shows what the musician wrote or named carries
  `.contentMask()`, as on iOS. The modifier masks only on iPhone and iPad,
  so a shared view stays one view on every Apple platform.

## Accessibility

- A hidden hover-revealed control fades almost to clear, never fully. SwiftUI
  leaves a fully transparent view out of the Mac accessibility tree.
- Every glyph-only control carries its name as a tooltip as well as its
  accessible name.
- Where a status word shows beside its glyph, the glyph is hidden from
  assistive technology, so the status is not read twice.
- A custom control that replaces a native one keeps the native one's
  keyboard behavior under Full Keyboard Access.
- Slate text passes 4.5:1 on the window in both modes.
