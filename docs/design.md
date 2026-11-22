# Crosstune design rules

The rules every screen follows, on every platform, so the app behaves the
same everywhere for the people who use it. A platform page adds to this
page and wins where the two differ:

- [Web](design-web.md)
- [Mac](design-macos.md)
- [iOS](design-ios.md): iPhone, compact iPad window
- [iPad](design-ipad.md): regular width, read after iOS

## Writing these pages

`CLAUDE.md`, Documentation, sets the gate. Here: only behavior two or
more platforms share.

- A rule two or more platforms share goes here, once. A platform page
  holds only what differs or exists on that platform.
- A platform difference that is unintended is a bug: fix the code or
  track it as a bug, never document it as a platform rule.
- Gotchas (a framework limit, a crash, a workaround) go on the platform
  page, with the reason.

## Shared components

- Every control and shared pattern comes from the platform's shared
  component library. A screen composes them and never builds or restyles
  its own. A new kind of control joins the library.
- A failed action says on the screen what went wrong.

## Principles

Decide any case the rules below do not name.

- One design language, each platform's native form. Same tokens, rows,
  zones, and words everywhere.
- Each kind of control has one place, set by the zone table under Shell
  and placement.
- Chrome uses neutral roles. Color comes only from music data (keys,
  status, loops) and the one accent.
- An item is a document, not a form. Read on a page, edit one attribute
  in place, edit many in a sheet.
- Layout follows the width of the column it sits in, never the device.
- Shows past practice. Never prompts more use: no streaks, points, or
  badges.

## Words

- The plainest word for any folk tradition and a non-native speaker. No
  genre slang.
- Sentence case. Proper nouns keep capitals.
- Button: bare imperative verb (Edit, Save, Delete). Object only when the
  target is ambiguous (Add tune, Add to list).
- Acts on several items: carry the count ("Archive 3 tunes").
- Title inside a message: straight double quotes, `Delete "Soldier's Joy"?`
- Help text: one or two sentences, with a period. Label: no period.
- A length or size limit appears only in a warning message, never in a
  hint or help text.
- Example placeholder: lowercase, ends in an ellipsis character
  (`U+2026`), never three periods. Search placeholder: capitalized
  imperative, `Search tunes`.
- Opens more interface: the label ends in an ellipsis character
  (`U+2026`).
- Glyph-only control: named in words. Pointer platforms also show the name
  as a tooltip.
- Accessible name of a control acting on one item in a list or row:
  action plus the item's name, "Edit Soldier's Joy".
- Picker's empty choice named for its effect: "Not set" (field empty),
  "Any" or "All" (widen a filter), "Clear" (erase across items), "Keep"
  (no change). Items that disagree: "Mixed".
- Relative date carries its verb: "Edited today", "Edited Mar 4". Year only
  when not the current one.
- Same field, same label on every screen and platform.
- File sizes truncate, never round. Durations `m:ss`.
- Signed number: true minus (`U+2212`), with the sign in a fixed-width
  slot so the digits do not shift.
- Row title: the most specific name. Drop what the heading above already
  says.

## Color

Every color a screen paints comes from a role. Values live in the token
files, never here.

### The system

| Tier       | Holds                                          | Named by                                           |
| ---------- | ---------------------------------------------- | -------------------------------------------------- |
| Primitive  | Raw values                                     | Hue and step: `blue-700`, `warm-gray-50`           |
| Role       | What a component paints with                   | Job: `page-background`, `text-secondary`, `accent` |
| Data color | Keys, loops, the heatmap, the tuner, waveforms | What it draws, defined from a role or primitive    |

- No hue in a role name, so a role can point at any hue without a
  rename.
- A hover, a tint, or a mix is its own token in the token files.

### Choosing a color

1. Name the job: what the color does on this screen.
2. Take the role whose job matches, from the table below.
3. If two roles fit, take the more specific job: `on-tint` over
   `accent` for a label on a tint.
4. If no role fits, stop and ask the owner. Never add a role for one
   screen.

### Roles

