# Crosstune Mac design rules

Mac only. Read `design.md` first. This page wins on the Mac where they
differ. iPhone and iPad never take a rule from here.

- Apple's Human Interface Guidelines: native SwiftUI controls, SF Symbols,
  system materials and fonts.
- Mac-only views: `apple/CrosstuneKit/Sources/CrosstuneUI/Mac/`. A Mac
  branch in a shared view never changes iPhone or iPad drawing.

## Tokens

- `MacStyle`: the one source of Mac type and size. Colors from
  `BrandStyle`, shared by every platform.
- A view never types a color, text size, or row height. A glyph's size is
  not a text size.
- Window or scene root carries `.tint(BrandStyle.accent)`. AppKit-drawn
  pieces (list selection, focus rings, default buttons, alerts, menus,
  Settings tabs) ignore tint and take the `AccentColor` asset.
- Five SF Pro roles, never a SwiftUI text style, so every screen draws one
  scale: body 13, secondary 11, section heading 15 semibold, column title
  22 bold, page title 26 bold.
- No Dynamic Type, so no text size setting.
- Pointer density always. Never pad to 44pt.
- `macGlass` is the one glass surface. Reduce Transparency or Increase
  Contrast: opaque slate-tinted fill.
- Depth from glass layers only: sidebar, toolbar, pane controls, dock.

## Shell

- Split view: sidebar, content column, detail column. Unified toolbar, no
  window title text.
- `paneBar` is the one pane-control bar. Every column, detail included,
  puts its controls there, because a Mac toolbar puts a content column's
  trailing items over the detail column.
- Pane control: glass capsule. Glyph-only pane controls share one width.
  Pane bar menus show no chevron. The control that leads its set (a list's
  Play) is a slate capsule.
- Selection: bulk actions take the pane bar's trailing place, as in Finder
  and Mail. A search field in the bar stays, so a query in force stays in
  sight. The toolbar keeps the selecting count.
- `ColumnTitle` with `columnTitled` is the one column title. Controls on
  the title's line move into the pane bar once it scrolls away, so the bar
  adds no empty band at rest.
- View > Sort By carries the showing screen's sort.
- Pane bar search field is the app's own, so it carries the filter control
  trailing. The system field takes no accessory.
- System undo (Cmd-Z, Edit menu) plus a short banner with Undo replaces
  the toast.
- Sidebar slate wash: `MacStyle.sidebarTint`, drawn under the list. A
  container background does not reach the floating sidebar pane.
- A status pick keeps key, sheet filters, and the query. A jump to the
  catalog never clears the status.
- Record: compact glass capsule at the sidebar foot, red dot and "Record".
  Full name and shortcut in its tooltip, so it never truncates.

## Content columns

- Top down: pane bar, column title, filter row, sort header, rows.
  Everything starts at the rows' leading edge.
- Groups take plain headings, never inset cards.
- Filter control sits a step lower than the pane bar, so the bar stays the
  column's chrome.
- Set sheet filter: slate token that removes it. Tokens trail the controls
  on one row while they fit, then wrap.
- Nothing scrolls sideways where it can wrap or spread.
- Files dragged over a column: `DropOverlay`, a slate outline inset under
  the pane bar, never crossing it.

## Rows

- Tune row is one line.
- Playing list row: lighter slate wash in the selection's inset shape.
- On-demand row controls (a list row's Play) reveal through
  `revealedOnHover`. A row reserves trailing room only for those. Every
  other action goes in the context menu.

## Pages

- 32pt margins. Title always in the content, never only in the toolbar.
- Section heading controls are small glass controls. Content 8pt below
  the heading, 28pt between sections.
- Empty section: one quiet line with the way to fill it.
- A page row stops short of the column, so trailing controls stay near the
  title.
- A wrapped middle-dot facts line breaks after a dot, never before.

## Player and practice

- Dock: glass bar, 48pt, across the foot of the detail column, top
  hairline. The page scrolls to its end above it under a soft scroll edge.
  Shows over an empty detail column. Stands down while practice shows.
- Whole dock stays within `PlayerPanel.maxShare` of the detail column. No
  room left: the embed plays on out of sight.
- Scrubber takes keyboard focus. Arrows move it like a slider.
- Practice takes the detail column, not a sheet, so sidebar and list stay
  in reach. A recording clicked in Recordings opens there, paused. The
  dock's expand opens the loaded recording there.
- Opening any tune closes practice. Close shows the tune it covered. Opened
  and closed without a play: nothing stays loaded.
- Practice heading: recording title, page title role. Close and the
  recording's menu in its `paneBar`.

## Recording

- A Mac sheet is its own window, so nothing morphs into it. The opening
  control answers with a symbol effect (Record's bounce).
- A Stop that cannot run dims as a whole disc, never only its label.

## Forms and Settings

- Form: centered sheet, grouped form style, native controls (bordered
  buttons, segmented controls, pop-up buttons). Never the iOS capsule
  fills.
- Closed choice: native pop-up button, except colored values (key pill
  grid).
- Closed choice where re-picking the shown value must register (time
  signature): a menu, drawn as a pull-down, with a plain-text label. A
  picker skips the write on a re-pick.
- Short closed choice can be segmented. Status is one, a segment per word.
  A system segment shows an image or a word, never both. Tunes disagree:
  no segment chosen.
- A segmented control keeps its chosen value visible in an inactive window.
- Settings is a window of tabs, opening on the last tab shown.
- Every Settings tab is one fixed size, and a long tab scrolls. Resizing
  per tab saves the frame during layout, which makes AppKit throw.
- Nothing pushes inside a Settings tab, since a push puts Back among the
  tabs. Deeper screens (stats) open as a sheet.

## Motion

- Motion only shows what changed: a tune arriving, a status changing, the
  dock appearing. Nothing animates under Reduce Motion.
- Status glyph changes by a symbol replace transition.

## Privacy

- `.contentMask()` masks only on iPhone and iPad. Shared views carry it
  anyway, so a view stays one view on every Apple platform.

## Accessibility

- A hidden hover-revealed control fades almost to clear, never fully,
  because SwiftUI drops a fully transparent view from the Mac accessibility
  tree.
- A custom control replacing a native one keeps its keyboard behavior
  under Full Keyboard Access.
