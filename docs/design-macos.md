# Crosstune Mac design rules

Mac only. Read `design.md` first. This page wins on the Mac where they
differ. iPhone and iPad never take a rule from here.

- Apple's Human Interface Guidelines: native SwiftUI controls, SF Symbols,
  system materials and fonts.
- Mac-only views: `apple/CrosstuneKit/Sources/CrosstuneUI/Mac/`. A Mac
  branch in a shared view never changes iPhone or iPad drawing.

## Color

- `Palette` (`Style/`) is the one source of Apple color, shared with
  iPhone and iPad. `MacStyle` reads it. A view never types a color.
- `surface` also holds the dock and the practice stage.
- Window or scene root carries `.tint(MacStyle.accent)`. AppKit-drawn
  pieces (list selection, focus rings, default buttons, alerts, menus,
  Settings tabs) ignore tint and take the `AccentColor` asset, whose
  universal entries carry Harbor.
- A control reads its container from `macContainer`. A `surface` card or
  footer marks itself with `.macSurfaceContainer()`.
- Every sheet root resets the container to `ground` (`MacSheet`,
  `.shellSheet()`): a sheet takes its presenter's environment, so one
  opened from a card would otherwise draw for the card.
- Cards on `surface` with no stroke.

## Type and density

- `MacStyle`: the one source of Mac type and size. A view never types a
  text size or row height. A glyph's size is not a text size.
- Text takes a `MacStyle` role (body, secondary, label, chip, section
  heading, form title, sheet title, column title, page title, readout,
  timer), all SF Pro, so every screen draws one scale.
- A Mac branch never uses a SwiftUI text style; a test enforces it. Shared
  views take `Font.platform(_:mac:)`, which keeps the text style on iPhone
  and iPad.
- No Dynamic Type, so no text size setting.
- Pointer density always. Never pad to 44pt.

## Depth and glass

- `macGlass` is the one glass surface. Reduce Transparency or Increase
  Contrast: opaque surface fill.
- Glass only on pane bar glyph controls. Never on a content button, the
  sidebar, or the dock.
- Depth from floating chrome only: toolbar, pane bar glyph controls, the
  undo banner, and an overlay over content.
- An overlay over content: `ground` with a soft shadow, no stroke.

## Buttons

