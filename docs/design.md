# Crosstune design rules

Rules for every screen on every platform. Rule and screen disagree: the
screen is the bug. A platform page adds to this page and wins where they
differ:

- [Web](design-web.md)
- [Mac](design-macos.md)
- [iOS](design-ios.md): iPhone, compact iPad window
- [iPad](design-ipad.md): regular width, read after iOS

## Writing these pages

- Record decisions that bind future screens, never what a screen holds.
  "Every list filters by every facet of its items", not "the catalog
  filters by key, type, and tuning". The code shows the design itself.
- A rule two or more platforms share goes here, once. A platform page
  holds only what differs or exists on that platform, and never restates
  a rule from this page.
- A platform difference that is unintended is a bug: fix the code or add
  it to the backlog, never document it as a platform rule.
- Terse bullets and fragments. No paragraphs. Give a reason only when it
  stops a future change from undoing the rule.
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
- Quiet chrome, musical content. Color comes from the music and one slate
  accent. Boldness only in key hues and practice.
- A tune is a document, not a form. Read on a page, edit in a sheet.

## Words

- Tune, never song. Violin, never fiddle. Glossary: `product.md`.
- The plainest word for any folk tradition and a non-native speaker. No
  genre slang.
- Sentence case. Proper nouns keep capitals.
- Button: bare imperative verb (Edit, Save, Delete). Object only when the
  target is ambiguous (Add tune, Add to list).
- Acts on several tunes: carry the count ("Archive 3 tunes", "1 tune").
- Title inside a message: straight double quotes, `Delete "Soldier's Joy"?`
- Help text: one or two sentences, with a period. Label: no period.
- Example placeholder: lowercase, ends in an ellipsis. Search placeholder:
  capitalized imperative, `Search tunes`.
- Opens more interface: ends in an ellipsis, `New list…`.
- Glyph-only control: named in words. Pointer platforms also show the name
  as a tooltip.
- Control acting on one thing: action plus thing, "Edit Soldier's Joy".
  Row as control: verb plus the row's lines.
- Picker's empty choice named for its effect: "Not set" (field empty),
  "Any" or "All" (widen a filter), "Clear" (erase across tunes), "Keep"
  (no change). Tunes that disagree: "Mixed".
- Relative date carries its verb: "Edited today", "Edited Mar 4". Year only
  when not the current one.
- Same field, same label on every screen and platform. A row under a header
  that carries half the name can show less. A screen reader hears it all.
- A string that more than one file needs, tests included, is an exported
  constant beside the component that shows it. Every other file imports
  it, so a wording change is one edit.

## Color and type

- Slate: the one accent. Chosen state, selection, focus ring, primary
  button. A label on slate takes the on-slate token, never white, because
  dark slate is a light color.
- Coral: the mark, the selected sidebar row's glyph, the playhead of
  anything that plays back, every loop handle. Nothing else. An editing
  strip's playhead (trim) stays plain.
- Loop handle: coral whatever the loop's color. Loop color stays on its
  band and tab.
- Recording red: Record control, live waveform, Stop. Never a destructive
  action.
- Danger: destructive actions only. Warning: cautionary actions only.
- Status, key, loop, and heatmap colors are identical on every platform.
- Never color alone. A status glyph keeps its status color everywhere,
  selected sidebar row included, because the color is its meaning.
- A control painted in a value's own color keeps that color when chosen.
- Musical key: a colored pill everywhere. Hue from the pitch class on the
  circle of fifths, constant lightness and chroma. Unreadable key: neutral
  pill. Two sizes: full (tap target) and compact (row metadata).
- Tabular numerals wherever a number changes or lines up.
- Text passes 4.5:1, glyphs 3:1, in both appearances and on every ground.
  Tests measure the token pairs. Exception: Learning is Apple's system
  orange everywhere, below 3:1 on a light ground, so its half fill carries
  the status.
- Depth only on floating surfaces and bars. No row, card, or section casts
  a shadow.
- Per device, untouched by sign-out: appearance, text size, recording
  channels, sort choices.

## Identity

- Mark: geometric CT monogram. The C's top arm runs into the T's crossbar.
  The stroke turns coral where the T begins.
- Colorways: white C on dark, slate C on light. T always coral, through the
  `mark` token, which never follows `danger`.