| Role                                                                          | Job                                                                                                         | Never                                                       |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `page-background`                                                             | Under content, pages, lists, sheets                                                                         |                                                             |
| `page-background-translucent`                                                 | A see-through page backing under a label or handle drawn over a waveform                                    |                                                             |
| `surface`                                                                     | The sidebar, cards, footers                                                                                 |                                                             |
| `surface-raised`                                                              | A control on a `surface`                                                                                    |                                                             |
| `field`, `field-hover`                                                        | A control on the page: inputs, chips, secondary controls; its hover                                         | On a `surface`, where it reads gray on gray                 |
| `border`                                                                      | Every rule and edge                                                                                         |                                                             |
| `border-strong`                                                               | Dashed outlines, slider tracks                                                                              |                                                             |
| `hover-overlay`                                                               | A hover over a fill that has no hover role                                                                  |                                                             |
| `text-primary`                                                                | Body text and glyphs; menu items, row glyphs                                                                |                                                             |
| `text-secondary`                                                              | Secondary text and glyphs, 4.5:1                                                                            | A system's translucent secondary                            |
| `text-tertiary`                                                               | A glyph that cannot act, a mark for absence, an off switch's track, 3:1                                     | Text                                                        |
| `disabled-border`, `on-disabled`                                              | A disabled filled control: no fill, a ring, a faint label                                                   | A fill, which reads as another filled control               |
| `accent`                                                                      | A plain button's words, selection and chosen states, focus, switches, set filters                           | Charts, glyphs at rest, decoration, a fill under white text |
| `accent-fill`, `on-accent-fill`                                               | A primary action's fill and its label                                                                       |                                                             |
| `accent-track`                                                                | An on switch's track, 3:1 on every background a switch sits on and under its white thumb                    |                                                             |
| `tint-subtle`                                                                 | A hover on a row or plain control; the playing row                                                          |                                                             |
| `tint`                                                                        | Selection, the current item, a set filter, a tinted control                                                 |                                                             |
| `tint-strong`                                                                 | A hover on a tint; the strongest step an accent label can sit on                                            |                                                             |
| `tint-strongest`                                                              | A tinted control's hover, a ring                                                                            | An accent label                                             |
| `on-tint`                                                                     | A label on `tint-subtle`, `tint`, or `tint-strong`                                                          |                                                             |
| `inverse-surface`, `on-inverse-surface`, `inverse-accent`                     | Tooltips and the undo banner: the other appearance's page, its text, its action                             |                                                             |
| `brand`, `on-brand`                                                           | The mark's T, the selected sidebar row's glyph, what marks Premium, the light warning fill; the label on it | Text in `brand`                                             |
| `playhead`                                                                    | The playhead line and the dock scrubber's thumb; brand falls under 3:1 there in light                       | A loop or range handle                                      |
| `brand-secondary`                                                             | The mark's C                                                                                                | The accent                                                  |
| `danger`, `on-status`                                                         | Destructive actions only; the label on a danger or known fill                                               | A recording control                                         |
| `warning`, `warning-fill`, `on-warning-fill`                                  | Cautionary actions only: text, a fill, its label                                                            |                                                             |
| `warning-fill-strong`, `danger-fill-strong`, `on-status-strong`               | A fill under a white label the platform draws, such as an Apple swipe action                                |                                                             |
| `status-known`, `status-learning`, `status-unknown`, `status-unknown-on-fill` | A tune's status, the same glyph and color everywhere it shows                                               |                                                             |
| `record`, `on-record`                                                         | Recording only; its label, dark, since white falls under 4.5:1                                              | A destructive action                                        |
| `tuner-background`, `on-tuner`, `on-tuner-secondary`                          | The tuner, in every appearance                                                                              | Any other screen                                            |
| `tuner-close`, `tuner-in-tune`, `tuner-in-tune-background`                    | The tuner's close step, its in-tune color, and its background while in tune                                 | Any other screen                                            |

A role only one platform has is on that platform's page.

### Rules every role follows

- Text passes 4.5:1, glyphs 3:1, in both appearances and on every
  background a role sits on.
- Never color alone: a state shown in color also shows in shape or
  words. A glyph keeps its own color on a selected row, because the
  color is its meaning.
- Status, key, loop, and heatmap colors are identical on every
  platform. A range handle takes the color of the range it bounds.
  Charts draw in text tones.

### Changing the system

- A new role ships with all of these in the same change:
    - A value in both appearances.
    - A contrast test for every pair it carries.
    - Its row in the table above, or on its platform's page when one
      platform has it.
- A new palette changes primitives. A new pairing points a role at
  another primitive. Neither renames a role.
- A failing color test means the change is wrong, never the test.

## Type and depth

- Tabular numerals wherever a number changes or lines up.
- Depth only on floating surfaces and bars. No row, card, or section casts
  a shadow.

## Input

- Density follows the pointer, never the screen size.
- Touch: swipe actions, no hover reveals.
- Pointer: hover reveals, keyboard shortcuts.
- Hover-revealed control: hidden by opacity, keeps its place, tab stop,
  and accessible name. Keyboard focus reveals it too.
- Every gesture has a visible equivalent. Swipe actions are also menu
  items. A drag has Move.
- No swipe is destructive.
- Long press or right-click on a row opens its menu.
- Shortcuts are disabled while a text field or overlay holds the keyboard.
- Arrow keys walk rows, Enter opens, Escape steps out (top overlay, then
  selection), Cmd-A or Ctrl-A selects all.

## Shell and placement

| Zone            | Holds                                                 | Never holds            |
| --------------- | ----------------------------------------------------- | ---------------------- |
| Title           | What the screen shows                                 | Actions, filters       |
| Toolbar         | Main action first (Add), then one More menu           | Sort, view options     |
| Under the title | Action button row, or search field then filter row    | Add, More menu         |
| List header     | Count leading, sort trailing, directly above the rows | Anything else          |
| App-wide        | Tabs, Record, now playing, selection bar              | A screen's own actions |