- `MacButtonStyle` draws every content button, by role: primary
  (`accentFill`, white), secondary (the container's control fill, ink),
  plain (accent words), quiet (secondary-ink words, for a quiet utility
  such as setting an empty date), icon (secondary-ink glyph, a circle of
  the control fill on hover), destructive (secondary with a danger label),
  destructive filled. Plain and quiet underline on hover.
- An icon button's circle is never under 26pt, so a glyph keeps a pointer
  target at the small size.
- Natural width, never stretched across a sheet or column.
- One primary per surface.
- A primary never turns gray: disabled fades its own fill, and an inactive
  window keeps it. So the style never reads the window's active state.
- Destructive filled only for the final confirm of an irreversible action.
- Why a control is off shows as a secondary caption near it, since a
  pointer cannot learn it from a disabled button.

## Chips

- One chip (`MacChip`) draws a key pill, a choice capsule, a list token, and
  a filter control: capsule, chip font, no 44pt target.
- Row key pills share a minimum width so single letters line up.
- States: rest (`field` and ink, or a key's own hue), chosen (`accentFill`
  and white, or a key's hue with an accent ring), set filter.
- The chosen key's accent ring keeps a line of ground between it and the
  hue: the accent sits too near a chosen hue's lightness to hold 3:1 on
  it.
- A key's hue is the same on every platform. On a selected row the pill
  wears a thin light ring.

## Shell

- Split view: sidebar, content column, detail column. Unified toolbar, no
  window title text.
- Content and detail columns on `ground`, sidebar and dock on `surface`.
- `paneBar` is the one pane-control bar. Every column, detail included,
  puts its controls there, because a Mac toolbar puts a content column's
  trailing items over the detail column.
- Pane control: a glyph control is a glass capsule; glyph-only controls
  share one width. A worded control (Close) is a secondary
  button. Pane bar menus show no chevron. The action that leads a set (a
  list's Play) is a primary button, the one after it (Shuffle) a
  secondary.
- The pane bar keeps its height with nothing in it, and a column's
  controls live there, never on its title's line. So every column's
  content starts at one height.
- `ColumnTitle` with `columnTitled` is the one column title. Every column
  title and the detail page's title set their first baseline on
  `MacStyle.columnTitleBaseline` below the pane bar
  (`columnTitleBaseline(_:size:)`), so titles line up across columns
  whatever their size.
- No toolbar hairline at rest: the window toolbar draws no background, and
  columns take the soft scroll edge, which shows only once content scrolls
  under the bar.
- View > Sort By carries the showing screen's sort.
- `FilterSearchField` is the one search field, in the pane bar and in
  sheets, flat on `field` with no glass. Never `.searchable` on the Mac:
  the system field draws apart from the app's and takes no accessory, and
  this one carries the filter control trailing.
- A column's sheet filters open from the search field's trailing glyph, in
  secondary ink at rest. Once any is set it becomes a set chip with the
  count, on `ground` so the accent label holds 4.5:1.
- The search field fills the bar up to a trailing slot whose width is the
  column's own, sized for its glyph controls. The slot never changes with
  selection or filters, so neither does the field.
- System undo (Cmd-Z, Edit menu) plus a short banner with Undo replaces
  the toast. Banner on `ink`, fitted to its words, lifted above the column
  foot. Undo takes the other appearance's accent, the one that reads on
  ink.
- Sidebar: opaque surface, drawn under the list. A container background
  does not reach the floating sidebar pane.
- Sidebar glyphs: secondary ink at rest, white on the key window's
  selection, read from `backgroundProminence`. A status glyph follows the
  status rule in `design.md`. Counts in tabular figures. A section's add
  control is a plain secondary-ink glyph.
- A status pick keeps key, sheet filters, and the query. A jump to the
  catalog never clears the status.
- Tuner is a sidebar row that fills the content and detail columns as one
  pane (a two-column split). It keeps listening while its window is visible
  without focus, so it works beside another app. It stops when the window
  is minimized, hidden, or closed, or another row is picked.
- Record: a capsule at the sidebar foot on the rows' selection inset. Its
  full name and shortcut go in its tooltip, so it never truncates.

## Selection

- The column title reads the count ("3 selected"), and a selection bar
  replaces the filter row: Select all (plain), one Actions pull-down
  (secondary) holding every bulk action, and Done (primary). Escape ends
  the selection even with the bar scrolled away.
- Rows lead with a checkbox that toggles that tune alone.
- The pane bar keeps its search live and its controls standing down, so
  nothing in it moves.
- The filter row and the selection bar share one height and one offset
  under the title (`MacStyle.columnBarHeight`, `columnBarInsets`). A list
  reserves that block under its title whether it holds the play line, the
  bar, or nothing (`MacListTitle.slotHeight`), and a catalog with tunes
  keeps it empty when no filter row shows, so entering selection never
  moves the rows. A filter row wrapped to two lines hands its height to
  the bar.
- Select lives in the column's More menu and View > Select tunes, plus a
  row's context menu.
- Checkbox: `.macCheckbox`, never AppKit's, which grays in an inactive
  window.

## Content columns

- Top down: pane bar, column title, filter row, sort header, rows.
  Everything starts at the rows' leading edge.
- Groups take plain headings, never inset cards. In a list a heading is a
  row of its own, so the gap above it is row spacing, not the wider gap the
  system puts between sections.
- Every content column is a `macColumnList()` with the same title rhythm.
  Its header line sits under the title; a group never carries the count or
  sort.
- A column's account-wide summary (storage) is a `surface` bar pinned at
  the column foot under a hairline, so it shows however long the list
  runs.
- Storage shows on `MacMeter` wherever it appears, never the accent or the
  system progress bar.
- The filter row holds the Key control and set filters' tokens. With
  nothing to show it is gone, as in an empty catalog. With no tune to
  filter, the search field's filters button stands down too.
- Set sheet filter: accent-washed token that removes it. Tokens trail the
  controls on one row while they fit, then wrap.
- Sort header: count and sort in secondary ink. One chevron after the sort
  both opens its menu and points its direction.
- An empty column shows one onboarding state centered in it. The detail
  column stays blank meanwhile, so the two never repeat each other.
- Nothing scrolls sideways where it can wrap or spread.
- Files dragged over a column: `DropOverlay`, an accent outline inset under
  the pane bar, never crossing it.

## Rows

- Tune row is one line. Tunings and position in secondary ink, white on a
  key window's selection. Whole tunings drop from the end, with a quiet
  count of the rest ("+1"), before the first one truncates; the count
  stays.
- Secondary ink on a selection that is not emphasized (an inactive window,
  an unfocused list) turns to ink, since that gray falls under 4.5:1 with
  secondary ink. The list does not report it, so the row marks itself
  (`macRowSelected`). On that gray the want to learn ring takes the
  darker gray in light and ink in dark, where its gray falls under 3:1.
- Key pills end at the row's trailing edge in every column, so they line
  up between catalog and list.
- Playing list row: an accent wash lighter than a set filter's, in the
  selection's inset shape.
- Media row (recording, link): the state glyph centers on the title's line,
  however many lines follow. Play in ink and a source link in secondary
  ink, each in the accent only under the pointer.
- A note that holds for rows of a group (Stop recording to play) shows once
  under the group's heading, and only when a row there has it; each row
  still speaks it.
- A list row's Play takes the key pill's slot (`ListRowKeySlot`) under the
  pointer, on focus, or while pinned. A row that can do nothing keeps its
  key showing. Every other action goes in the context menu.
- A glyph every row would show alike (a picker's +) shows only under the
  pointer or focus, so a column of them never stands at rest.

## Pages

- Margins and section spacing from `MacStyle`. Title in the page title
  role, always in the content, never only in the toolbar.
- Section heading controls are icon buttons beside their heading (+ adds,
  a pencil edits; never a worded Edit).
- A section, heading included, stops at `pageRowMaxWidth`, so its controls
  and a row's trailing controls stay near the text.
- One leading edge for every section's text. A glyph that leads a line
  (play) hangs in `pageGlyphColumn`, inside the margin.
- A link line is secondary ink, the accent only under the pointer. On a
  selected row it takes the selection's secondary ink, under the pointer
  too.
- A wrapped middle-dot facts line breaks after a dot, never before.
- Tune facts rail threshold: `PageStyle.factsRailWidth +
  PageStyle.contentMinWidth`.
- A fact editor is a popover at its row or the key tile (`factEditor`).

## Player and practice

- Dock: an opaque `surface` bar across the foot of the detail column under
  a hairline. The page scrolls to its end above it. It stands down while
  practice shows.
- Dock play is a disc, never framed to a touch target. A dock glyph that
  toggles a setting is in the accent while the setting is on.
- Whole dock stays within `PlayerPanel.maxShare` of the detail column. No
  room left: the embed plays on out of sight.
- Scrubber takes keyboard focus. Arrows move it like a slider.
- Practice takes the detail column, not a sheet, so sidebar and list stay
  in reach. Opening any tune closes practice.
- Practice follows the appearance, on `ground` with its parts on a
  `surface` stage card and its played waveform in ink tones. The phone's
  dark practice ground would read as a foreign panel beside the sidebar
  and list, and would flip the sheets practice opens.
- Waveforms: `MacWave`. Peaks not yet on hand draw muted placeholder bars,
  never a line.

## Recording

- Stop: a solid `recordingRed` disc with a white label, always. Glass
  tinted red draws gray in a sheet. A Stop that cannot run dims as a
  whole disc, never only its label.
- A sheet's live state is its title. No status line repeats it.

## Sheets

- Sheet: `MacSheet`, never a `NavigationStack` toolbar band. Title in the
  content, optional subtitle in secondary ink, body on `ground`. Footer
  on `surface` under a hairline: leading slot, then Cancel or Close, then
  the one primary trailing. Escape presses Cancel, Return the primary.
- The title of an irreversible step leads with the danger glyph, as an
  alert's icon does.
- Only a sheet that pushes keeps its navigation. A pushed screen draws on
  the same scaffold, Back in the cancel slot, so Escape goes back.
- Sheet height: fitted to the content up to a maximum, past which the body
  scrolls. A picker or long form takes a fixed size and its own scrolling
  (`MacFormScroll` for a form), edge to edge.
- A fitted sheet sets its frame to its measured content, so content that
  arrives after it shows grows the sheet. The window otherwise keeps the
  height the sheet opened at.
- A sheet that switches its content in place takes one fixed height for
  all of it, so a switch never leaves it the wrong size.
- A sheet that can open over Settings (`MacSheetSize.overSettings`) is no
  wider or taller than its window.
- A sheet opens with focus on its primary only when the primary is an
  enabled default. Otherwise it opens on an invisible anchor, so no
  control opens wearing a ring. A field the sheet focuses on appearing
  still takes focus.
- A sheet with no Cancel still dismisses on Escape, and Return presses its
  default action. A sheet that gives Escape its own action, such as a
  picker emptying its search first, takes Escape from Cancel.
- A purchase button is built only by `MacSheetAction.subscribe`, which
  marks it a purchase, so it never becomes the default or first focus. A
  test enforces it.
- A destructive confirm never takes Return.
- Notice: the scaffold's notice variant, its buttons trailing in the
  footer. A notice answered by one button makes it the default and the
  first focus.
- Reading sheet (lyrics, scans): the scaffold's reading variant. Its
  controls sit as icons on the title's line, never in a toolbar, where an
  overflow hides them.
- Picker sheet: Return belongs to the search, so Done is not the default.
- Clerk's sign-in takes a theme built from `Palette` (`AuthPalette.mac`
  into `ClerkTheme.crosstune`). Its input border stays clear: Clerk draws
  that color as a halo around a focused field, so focus shows only as the
  accent border. A dismissible Clerk flow sizes itself on the Mac, so its
  sheet never sets a frame of its own; a narrower one clips it.

## Forms and fields

- Form: `MacSegmentedPicker`, `MacPopUp`, `MacFieldStyle` fields, and
  `MacButtonStyle` buttons. Never the iOS capsule fills.
- Form groups: `MacFormSection`, never a grouped `Form`, which draws a
  second label beside a row's own. A caption ("Mixed", a count) trails on
  the heading's line. Help for the group is its subtitle, in secondary ink
  under the heading; help for one row is that row's second line. Nothing
  floats under a card.
- Rows on a `surface` card, hairlines between, inset at both ends: label
  leading (`MacFormRow`), then the control.
- In a form sheet (`MacFormScroll`) every value leads at one label column,
  as wide as the sheet's widest label: fields fill from it, pop-ups and
  values start on it, a short value (a year) keeps a short field. A
  Settings or filter card keeps its controls trailing, and a switch
  always trails. Off on a light surface card, a switch's track takes the
  hairline edge.
- A control that is its own block (segmented, chips, text editor) sits
  under its heading with no card.
- A clear that acts on a whole section (Clear date) is a small plain
  button on the section's heading line.
- A form whose subject has a name (a tune) opens on a title field in the
  form title role, borderless, no label, the prompt names it, a hairline
  under it that turns accent while typing.
- Field: `.macField`, flat on the control fill, no border, text leading.
  Never a right-aligned free-text field. A field under a heading or row
  label that names it hides its own label (`.labelsHidden()`), or the
  grouped form draws the name twice.
- A field that takes one kind of value (a link) may lead with its glyph
  inside its own padding, never beside it.
- Multiline text: `MacTextArea`. It shows a scroller only once its text
  runs past its last line: the editor's scroll view never hides one on its
  own. A sheet whose body is the editor sets it outside a scroll view, so
  it fills the sheet.
- Focus: a field, the search field, and any control that draws its own
  shape turn the system ring off and draw a 2pt ring in the full accent.
  A lighter ring falls under 3:1 on `field`.
- Closed choice: `MacPopUp`, the one pop-up style: value in secondary ink
  with a small chevron, accent once it narrows a list. Never the system
  picker, except colored values (key pill grid). A row whose choices act
  rather than pick (Clear, Keep) is a `MacPullDown` with the same look.
- Closed choice where re-picking the shown value must register (time
  signature): `MacPopUp` with `reportsRepicks`. Otherwise a pop-up writes
  only a change.
- Short closed choice can be segmented (`MacSegmentedPicker`), chosen
  segment on `accentFill`: the system segment's chosen fill ignores the
  Mac accent. Status is one, a segment per word. Tunes disagree: no
  segment chosen.
- Segmented choices, steppers, and sliders outside a form are the Mac's
  own (`MacSegmented`, `MacStepper`, `MacSlider`), never the system's.
  Each is one keyboard stop that arrows adjust and one adjustable
  VoiceOver element.
- A segmented control keeps its chosen value visible in an inactive window.
- Open vocabulary: the system's text input suggestions under the field.

## Settings

- The reference pitch lives in General.
- Settings is a window of a few tabs, each a subject (General, Account,
  Tunes, Recordings, Import and export). A new setting joins the tab
  whose subject it serves; a new tab only for a new subject.
- The window opens on the last tab shown. A tab that merges or renames
  others maps their stored names to itself; a name no tab has opens
  General.
- A link to a Settings group opens the Settings window on the group's
  tab, and switches tabs when the window is already open.
- The Settings window opens at one size and the musician can drag it
  larger, up to a width cards still read at. Every tab fills the window,
  and a long tab scrolls. A tab never resizes the window: resizing per tab
  saves the frame during layout, which makes AppKit throw.
- Nothing pushes inside a Settings tab, since a push puts Back among the
  tabs. Deeper screens (stats, one saved location) open as a sheet.
- Settings rows: `MacFormSection` cards, each row a `MacSettingsRow`.
  Name leading, its help as a second line in secondary ink under the
  name, control trailing at its own size. Help for a whole group is the
  section's subtitle. The heading holds only the group's name, and a card
  whose one row names it takes none. This replaces `design.md`'s help
  above the rows.
- Row control: a pop-up, a switch, a value in secondary ink, or a worded
  button. A row that opens more is one button: value and chevron
  trailing. A button that opens more (a sheet, a panel) ends in "…".
- Destructive rows come last, alone in their own card. Sign out is an
  ordinary secondary action on the Mac.
- A Settings tab opens with focus on an invisible stop beside its
  content, never a row. Only that stop turns its ring off; every control
  keeps the system ring. A row that is one button turns the system ring
  off and draws an accent ring inset in its card: the system ring wraps
  the whole card.

## Motion

- Motion only shows what changed: a tune arriving, a status changing, the
  dock appearing. Nothing animates under Reduce Motion.
- Status glyph changes by a symbol replace transition.
- A Mac sheet is its own window, so nothing morphs into it. The control
  that opens it answers with a symbol effect.

## Privacy

- `.contentMask()` masks only on iPhone and iPad. Shared views carry it
  anyway, so a view stays one view on every Apple platform.

## Accessibility

- A hidden hover-revealed control fades almost to clear, never fully,
  because SwiftUI drops a fully transparent view from the Mac accessibility
  tree.
- A custom control replacing a native one keeps its keyboard behavior
  under Full Keyboard Access.