- Lockup: bare mark left of the name, capital height. No app bar lockup,
  no link home.
- Icons: generated from `brand/` by `just web::icons`. Never hand-edit.
- Status bar takes the page background.

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
  tone (neutral, warning, danger). Label too long: shorter text, full
  accessible name.
- Full swipe only opens the row. No swipe is destructive.
- Destructive glyph names what it destroys: trash (gone for good), list
  with a cross (removed from a list).
- Long press or right-click on a row opens its menu.
- Shortcuts stand down while a text field or overlay holds the keyboard.
- Arrow keys walk rows, Enter opens, Escape steps out (top overlay, then
  selection), Cmd-A or Ctrl-A selects all.

## Shell and placement

| Zone            | Holds                                                        | Never holds                 |
| --------------- | ------------------------------------------------------------ | --------------------------- |
| Title           | What the screen shows. A top-level title can be a scope menu | Actions                     |
| Verbs bar       | Main verb first (Add, or Edit on a page), then one More menu | Filters, sort, view options |
| Under the title | Search field, then one filter row                            | Verbs                       |
| List header     | Count leading, sort trailing, directly above the rows        | Anything else               |
| App-wide        | Tabs, Record, now playing, selection bar                     | A screen's own actions      |

- At most two items in the verbs bar. Select is never a toolbar button.
- Exception under the title: a list page's play row (Play, Shuffle, what
  will play).
- A section's verb sits trailing on that section's heading.
- Screen-wide actions (Edit, Delete) live in More, never in a panel.
- A control sits over the pane it acts on.
- A column's title is its first line and scrolls with it. The bar shows it
  only once scrolled away, so it never reads twice.
- Detail column: always a page or a placeholder, never a list. A
  placeholder names what it waits for and how to get one.
- Sidebar order: Catalog with its statuses under it, Recordings, Lists,
  Settings. Phone tab order: Catalog, Lists, Recordings, Settings.
- Sidebar count: absolute (non-archived tunes, ignoring filters). Zero
  hidden. The list header gives the narrowed count.
- Sidebar status rows, the catalog's Status control, the phone title menu,
  and stats links write one stored status filter.
- A resize, rotation, or frame change keeps selection, scroll, open
  destination, and the playing item.
- Bottom chrome reserves its own room. Every column scrolls its last row
  clear of it.
- A control with nothing to act on is absent, never shown disabled.
  Exceptions, shown disabled: form buttons, a mode panel's controls, Sign
  out offline.
- Record control and sheet-opening commands stand down behind every sheet,
  dialog, and file picker, and while a screen is selecting.
- One action reached from several places opens one component, over the
  current screen. Finishing returns the musician where they were.

## Errors and states

- Error beside its control. A group's error replaces its help text, in red.
  Row action: reports under its list. Screen action: above the rows.
- Empty list: icon, title naming what is absent, optional hint, optional
  action.
- Loading is silence. The body shows nothing until its data is read.
  Spinners only on the sign-in splash and a transfer in progress.
- Sync badge shows only `Offline`, `Sign in again`, `Sync failed`. Full
  state and the one manual sync control live in Settings.
- Offline: a network control refuses on tap rather than disables, so its
  name survives and the reason lands on the row. Exception: Sign out
  disables, because the local catalog must not be deleted mid-session.
- Remembered musician admitted offline once the device reports no
  connection, or after 5 seconds. The account row says so.

## Rows

One row component per platform for every list of tunes.

- Tune row: status glyph, title, tunings in secondary, compact key pill
  trailing so keys form a column. No separator.
- Title keeps its width first. Tunings truncate, then drop out, before the
  title shrinks.
- Row metadata: status, key with first mode, non-standard tunings and capos
  for played instruments, "Archived". Each omitted when unset. A screen
  reader hears a comma between parts.
- Archived row: dimmed as a whole.
- Tap opens the tune. While selecting, tap toggles.
- In a list: tabular position number leading, reorder by dragging the whole
  row, no grip. Playing row: animated speaker, light slate wash. Nothing to
  play: not-playable glyph in the play slot.
- Selected row: inset slate highlight, every glyph keeps its own color.
- Status glyph's word is its tooltip on pointer.
- At most three visible actions. The rest in the row menu.
- Move: a control named "Move" plus the title, in the menu and the
  accessibility actions. After a move, a live region says where the tune
  landed.

