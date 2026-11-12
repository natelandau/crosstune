# Crosstune iOS design rules

iPhone and compact iPad windows. Read `design.md` first. This page wins
there where they differ. Regular-width iPad reads this page, then
`design-ipad.md`. The Mac never takes a rule from here.

- Apple's Human Interface Guidelines: native SwiftUI controls, SF Symbols,
  system materials and fonts, Dynamic Type.

## Shared components

- The library is `CrosstuneDesign/Phone/Controls/`, reviewed in its
  gallery (`-SampleScreen controls`). A new kind of control goes into
  both.

## Tokens

| Token set    | Holds                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| `Primitive`  | Raw color values, named by hue and step. Only `Style/` names one                          |
| `Palette`    | Every color role every Apple platform shares, and the data colors (`DataPalette.swift`)   |
| `Elevation`  | Shadows: `.float`, `.control`, matching the web's                                         |
| `PageStyle`  | What a shared view draws with, resolved per platform: text styles, sizes, drawing choices |
| `PhoneStyle` | iPhone and iPad waveform, touch sizes, timing                                             |

- A view never types a text size or row height. A value that differs by
  platform is a `PageStyle` value, never an `#if os` branch in a shared
  view's body.
- A list or vertical scroll root draws `pageBackground()`, never the system's
  white or black. System bars, the tab bar, and the iPad sidebar keep
  their system materials.
- Glass for controls only. Never content, never behind a text field.
- Touch density always.

## Shell

- Each root screen's toolbar ends with `AccountToolbarItem`, so the
  account button is outermost trailing.
- Filters is an icon-only toolbar item, its glyph filled once any filter
  is set.
- A control that cannot sit in a navigation subtitle goes in the toolbar,
  named for its action.

## Rows and lists

- A row on a page takes a context menu and reorders through a move menu.
- List reorder: long press and drag.
- Search: the system search field through `listSearch`, pinned under the
  title.
- The filter row is the list's first row and scrolls with it.
- A row on the page background clears its row background
  (`unselectedRowBackground`). A selected row keeps the system fill.
- Grouped lists take plain headings, never cards.

## Pages and forms

- A form keeps the native inset grouped style. A screen that only reads is
  a document page.
- A page clears its failure footers on open, so an old failure never reads
  as new.

## Keyboard

The window root's `keyboardDismissal()` closes the keyboard on every
screen, sheet, and popover. Each field's `.textEntry(_:)` sets its keyboard.

- No screen adds its own gesture to close the keyboard. The window ends the
  edit on a tap outside a field, and a second gesture conflicts with it.
- A screen or sheet whose only job is typing opens with the keyboard up. A
  search over a list opens with it down, so the list stays in view.
- A form of several text fields: Return moves to the next field through
  `returnFocuses(_:)`. The last field's Return saves or ends the edit.
- A field that shows its own Done sits in a `TextFieldDoneGroup`, so the
  keyboard shows no second Done.

## Sheets

- A sheet's actions pin to its bottom edge through `sheetActions`.
- A compact width or a compact height takes a sheet where a regular window
  takes a popover, so an iPhone in landscape does too.

## Motion

- A presentation opened from a visible item zooms out of it and back.
- One gate, `phoneAnimation` and `phoneTransition`, reading
  `PageStyle.animatesPhoneMotion`. The Mac gets none of it.
- Reduce Motion: a zoom becomes the plain presentation.

## Accessibility

- Spacing scales with Dynamic Type. A control out of room wraps, never
  clips. A fixed-size tile instead caps its type and shows the Large
  Content Viewer.

## Framework limits

SwiftUI and UIKit behavior that a new screen runs into.

- Window or scene root carries `.tint(Palette.textPrimary)`, so toolbar
  glyphs, menu pickers, and icon controls draw in primary text. A
  `GroupedForm` gives its buttons the accent. Any other view that needs
  the accent (a worded button, a link, a selected state) names
  `Palette.accent`, never `.tint`. UIKit-drawn pieces (list selection,
  focus rings, default buttons, alerts, menus) ignore tint and take the
  `AccentColor` asset, which carries the accent.
- A system prominent style fills with the tint (primary text), not
  `accentFill`, so it never draws a filled button.
- The system fills a confirm toolbar button and a focused list selection
  with the tint behind white, which primary text makes unreadable in dark
  mode. So a confirm item is a `ConfirmToolbarItem`, and a list that
  takes a selection carries `.accentSelectionTint()`.
- More is an explicit `Menu`. Loose overflow items lose a destructive
  item's separator and red role.
- A confirmation dialog's popover points at the view that carries it. So
  the dialog goes on the row, button, or menu that asked, never the
  screen. A row among many reads the screen's item through
  `matching(_:)`. A sidebar `Tab` cannot carry a dialog, so a sidebar
  row's question comes from the shell.
- SwiftUI runs swipe actions only on a `List`'s rows. Rows that swipe
  inside a page's scroll view sit in `SwipeRows`, a `List` that never
  scrolls and takes its rows' height.
- A system picker shows the chosen value inline, so its options carry no
  counts, which would read as part of the value.
- A system segment shows an image or a word, never both.
- A tab item cannot be a zoom source, so a sheet opened from the tab bar
  is a standard sheet.
