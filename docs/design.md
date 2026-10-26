# Crosstune design rules

The design system and the rules every screen follows, on every platform.
When a screen and a rule disagree, the screen is the bug. A platform page
adds to this page and wins where the two differ:

- [Web](design-web.md)
- [Mac](design-macos.md)
- [iOS](design-ios.md): iPhone, compact iPad window
- [iPad](design-ipad.md): regular width, read after iOS

## Writing these pages

General rules for every doc: `CLAUDE.md`, Documentation. Here, only what
a new screen must follow: tokens, patterns, placement, and words. Never
how one screen behaves; its code says that.

- A rule two or more platforms share goes here, once. A platform page
  holds only what differs or exists on that platform, and never restates
  a rule from this page.
- A platform difference that is unintended is a bug: fix the code or
  track it as a bug, never document it as a platform rule.
- Gotchas (a framework limit, a crash, a workaround) go on the platform
  page, with the reason.
- A component's location goes in a platform page only when it is the one
  implementation every screen must reuse.

## Principles

Decide any case the rules below do not name.

- One design language, each platform's native form. Same tokens, rows,
  zones, and words everywhere.
- Each kind of control has one home. A control's job tells the musician
  where it is.
- Quiet chrome, musical content. Color comes from the music and one
  accent.
- An item is a document, not a form. Read on a page, edit one fact in
  place, edit many in a sheet.
- Layout follows the width of the column it sits in, never the device.
- Looks back, never nudges. No streaks, no points, no badges for use.

## Words

- The plainest word for any folk tradition and a non-native speaker. No
  genre slang.
- Sentence case. Proper nouns keep capitals.
- Button: bare imperative verb (Edit, Save, Delete). Object only when the
  target is ambiguous (Add tune, Add to list).
- Acts on several items: carry the count ("Archive 3 tunes").
- Title inside a message: straight double quotes, `Delete "Soldier's Joy"?`
- Help text: one or two sentences, with a period. Label: no period.
- Example placeholder: lowercase, ends in an ellipsis. Search placeholder:
  capitalized imperative, `Search tunes`.
- Opens more interface: ends in an ellipsis, `New list…`.
- Glyph-only control: named in words. Pointer platforms also show the name
  as a tooltip.
- Control acting on one thing: action plus thing, "Edit Soldier's Joy".
- Picker's empty choice named for its effect: "Not set" (field empty),
  "Any" or "All" (widen a filter), "Clear" (erase across items), "Keep"
  (no change). Items that disagree: "Mixed".
- Relative date carries its verb: "Edited today", "Edited Mar 4". Year only
  when not the current one.
- Same field, same label on every screen and platform.

## Color and type

- Harbor blue (`accent`) is the one accent: a primary action, a plain
  button's words, selection and chosen states, focus, switches, and set
  filters. Menu items, row glyphs, and form action rows stay ink. Never
  charts, glyphs at rest, or decoration.
- A fill behind white text is `accentFill`, its label `onAccentFill`.
  Never `accent`, which is too light in dark mode to carry white.
- Paper layers: `ground` under content, pages, lists, and sheets;
  `surface` under the sidebar, cards, and footers. `hairline` for every
  rule and edge. A control's fill follows its container: `field` on
  `ground`, `raised` on `surface`.
- Secondary text and glyphs take `inkSecondary`, never a system's
  translucent secondary, which falls under 4.5:1.
- Coral: the mark, the selected sidebar row's glyph, the playhead of
  anything that plays back, loop handles, and what marks Premium. Nothing
  else. Premium's coral is a fill with dark ink, never coral text.
- Recording red: recording only, never a destructive action. A label on
  it is `onRecord`, dark, since white falls under 4.5:1.
- Danger: destructive actions only. Warning: cautionary actions only.
- Charts draw in ink tones.
- Status, key, loop, and heatmap colors are identical on every platform.
- A tune's status has one visual language: the same glyph in the same
  color everywhere it shows, menus included. A menu tints its symbols, so
  a status glyph goes in as an image that is already colored.
- Never color alone: a state shown in color also shows in shape or words.
  A glyph keeps its own color on a selected row, because the color is its
  meaning.
- Text passes 4.5:1, glyphs 3:1, in both appearances and on every ground.
  Tests measure the token pairs, so a new color is a token with a test.
- Tabular numerals wherever a number changes or lines up.
- Depth only on floating surfaces and bars. No row, card, or section casts
  a shadow.
- Practice and trim draw in the dark scheme, on its jet, in every
  appearance (the Mac differs). The light jet is too pale for the loops.

