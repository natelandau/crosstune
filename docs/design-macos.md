# Crosstune Mac design rules

Mac only. Read `design.md` first. This page wins on the Mac where they
differ. iPhone and iPad never take a rule from here.

- Apple's Human Interface Guidelines: SF Symbols, system materials and
  fonts.
- A Mac branch in a shared view never changes iPhone or iPad drawing.
- Every interactive element uses the shared component from
  `CrosstuneDesign/Phone/Controls/` whenever one exists. A Mac look goes
  in that control's Mac branch or a `CrosstuneDesign/Mac/` style, never
  in a screen.
- Focus ring: only after keyboard focus, or on a text field being edited.
  A screen never sets focus or draws a ring. The library control owns it.

## Color

- `pressedOverlay`, Mac only: a press over a fill. Never a hover.

## Type and density

- `MacStyle` is the one source of Mac type and size. A view never types a
  text size or row height. A glyph's size is not a text size.
- Shared views take `Font.platform(_:mac:)`, which keeps the text style on
  iPhone and iPad.
- No Dynamic Type, so no text size setting.

## Glass

- `macGlass`, only on pane bar glyph controls. Never on a content button,
  the sidebar, or the dock.

## Buttons

- Natural width, never stretched across a sheet or column.
- Destructive filled only for the final confirm of an irreversible action.
- Why a control is off shows as a secondary caption near it, since a
  pointer cannot learn it from a disabled button.

## Shell

- A column's controls sit in the pane bar, never on its title's line, so
  every column's content starts at one height.
- Every column's title is `ColumnTitle` with `columnTitled`.
- A menu-bar command (View > Sort By) carries the showing screen's state.

## Columns and selection

- Top down: pane bar, column title, filter row, sort header, rows.
  Everything starts at the rows' leading edge.
- Every content column is a `macColumnList()`.
- Entering selection never moves the rows: the selection bar takes the
  filter row's place at its height.
- While selecting, the pane bar keeps its search live and its controls
  disabled, so nothing in it moves.
- Nothing scrolls sideways where it can wrap or spread.
- An empty column shows one onboarding state centered in it. The detail
  column stays blank meanwhile, so the two never repeat each other.
- Files dragged over a column: `DropOverlay`.
- A note that holds for every row of a group shows once under the group's
  heading. Each row still speaks it.

## Pages

- Section heading controls are icon buttons beside their heading (+ adds,
  a pencil edits, never a worded Edit).
- One leading edge for every section's text.
- A link line is `textSecondary`, the accent only under the pointer.
- A wrapped middle-dot line breaks after a dot, never before.

## Sheets

- Every sheet is a `MacSheet`.
- The title of an irreversible step leads with the danger glyph.
- Only a sheet that pushes keeps its navigation. A pushed screen draws on
  the same scaffold, Back in the cancel slot, so Escape goes back.
- A sheet that switches its content in place takes one fixed height for
  all of it.
- A sheet that can open over Settings (`MacSheetSize.overSettings`) is no
  larger than that window.
- A picker sheet's Return belongs to the search, so Done is not the
  default.

## Forms and fields

- A Settings or filter card keeps its controls trailing, and a switch
  always trails.
- A control that is its own block (segmented, chips, text editor) sits
  under its heading with no card.
- Open vocabulary: the system's text input suggestions under the field.

## Settings

- A window of a few tabs, each a subject. A new setting joins the tab
  whose subject it serves. A new tab only for a new subject. A tab that
  merges or renames others maps their stored names to itself.
- Nothing pushes inside a tab, since a push puts Back among the tabs.
  Deeper screens open as a sheet.
- Rows: `MacFormSection` cards of `MacSettingsRow`. A row that opens more
  is a `MacSettingsLinkRow`.
- Destructive rows come last, alone in their own card.

## Motion

- A Mac sheet is its own window, so nothing morphs into it. The control
  that opens it answers with a symbol effect.

## Accessibility

- A custom control replacing a native one keeps its keyboard behavior
  under Full Keyboard Access.

## Framework limits

SwiftUI and AppKit behavior that a new screen runs into.

- Window or scene root carries `.tint(Palette.textPrimary)`. A view that
  needs the accent names `Palette.accent`, never `.tint`. AppKit-drawn
  pieces (list selection, focus rings, default buttons, alerts, menus,
  Settings tabs) ignore tint and take the `AccentColor` asset, whose
  universal entries carry the accent.
- Every sheet root resets the container to `pageBackground` (`MacSheet`,
  `.shellSheet()`): a sheet takes its presenter's environment, so one
  opened from a card otherwise draws for the card.
- `textSecondary` on a selection that is not emphasized (an inactive
  window, an unfocused list) turns to `textPrimary`, since that gray falls
  under 4.5:1 with `textSecondary`. The list does not report it, so the
  row marks itself (`macRowSelected`).
- `paneBar` is the one pane-control bar. Every column, detail included,
  puts its controls there, because a Mac toolbar puts a content column's
  trailing items over the detail column.
- `FilterSearchField` is the one search field: pane bar, sheets, and
  editors. Never `.searchable` on the Mac: the system field draws apart
  from the app's and takes no accessory, and this one carries the filter
  control trailing.
- Checkbox: `.macCheckbox`, never AppKit's, which grays in an inactive
  window.
- A button style's body reads `isFocused` as false even while its button
  or menu holds focus. A Mac style reads `macButtonFocused`, set by
  `.macButtonFocus()` on the button or menu (`MacFocusEffectOff` and the
  menu helpers apply it).
- A reading sheet puts its controls as icons on the title's line, never in
  a toolbar, where an overflow hides them.
- Form groups: `MacFormSection`, never a grouped `Form`, which draws a
  second label beside a row's own. Help for the group is its subtitle.
  Help for one row is that row's second line.
- Field: `.macField`. Never a right-aligned free-text field. A field under
  a label that names it hides its own (`.labelsHidden()`), or the form
  draws the name twice.
- A hidden hover-revealed control fades almost to clear, never fully,
  because SwiftUI drops a fully transparent view from the Mac accessibility
  tree.