### Recording and link rows

- Two lines: title in body, details in secondary. A fixed leading glyph
  slot shows state. Idle play glyph secondary, loaded item's glyph slate.
- The row is the control and always answers a tap: play, download, embed,
  or open the provider.
- Title: most specific name (typed, resolved, then composed from the date).
  Drop what the heading above already says.
- Second line: middle-dot metadata, or the link out. Recording: duration
  and one date, or a status word. Words only for what needs attention.
- Date follows the sort ("Added <date>" under Date added). Omitted when the
  title is composed from it.
- Sizes truncate, never round. Durations `m:ss`. Provider named once.
- Imported recording: a source line (site name, external-link icon) opens
  the origin page.
- Row not grouped by its parent: a parent line with a chevron, its own
  control, only as wide as the name. A red transfer error line with Retry
  follows it. Each such line keeps a 44pt target, and the row grows.
- One question, one list under one header, the musician's own recordings
  first.
- An action that leaves the app is menu-only, never a swipe action.
- A pinned item plays first in lists and shows a pin mark.

## Tune data

- Key with first mode, abbreviated on rows: key alone for major, `Dm`,
  `E dor`, `A mix`, `G modal`. A screen reader hears "E dorian". No key, no
  mode. Modes lowercase.
- One mode per part. The tune page shows all, a row the first.
- Type is the tune's form (reel, jig, waltz). Suggestions follow genre, then
  catalog use. Choosing a type fills an unset time signature, never one the
  player chose.
- A facet shows only when the tune holds a value. A tune's facts sit in one
  wrapping row, key first.
- Tuning field, filter, or badge only for a played instrument, unless the
  field already holds a value, so data never becomes unreachable.
- Open vocabularies (tuning, genre, type, composer, learned from, part
  structure): suggestions plus `Other…`, which reveals a text field. Closed
  lists the API validates: mode, time signature.
- Key: closed grid of pills, never typed. Both spellings of a black key,
  one hue. A stored key missing from the grid joins it as its own pill.
- Tuning suggestion: name, then strings, lowercase drone. "Cross A (AEAE)".
- A row omits an instrument's standard tuning unless a capo is set. Capo
  after the tuning, "Open G (gDGBD), capo 2", or alone, "Capo 2". The tune
  page shows every tuning.
- Capo: fretted instruments only, closed list None to 12.
- A row names the instrument only when the musician plays more than one.
  The tune page always names it.

## Status

- "Known", "Learning", "Unknown" (want to learn). One word fits a phone.
- Glyph shape carries the meaning: filled check, half-filled circle, empty
  ring, in status color. Its word is its accessible name. Word shown beside
  it: glyph hidden from assistive technology.
- Set only in the tune's edit form, one choice per word. The tune page
  shows status and never sets it.
- Required field never clears: pressing the chosen value keeps it. Optional
  field: pressing clears.
- Unrecognized value shows as Unknown.

## Search

- Every tune search also offers to create. A recording search does not.
- Non-empty query: add row under results, `Add "query"`, or
  `Add another "query"` when the title exists. Titles are not unique.
- Exact match hidden by a filter or the archived setting: named with an
  Open link, before the add row.
- Enter: opens the only visible result, else the hidden exact match, else
  creates. Two or more results: closes the keyboard only. Never creates a
  duplicate title.
- The add row carries the typed title, and from a picker the list or
  recording, into the new form.
- A picker never hides a tune. Already in the list: shown, marked "In this
  list", inert. Pickers include archived tunes.
- Field named for what it searches. Placeholder repeats it. "Clear search"
  while focused.
- Matches stored names, a parent's name included. Never text composed for
  display. Ignores case and accents.
- Query lasts the app session. Filters persist. The new tune form and
  sign-out clear the query.

### Other services

- Nothing is kept until the musician saves a result.
- A previewable result plays in its own row. One thing plays at a time
  across the app.
- Result row controls carry the title: "Link Soldier's Joy".
- Each service's results end with "Search on {service}". Nothing found or a
  failure says so below it, so every answer leaves a way on.
- Search starts only from a tap, never from opening a screen, unless one
  choice leaves nothing else to pick.

## Filters