## Identity

- The mark's C takes `markInk`, never the accent. The T is always coral,
  through the `mark` token, which never follows `danger`.
- Lockup: bare mark left of the name, capital height. No app bar lockup,
  no link home.
- Icons: generated from `brand/` by `just web::icons`. Never hand-edit.

## Input and density

- Density follows the pointer, never the screen size.
- Touch: 44pt targets and rows, swipe actions, no hover reveals.
- Pointer: 32pt rows, 28pt sidebar rows and pane controls, 24pt filter and
  section-heading controls. Hover reveals, keyboard shortcuts.
- Hover-revealed control: hidden by opacity, keeps its place, tab stop,
  and accessible name. Keyboard focus reveals it too.
- Every gesture has a visible equivalent. Swipe actions are also menu
  items. A drag has Move.
- Swipe left reveals one to three full-height, equal-width actions in their
  tone. Full swipe only opens the row. No swipe is destructive.
- Long press or right-click on a row opens its menu.
- Shortcuts stand down while a text field or overlay holds the keyboard.
- Arrow keys walk rows, Enter opens, Escape steps out (top overlay, then
  selection), Cmd-A or Ctrl-A selects all.

## Shell and placement

| Zone            | Holds                                                 | Never holds            |
| --------------- | ----------------------------------------------------- | ---------------------- |
| Title           | What the screen shows                                 | Actions, filters       |
| Verbs bar       | Main verb first (Add), then one More menu             | Sort, view options     |
| Under the title | Search field, then one filter row                     | Verbs                  |
| List header     | Count leading, sort trailing, directly above the rows | Anything else          |
| App-wide        | Tabs, Record, now playing, selection bar              | A screen's own actions |

- At most two verbs in the bar. Select is never a toolbar button.
- A pushed page's main actions can sit in a verb row under its heading, as
  page content. Its bar then holds only More.
- A section's verb sits trailing on that section's heading.
- Screen-wide actions (Edit, Delete) live in More, never in a panel.
- A control sits over the pane it acts on.
- A column's title is its first line and scrolls with it. The bar shows it
  only once scrolled away, so it never reads twice.
- Detail column: always a page or a placeholder, never a list. A
  placeholder names what it waits for and how to get one.
- A resize, rotation, or frame change keeps selection, scroll, open
  destination, and the playing item.
- Bottom chrome reserves its own room. Every column scrolls its last row
  clear of it.
- A control with nothing to act on is absent, never shown disabled.
  Exceptions, shown disabled: form buttons and a mode panel's controls.
- App-wide controls (Record, sheet-opening commands) stand down behind
  every sheet, dialog, and file picker, and while a screen is selecting.
- One action reached from several places opens one component, over the
  current screen. Finishing returns the musician where they were.

## Errors and states

- Error beside its control. Row action: reports under its list. Screen
  action: above the rows.
- Empty list: icon, title naming what is absent, optional hint, optional
  action.
- Loading is silence. The body shows nothing until its data is read.
  Spinners only for sign-in and a transfer in progress.
- A system permission is asked the first time a feature needs it, after an
  inline note saying why, with one button, Continue, that leads to the
  system prompt. No way past the note but the prompt (App Review 5.1.1).
- A refused permission is said where its absence shows and on the
  feature's Settings page, with a control opening the system setting
  where the platform has one.
- Offline: a network control refuses on tap rather than disables, so its
  name survives and the reason lands on the row.

## Lists and rows

- One row component per platform for every list of tunes.
- A row's title keeps its width first. Secondary details truncate, then
  drop out, before the title shrinks.
- Archived: all text in secondary ink. Glyphs keep their color.
- Reorder: drag the whole row, no grip. The dragged row lifts, the others
  slide aside, and a drop settles it. No drop line.
- Playing row: an animated speaker and a light accent wash.
- Selected row: inset accent highlight.
- At most three visible actions on a row. The rest in its menu.
- An action that leaves the app is menu-only, never a swipe action.
- A media row is itself the control and always answers a tap.
- Row title: the most specific name. Drop what the heading above already
  says.
- Sizes truncate, never round. Durations `m:ss`.
- A row shown outside its parent's group adds a line naming the parent,
  which opens it.
- A field that holds a value always shows, even where a setting would hide
  it, so data never becomes unreachable.

## Search, filters, sorting

- A search field is named for what it searches, and its placeholder
  repeats it.
- Search matches stored names, never text composed for display. Ignores
  case and accents.
