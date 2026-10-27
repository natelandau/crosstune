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
- A control reads its container from `macContainer`. A `surface` card or
  footer marks itself with `.macSurfaceContainer()`.
- Cards on `surface` with no stroke.

## Type and density

- `MacStyle`: the one source of Mac type and size. A view never types a
  text size or row height. A glyph's size is not a text size.
- Text takes a `MacStyle` role, all SF Pro, so every screen draws one
  scale.
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
  undo banner, and an overlay over content (`pageBackground` with a soft shadow,
  no stroke).

## Buttons and chips

- `MacButtonStyle` draws every content button, by role: primary,
  secondary, plain, quiet, icon, destructive, destructive filled.
- An icon button's circle is never under 26pt, so a glyph keeps a pointer
  target.
- Natural width, never stretched across a sheet or column.
- One primary per surface.
- Destructive filled only for the final confirm of an irreversible action.
- Why a control is off shows as a secondary caption near it, since a
  pointer cannot learn it from a disabled button.
- One chip (`MacChip`) draws a key pill, a choice capsule, a list token,
  and a filter control: capsule, chip font, no 44pt target.

## Shell

- Split view: sidebar, content column, detail column. Unified toolbar, no
  window title text.
- The pane bar keeps its height with nothing in it, and a column's
  controls never sit on its title's line, so every column's content
  starts at one height.
- `ColumnTitle` with `columnTitled` is the one column title. Every title
  sets its first baseline on `MacStyle.columnTitleBaseline` below the pane
  bar, so titles line up across columns whatever their size.
- No toolbar hairline at rest: the window toolbar draws no background, and
  columns take the soft scroll edge, which shows only once content scrolls
  under the bar.
- The search field fills the bar up to a trailing slot sized for the
  column's glyph controls. The slot never changes with selection or
  filters, so neither does the field.
- A menu-bar command (View > Sort By) carries the showing screen's state.
- System undo (Cmd-Z, Edit menu) plus a short banner with Undo replaces
  the toast.

## Columns and selection

- Top down: pane bar, column title, filter row, sort header, rows.
  Everything starts at the rows' leading edge.
- Every content column is a `macColumnList()`. Groups take plain headings,
  never inset cards.
- Selection replaces the filter row with a selection bar of the same
  height and offset (`MacStyle.columnBarHeight`), and a list reserves that
  block whether it holds a row or nothing, so entering selection never
  moves the rows.
- While selecting, the pane bar keeps its search live and its controls
  disabled, so nothing in it moves.
- Nothing scrolls sideways where it can wrap or spread.
- An empty column shows one onboarding state centered in it. The detail
  column stays blank meanwhile, so the two never repeat each other.
- Files dragged over a column: `DropOverlay`, an accent outline inset under
  the pane bar.
- A note that holds for every row of a group shows once under the group's
  heading. Each row still speaks it.
- A glyph every row would show alike shows only under the pointer or
  focus, so a column of them never shows at rest.

## Pages

- Margins and section spacing from `MacStyle`. The title always in the
  content, never only in the toolbar.
- Section heading controls are icon buttons beside their heading (+ adds,
  a pencil edits; never a worded Edit).
- A section stops at `pageRowMaxWidth`, so its controls stay near the
  text.
- One leading edge for every section's text. A glyph that leads a line
  hangs in `pageGlyphColumn`, inside the margin.
- A link line is `textSecondary`, the accent only under the pointer.
- A wrapped middle-dot line breaks after a dot, never before.

## Player and practice

- Practice takes the detail column, not a sheet, so sidebar and list stay
  in reach.
- Practice follows the appearance, on `pageBackground` with a `surface`
  stage card. The phone's dark `practiceBackground` reads as a foreign panel beside
  the sidebar and list, and flips the sheets practice opens.

## Sheets

- Sheet: `MacSheet`, never a `NavigationStack` toolbar band. Title in the
  content, body on `pageBackground`, footer on `surface` under a border: leading
  slot, then Cancel or Close, then the one primary trailing. Escape
  presses Cancel, Return the primary.
- The title of an irreversible step leads with the danger glyph.
- Only a sheet that pushes keeps its navigation. A pushed screen draws on
  the same scaffold, Back in the cancel slot, so Escape goes back.
- Height: fitted to the content up to a maximum, past which the body
  scrolls.
- A sheet that switches its content in place takes one fixed height for
  all of it.