- Most-used facets on screen, the rest in a filter sheet.
- Filters control sits with search, never in the toolbar, and carries a
  count: "Filters, 2 set". Persisted filters must announce themselves.
- Facets with their own on-screen control (Status, Key) never count in
  Filters and never show as tokens.
- Filter control: quiet capsule, slate wash once it narrows.
- Filters with nothing to choose (list loading, empty, or nothing to tell
  apart) and no filter set: absent, never disabled.
- Facet pull-down reads facet and value: "Key: Any", "Key: D". Colored
  values open a popover of pills, since a menu draws images in one color.
  Choosing closes it.
- A facet shows only when the catalog holds values for it, a tuning only
  for a played instrument. Every write clears a hidden facet, so it never
  narrows in silence.
- A stored value the catalog no longer holds still gets an option, so a
  stale filter never reads as Any.
- Sheet choices apply at once. Reset clears the sheet's filters only. Done
  closes.
- Set filter: removable capsule named for its value. Its remove control
  reads "Remove filter" plus the value. A tuning names its instrument,
  composer and learned-from name their field, since values can collide.
- Header count: "84 tunes", "11 of 84 tunes" while narrowed, absent when
  the catalog is empty.
- Each list screen keeps its own Show archived setting.

## Sorting

- Sort sits trailing in the list header, which scrolls with the list. One
  sort over several lists: once, above the first.
- Shows choice and direction as text and arrow ("Title" up is A to Z or
  oldest first). Spoken: "Sort by Title, A to Z".
- One menu, Sort, marks the current choice. Choosing it again reverses.
- Hidden while selecting and while nothing is listed.
- Dates start newest first, names at A. Unnamed sorts after named.
- A partial date sorts as the start of its period. An unknown date sorts
  last in either direction.
- Grouped by parent: one card, a short heading line per group that opens
  the parent. Rows drop what that line says.

## Selection and bulk actions

- Component state, never a URL.
- Enter from Select in More or a row's menu. Exit by the exit control,
  Escape, leaving the screen, completing an action, or Android back.
- Each row's own control becomes its checkbox. A leading check mark is
  decoration only.
- Count: a digit beside a word that can elide. No back button while
  selecting. No swipe actions, no reorder.
- Holds only visible tunes. Hidden by search, a filter, or the archived
  setting: leaves the selection. Select all means the current view and
  never clears.
- Shift-click extends.
- Focus moves to a checkbox on entry, back to the opener or the screen
  landmark on exit.
- Every action applies at once, ends the mode, and toasts with Undo. No
  confirmation, because it gets clicked through and leaves no way back. A
  failed write keeps mode and selection. Cancelling a sheet keeps the
  selection.
- Exception: Delete confirms and raises no toast, since recordings cannot
  come back.
- Bulk edit: the tune form over many tunes. Each row shows the shared
  value, `Not set`, or `Mixed`. Only touched rows write. Save is dead until
  one is. `Other…` keeps the current value.
- A field unique to one tune is never bulk editable.

## Forms

- Every form is a sheet over the current screen. No form route, no save
  bar.
- Toolbar: `Cancel` leading, bold primary action trailing, named for what
  it does. A sheet whose rows are the actions: Cancel alone.
- Sections of related fields. Header names the group, footer carries help,
  a validation message replaces the footer in red. Help is never a row.
- Non-list controls (pill grid, chip rail) sit at the cards' gutter.
- Closed choice: a field row that opens the one picker. A pill grid only
  where values carry color or the field is the screen's purpose.
- A set answered once (instruments, music services): a row that names the
  choice and opens a sheet, never rows on the screen. Names would wrap:
  count instead, "2 of 7".
- Fields ranked by use. Rare ones last, in one list.
- Labeled row: label leading, value trailing, value elides first.
- Every control has a visible label. An accessibility-only name is not a
  label.
- A row that opens its own form: name and chevron, no value summary.
- Empty row reads "Not set". Standalone field: a placeholder naming what
  goes in, never an example value.
- An empty selection that turns a feature off reads as that feature's empty
  state ("No services selected"), because "Not set" reads as defaults.
- Single-field sheet: no header, the title names the field.
- Reject as little as possible. Every limit that can be a typing cap is
  one. The rest: message under the field, focus, invalid mark, cleared at
  the first keystroke.