- Escape in a search that holds text empties it first, so a picker never
  closes on what was typed.
- A picker never hides an item. One that cannot be picked shows, inert,
  with the reason.
- Every list filters by every facet of its items. The filter sheet holds
  them all, and the filter row is a shortcut to the same filters.
- A facet shows only when the list holds values for it. A stored value the
  list no longer holds still gets an option, so a stale filter never reads
  as Any.
- Filters persist, so they announce themselves: the Filters control
  carries the count of set filters, and the header reads "11 of 84
  tunes" while narrowed.
- Set filter: a removable capsule named for its value.
- Filter choices apply at once. Reset clears them all.
- Sort sits trailing in the list header and shows choice and direction.
  One Sort menu: choosing the current choice again reverses it. Dates
  start newest first, names at A. Unknown sorts last either way.

## Selection

- Component state, never a URL.
- Enter from Select in More or a row's menu. Exit by the exit control,
  Escape, leaving the screen, or finishing an action.
- Holds only visible items. An item hidden by search or a filter leaves
  the selection.
- Every bulk action applies at once, ends the mode, and toasts with Undo.
  No confirmation, because it gets clicked through. Exception: a delete
  that cannot come back confirms instead.
- Bulk edit is the item's form over many items. Each field shows the
  shared value or `Mixed`, and only touched fields write.

## Forms

- Every form is a sheet over the current screen. No form route, no save
  bar.
- An in-place editor saves on every dismissal. Only Escape cancels.
- Toolbar: `Cancel` leading, bold primary action trailing, named for what
  it does.
- Sections of related fields. The header names the group, and the footer
  carries help. A validation message replaces the help, in red.
- Every control has a visible label. An accessibility-only name is not a
  label.
- Labeled row: label leading, value trailing, value elides first. Empty
  reads "Not set".
- Closed choice: a field row that opens a picker. A pill grid only where
  values carry color.
- Open vocabulary: a text field with suggestions. Any typed value stands,
  and empty means empty. Closed lists are only what the API validates.
- A required field never clears: pressing the chosen value keeps it. An
  optional one clears.
- A set of switches answered once (instruments, music services) lives in
  Settings. Elsewhere, a row opens a sheet of the same switches.
- Fields ranked by use. Rare ones last.
- Reject as little as possible. Every limit that can be a typing cap is
  one.
- Visible fields are decided at open. Nothing disappears mid-edit.
- A sheet that can lose typed work refuses backdrop tap, drag down, and
  Escape. Cancel is the way out.
- Settings: a new setting joins its category's page, never the root.
  Every change saves at once. A group's help sits above its rows, so the
  musician reads what a setting does before choosing. A category or group
  takes the same name on every platform, and a link to a group lands on
  that group.

## Overlays

- Each overlay is one component per platform. Platform pages say how it
  presents.
- Sheet: part height, or full height for a long body. Its title names the
  dialog.
- Menu: destructive items last, red, after a separator.
- A destructive action confirms through the app's own overlay. The title
  is the question and names the thing. The message lists only the
  consequences and says when data cannot come back.
- Toast: only for Undo, or for an outcome that arrives after the musician
  left the screen. One at a time, above the bottom chrome.
- A one-time notice is a sheet, one at a time, never during a capture and
  never over another modal.
- A gated control stays in place and answers a tap with the Plan sheet.
- A purchase is never a sheet's default action or its first focus.
  Subscribe shows only once the store has answered with a price it can
  sell.

## Pages

- Plain ground, no cards, at most 680 wide. The tune page's facts card
  and start card are the only cards.
- Title in the content, selectable.
- Section: heading with its controls trailing. Space separates sections,
  never a hairline.
- An empty section a page always holds shows its heading, add control,
  and one quiet line, never an empty-state block. A section only some
  items fill is absent until it holds something.
- Verb row: what the musician does with the item, never editing. A verb
  shows only when it can act now, and is never disabled.
- Facts: the same facts in the same order on every item, so nothing moves
  between items. An unset value reads "Add".
- Moving between items cross-fades. The current page stays until the next
  has read, so the column never goes blank.
- Mode panels: a segmented control under the main surface. The panel
  keeps its tallest mode's height, so switching never moves anything.
- Charts: the simplest one that shows the point. Every mark carries its
  value as text.

## Motion

- Shows where a thing came from and went. Never decoration.
- Moves on its own: only the record control, the live waveform, and a
  playing row's speaker. Native Apple transitions and symbol effects are
  exempt.
- Reduced motion: cross-fade or instant.
