# Crosstune Mac design rules

Mac only. Read `design.md` first. This page wins on the Mac where they
differ. iPhone and iPad never take a rule from here.

- Follow Apple's Human Interface Guidelines: SF Symbols, system
  materials and fonts.
- A Mac branch in a shared view never changes iPhone or iPad drawing.
- Focus ring: only after keyboard focus, or on a text field being edited.
  A screen never draws a ring.

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

- Every column, detail included, puts its controls in `paneBar`, never
  on its title's line or in the toolbar. A Mac toolbar puts a content
  column's trailing items over the detail column.
- A content column's title is `ColumnTitle`, with `columnTitled` on its
  list. A detail column's title is its page's title.
- A menu-bar command (View > Sort By) carries the showing screen's state.

## Columns and selection

- Every content column is a `macColumnList()`.
- Entering selection never moves the rows: the selection bar takes the
  filter row's place at its height.
- While selecting, the pane bar keeps its search live and its controls
  disabled, so nothing in it moves.
- Nothing scrolls sideways where it can wrap or spread.
- Files dragged over a column: `DropOverlay`.
- A note that holds for every row of a group shows once under the group's
  heading. Each row's accessibility label still includes it.

## Pages

- Section heading controls are icon buttons beside their heading (+ adds,
  a pencil edits, never a worded Edit).
- One leading edge for every section's text.
- A link line is `textSecondary`, the accent only under the pointer.
- A wrapped middle-dot line breaks after a dot, never before.
- System undo (Cmd-Z) plus a short banner with Undo replaces the toast.

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

- A Settings tab that merges or renames others maps their stored names
  to itself.
- Nothing pushes inside a tab, since a push puts Back among the tabs.
  Deeper screens open as a sheet.
- Rows: `MacFormSection` cards of `MacSettingsRow`. A row that opens more
  is a `MacSettingsLinkRow`.
- Destructive rows come last, alone in their own card.

## Motion

- A Mac sheet is its own window, so nothing zooms into it. The control
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
- `textSecondary` on an unemphasized selection (an inactive window, an
  unfocused list) fails contrast. The list does not report that state, so
  the row marks itself with `macRowSelected` and draws `textPrimary`.
- `FilterSearchField` is the one search field: pane bar, sheets, and
  editors. Never `.searchable`.
- A button style's body reads `isFocused` as false even while its button
  or menu holds focus. A Mac style reads `macButtonFocused`, set by
  `.macButtonFocus()` on the button or menu (`MacFocusEffectOff` and the
  menu helpers apply it).
- Unlike a column, a reading sheet puts its controls as icons on the
  title's line, never in a toolbar, where an overflow hides them.
- Form groups: `MacFormSection`, never a grouped `Form`, which draws a
  second label beside a row's own.
- Field: `.macField`. Never a right-aligned free-text field.
- A hidden hover-revealed control fades almost to clear, never fully,
  because SwiftUI drops a fully transparent view from the Mac accessibility
  tree.