- A sheet that can open over Settings (`MacSheetSize.overSettings`) is no
  larger than that window.
- A sheet with no Cancel still dismisses on Escape. A sheet that gives
  Escape its own action takes Escape from Cancel.
- A purchase button is built only by `MacSheetAction.subscribe`, which
  marks it a purchase, so it never becomes the default or first focus. A
  test enforces it.
- A destructive confirm never takes Return.
- A picker sheet's Return belongs to the search, so Done is not the
  default.

## Forms and fields

- Form: `MacSegmentedPicker`, `MacPopUp`, `MacFieldStyle` fields, and
  `MacButtonStyle` buttons. Never the iOS capsule fills.
- In a form sheet (`MacFormScroll`) every value leads at one label column,
  as wide as the sheet's widest label. A Settings or filter card keeps its
  controls trailing, and a switch always trails.
- A control that is its own block (segmented, chips, text editor) sits
  under its heading with no card.
- Multiline text: `MacTextArea`.
- Focus: a field and any control that draws its own shape turn the system
  ring off and draw a 2pt ring in the full accent. A lighter ring falls
  under 3:1 on `field`.
- Closed choice: `MacPopUp`, never the system picker, except colored values.
  A row whose choices act rather than pick is a `MacPullDown`.
- Segmented choices, steppers, and sliders outside a form are the Mac's
  own (`MacSegmented`, `MacStepper`, `MacSlider`). Each is one keyboard stop
  that arrows adjust and one adjustable VoiceOver element, and keeps its
  value visible in an inactive window.
- Open vocabulary: the system's text input suggestions under the field.

## Settings

- A window of a few tabs, each a subject. A new setting joins the tab
  whose subject it serves; a new tab only for a new subject. A tab that
  merges or renames others maps their stored names to itself.
- Nothing pushes inside a tab, since a push puts Back among the tabs.
  Deeper screens open as a sheet.
- Rows: `MacFormSection` cards of `MacSettingsRow`. Name leading, its help
  as a second line under it, control trailing. This replaces `design.md`'s
  help above the rows.
- A row that opens more is one button, value and chevron trailing. A
  button that opens a sheet or panel ends in "…".
- Destructive rows come last, alone in their own card.

## Motion

- Motion only shows what changed. Nothing animates under Reduce Motion.
- A Mac sheet is its own window, so nothing morphs into it. The control
  that opens it answers with a symbol effect.

## Privacy

- `.contentMask()` masks only on iPhone and iPad. Shared views carry it
  anyway, so a view stays one view on every Apple platform.

## Accessibility

- A custom control replacing a native one keeps its keyboard behavior
  under Full Keyboard Access.

## Framework limits

SwiftUI and AppKit behavior that a new screen runs into.

- Window or scene root carries `.tint(Palette.accent)`. AppKit-drawn
  pieces (list selection, focus rings, default buttons, alerts, menus,
  Settings tabs) ignore tint and take the `AccentColor` asset, whose
  universal entries carry the accent.
- Every sheet root resets the container to `pageBackground` (`MacSheet`,
  `.shellSheet()`): a sheet takes its presenter's environment, so one
  opened from a card otherwise draws for the card.
- `textSecondary` on a selection that is not emphasized (an inactive
  window, an unfocused list) turns to `textPrimary`, since that gray falls
  under 4.5:1 with `textSecondary`. The list does not report it, so the row marks itself
  (`macRowSelected`).
- `paneBar` is the one pane-control bar. Every column, detail included,
  puts its controls there, because a Mac toolbar puts a content column's
  trailing items over the detail column.
- `FilterSearchField` is the one search field, in the pane bar and in
  sheets. Never `.searchable` on the Mac: the system field draws apart
  from the app's and takes no accessory, and this one carries the filter
  control trailing.
- Checkbox: `.macCheckbox`, never AppKit's, which grays in an inactive
  window.
- A reading sheet puts its controls as icons on the title's line, never in
  a toolbar, where an overflow hides them.
- Form groups: `MacFormSection`, never a grouped `Form`, which draws a
  second label beside a row's own. Help for the group is its subtitle;
  help for one row is that row's second line.
- Field: `.macField`, flat on the control fill, no border, text leading.
  Never a right-aligned free-text field. A field under a label that names
  it hides its own (`.labelsHidden()`), or the form draws the name twice.
- A hidden hover-revealed control fades almost to clear, never fully,
  because SwiftUI drops a fully transparent view from the Mac accessibility
  tree.