- Partial date: Year, optional Month, optional Day, Clear date.
- Visible fields are decided at open. Nothing disappears mid-edit.
- Form buttons always show. The primary action is disabled while a write
  is pending or the form cannot succeed.
- A sheet that can lose typed work refuses backdrop tap, drag down, and
  Escape. Cancel is the way out. Any sheet refuses while its own write is
  pending.
- Settings save on toggle. No Save button.
- A settings group's help leads its rows, so it reads before the choice. A
  failed write shows in red below the rows, and the help stays.
- New tunes' status is a picker row like the genre beside it, not the tune
  form's segments.
- Settings: root of categories, each its own page. A new setting joins its
  category's page, never the root.

## Overlays

Each overlay is one component per platform. Platform pages say how it
presents.

- Sheet opens part height, or full height for a long body or many fields.
  Its title names the dialog.
- Menu: destructive items last, red, after a separator. Cautionary items in
  warning color.
- A destructive action confirms through the app's own overlay. Only the
  named action resolves true. Button: bare verb. Message names the
  consequence and says when data cannot come back:
  `Delete "Soldier's Joy"? This removes its links and list entries.`
- Toast: only for Undo, or an error that arrives after the musician left
  the screen. One at a time, above the bottom chrome.
- A question the app must have answered: no Cancel, waits for a clean
  sync, never opens over another modal.
- A destructive edit that needs more room than a confirmation (trimming a
  recording): its own screen, `Cancel` and bold `Save`. Save confirms,
  naming what the edit keeps.
- A live recording refuses swipe dismissal. Discarding captured audio
  confirms.

## Pages

A page reads as a document, such as the tune page or stats.

- Plain ground, no cards. At most 680 wide, centered.
- Title in the page title role, selectable, in the content.
- Section: heading with its controls trailing, one height with or without
  controls. Space separates sections, never a hairline.
- Empty section: heading and add control only.
- Row text and glyphs start on the heading's leading edge, glyphs in a
  fixed slot.
- Group header: a form section label is secondary text. A header naming
  what its rows belong to is a heading. Leads somewhere: chevron, and the
  whole line is the target.
- Moving to another tune cross-fades. The current page stays until the next
  has read, so the column never goes blank.

### Mode panels

- A screen whose tools are modes: segmented control under the main surface.
- Each mode shows only its own controls. The panel keeps its tallest mode's
  height, so switching never moves anything.
- A mode shows its value beside its name only when off its default.
- A control that cannot run: stays in place, disabled, reason to assistive
  technology only.

### Stats

- Looks back. Never nudges. No streaks, no points.
- Shows only what the musician uses. Tunes, lists, recordings always, zero
  included. Everything else only when a non-archived tune holds it.
- Blocks run whole to particular: counts, recorded total, months, activity,
  on this day, breakdowns, rarities.
- Simplest chart that shows the point. Breakdown over 8 values: top 8 plus
  "Show all" with the full count, expanding in place.
- A value that is a catalog filter opens the catalog root with exactly that
  filter set and everything else cleared, so it shows exactly the tunes
  counted. Row with a chevron. A value that is not a filter, or that the
  filter would read as Any, is inert, with no chevron.
- Every chart mark carries its value as text. Marks too small to tap: the
  chart is one tab stop that takes taps, hover, and arrow keys, and shows
  the chosen mark's detail under it.
- Shading steps: quartiles of the musician's own values. Empty slots keep
  their place, so spacing reads as time.

## Player and practice

- The player opens only from a play tap. Opening a tune never loads a
  player. At most one item loaded, and it stays while the musician browses.
- Bar: thin scrubber with a coral playhead. While a list plays, previous,
  next, shuffle, and repeat join it where it is wide enough.
- An embed grows up out of the bar.
- A link the app plays itself (Apple Music through MusicKit) starts in the
  bar like a recording. A provider embed opens in full, because it holds
  the only controls.
- Practice opens from the player. Playhead fixed, wave scrolls under it.
  Loop bands in loop colors.
- Trim reads apart from practice: plain white handles and playhead.

## Motion

- Shows where a thing came from and went. Never decoration.
- Moves on its own: only the record control, the live waveform, and a
  playing row's speaker. Native Apple transitions and symbol effects are
  exempt.
- Reduced motion: cross-fade or instant.