- At most two toolbar buttons. Select is never one.
- A section's button sits trailing on that section's heading.
- Screen-wide actions (Edit, Delete) go in the More menu, never on the
  page.
- A control sits over the pane it acts on.
- A column's title is the first line of its content, below any pinned
  bar, and scrolls with it.
- Detail column: always a page or a placeholder, never a list. A
  placeholder names what it waits for and how to get one.
- A resize, rotation, or frame change keeps selection, scroll, open
  destination, and the playing item.
- App-wide controls (Record, sheet-opening commands) are disabled behind
  every sheet, dialog, and file picker, and while a screen is selecting.
- One action reached from several places opens one component, over the
  current screen. Finishing returns the musician where they were.

## Errors and states

- Error placement: a field's error beside the field; a row action's
  error under its list; a screen action's error above the rows.
- A system permission is asked the first time a feature needs it, after an
  inline note saying why, with one button, Continue, that leads to the
  system prompt. The note has no skip or close. Continue is the only way
  on (App Review 5.1.1).
- A refused permission is said where its absence shows and on the
  feature's Settings page, with a control opening the system setting
  where the platform has one.
- Offline: a network control refuses on tap rather than disables, so its
  name survives and the reason lands on the row.

## Lists

- At most three visible actions on a row. The rest in its menu.
- An action that leaves the app is menu-only, never a swipe action.
- A row shown outside its parent's group adds a line naming the parent,
  which opens it.
- A field that holds a value always shows, even where a setting would hide
  it, so data never becomes unreachable.
- A search field is named for what it searches, and its placeholder
  repeats it.
- Search matches stored names, never text composed for display. Ignores
  case and accents.
- Every place that chooses a tune from the catalog draws the one shared
  tune picker. Only single or multiple selection, and actions on the
  current choice, differ.
- Every list filters by every facet of its items. The filter sheet holds
  them all, and the filter row is a shortcut to the same filters.
- A facet shows only when the list holds values for it. A stored value the
  list no longer holds still gets an option, so a stale filter never reads
  as Any.
- Filters persist. The Filters control shows the count of set filters,
  and while a filter is set the header reads "11 of 84 tunes".
- Filter choices apply at once. Reset clears them all.
- Sort sits trailing in the list header and shows choice and direction.
  Choosing the current choice again reverses it. Dates start newest
  first, names at A. Unknown sorts last either way.

## Selection

- Enter from Select in the More menu or a row's menu. Exit by the exit
  control, Escape, leaving the screen, or finishing an action.
- Holds only visible items. An item hidden by search or a filter leaves
  the selection.
- A click or tap anywhere on a row toggles it, as its checkbox does.
  Shift-click selects every row from the last one clicked.
- Every bulk action applies at once, ends the mode, and toasts with Undo.
  No confirmation, because it gets clicked through. Exceptions: a delete
  that cannot come back confirms instead, and an export runs in its own
  sheet and ends the mode when the platform takes the file.
- Bulk edit is the item's form over many items. Each field shows the
  shared value or `Mixed`, and only touched fields write.

## Forms

- Every form is a sheet over the current screen. No form route, no save
  bar.
- An in-place editor saves on every dismissal. Only Escape cancels.
- Every control has a visible label. An accessibility-only name is not a
  label.
- Closed choice: a field row that opens a picker. A pill grid only where
  values carry color.
- Open vocabulary: a text field with suggestions. Any typed value is kept,
  and empty means empty. Closed lists are only what the API validates.
- A required field never clears: pressing the chosen value keeps it. An
  optional one clears.
- Fields ranked by use. Rare ones last.
- Reject as little as possible. Every limit that can be a typing cap is
  one.
- Visible fields are decided at open. Nothing disappears mid-edit.
- A sheet that can lose typed work refuses backdrop tap, drag down, and
  Escape. Cancel is the way out.
- A new setting joins its category's page, never the root. Every change
  saves at once. A category or group takes the same name on every
  platform.

## Overlays

- Menu: destructive items go in its destructive group.
- A destructive action confirms through the app's own overlay. The title
  is the question and names the thing. The message lists only the
  consequences and says when data cannot come back.
- Toast: only for Undo, or for an outcome that arrives after the musician
  left the screen. One at a time, above the bottom chrome. A platform
  page can replace it with system undo.
- A gated control stays in place and answers a tap with the Plan sheet.
  A menu item the plan blocks is hidden.

## Pages

- Title in the content, selectable.
- Section: heading with its controls trailing. Space separates sections,
  never a border.
- An empty section a page always holds shows its heading, add control,
  and one quiet line, never an empty-state block. A section only some
  items fill is absent until it holds something.
- Action button row: what the musician does with the item, never editing.
  A button shows only when it can act now, and is never disabled.
- Attributes: the same attributes in the same order on every item, so
  nothing moves between items.
- Charts: the simplest one that shows the point. Every mark carries its
  value as text.

## Motion

- Shows where a thing came from and went. Never decoration.
- Nothing moves on its own except to show something live: recording,
  playback, or a transfer in progress.
- Reduced motion: cross-fade or instant.
