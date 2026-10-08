# Crosstune design rules

Rules every screen follows, on every platform. When a rule and a screen
disagree, the rule wins and the screen is the bug. Each platform's page
holds its presentation, and holds on that platform where it and this page
differ:

- [Web design rules](design-web.md) for the web client.
- [Mac design rules](design-macos.md) for the Mac.
- [iOS design rules](design-ios.md) for iPhone and a compact iPad window.
- [iPad design rules](design-ipad.md) for an iPad at regular width.

## Words

- Tune, never song. Violin, never fiddle. The glossary in `product.md` holds
  the terms.
- Clarity over colloquialism. A label uses the word a player of any folk
  tradition, and a non-native English speaker, understands first, never a
  genre's slang.
- Sentence case everywhere. Proper nouns keep their capitals.
- A button is a bare imperative verb: Edit, Save, Delete. Add an object only
  when the target is ambiguous: Add tune, Add to list.
- Anything that acts on several tunes carries the count: "Archive 3 tunes",
  "1 tune".
- A title inside a message sits in straight double quotes:
  `Delete "Soldier's Joy"?`
- Help text is one or two sentences with a period. A label has no period.
- An example placeholder is lowercase and ends in an ellipsis. A search
  placeholder is an imperative with a capital: `Search tunes`.
- A control that opens more interface ends in an ellipsis: `New list…`.
- A glyph-only control is named in words.
- A picker's empty choice is named for what it does: "Not set" leaves a
  field empty, "Any" or "All" widens a filter, "Clear" erases across many
  tunes, "Keep" changes nothing. Tunes that disagree show "Mixed".
- A set filter is a filled capsule named for its value. Its remove control
  reads "Remove filter" plus the value.
- A relative date carries its verb: "Edited today", "Edited Mar 4", with the
  year only when it is not the current one.
- A control that acts on one thing is named action plus thing: "Edit
  Soldier's Joy". When the row is the control, its name is the verb plus the
  lines the row shows.

## Layout

- No app bar lockup and no link home.
- One action reached from several places opens one component, laid over the
  current screen, so finishing returns the musician where they were.
- Chrome at the bottom of the frame reserves its own room.
- An error shows beside the control that produced it. A group's error
  replaces its help text in red. A row action reports under its list. A
  screen action reports above the rows.

## Color and type

- A control painted in a value's own color keeps that color when chosen.
- A group header that labels a form section is secondary text. One that
  names the thing its rows belong to is a heading. Each kind keeps a
  constant height whether or not it carries a control or opens anything.
  When a naming header leads somewhere, a chevron says so and the whole
  line is the target.
- A group's add action is a control at the trailing edge of its header,
  never a row in the card or a loose button.
- Numerals are tabular wherever a number can change or line up.
- A musical key is a colored pill everywhere. Its hue comes from the pitch
  class on the circle of fifths, at constant lightness and chroma. A key the
  client cannot read keeps the pill with the neutral fill. Two sizes only:
  full, a tap target, and compact, inside row metadata.
- Appearance, text size, and recording channels are per device. Sign-out
  leaves them alone.

## Identity

- The mark is a geometric CT monogram. The C's top arm runs into the T's
  crossbar, and the stroke turns coral where the T begins.
- Two colorways: white C on a dark surface, slate C on a light one. The T is
  always coral, through the `mark` token, which does not move with `danger`.
- The lockup is the bare mark left of the name, as tall as the capitals.
- Icons are generated from `brand/` by `just web::icons`, never hand-edited.
- The status bar takes the page background.

## Tune rows

Everywhere the app lists tunes it uses one row.

- The title keeps its width first and truncates when long.
- The row shows the status, the key with its mode, the non-standard
  tunings and capos for played instruments, and "Archived", each omitted
  when unset. A screen reader hears a comma between parts.
- An archived row is dimmed as a whole.
- A tap opens the tune. While selecting, a tap toggles the row.
- In a list, the row gains a position number and reorders by a drag. A tune
  with nothing to play shows the not-playable glyph where a play control
  would be.

## Keys, modes, and tunings

- A row shows the key with its first mode, abbreviated: the key alone for
  major, `Dm`, `E dor`, `A mix`, `G modal`. A screen reader hears the full
  name, "E dorian". A tune with no key shows no mode.
- A tune holds one mode per part, in part order. The tune screen shows every
  one; a row shows the first. Modes are lowercase everywhere.
- Type is the tune's form: reel, jig, breakdown, waltz. Suggestions follow
  the tune's genre, then the catalog's own use.
- Choosing a type fills the time signature when the player has not chosen
  one. A time signature the player chose is never replaced.
- A facet shows only when the tune holds the value. A screen that shows what
  a tune is puts every facet in one wrapping row, key first.
- A tuning field, filter, or badge appears only for an instrument the
  musician plays, except a field that already holds a value, which always
  shows so data never becomes unreachable.
- Tuning, genre, type, composer, learned from, and part structure are open
  vocabularies picked from suggestions, each with an `Other…` choice that
  reveals a text field. Mode and time signature are closed lists the API
  validates.
- Key is closed: a grid of pills, never typed. Both spellings of a black key
  are offered and share one hue. A stored key the grid lacks joins it as its
  own pill.
- A tuning suggestion reads name then strings, lowercase for a drone:
  "Cross A (AEAE)", "Sawmill (gDGCD)".
- A row leaves an instrument's standard tuning unsaid unless a capo is set.
  A capo reads after the tuning, "Open G (gDGBD), capo 2", or alone,
  "Capo 2". A tune's own screen shows every tuning, standard included.
- A capo is offered only for a fretted instrument, as a closed list from
  None to 12.
- A row names the instrument before a tuning only when the player plays
  more than one instrument. A tune's own screen always names it.
- A field's label reads the same on every screen. A row under a header that
  carries half the name may show less, but a screen reader hears the full
  name.
- Every string a musician reads is written once. A label, title, footer,
  placeholder, or message that more than one file needs is an exported
  constant beside the component that shows it, and the other files, tests
  included, import it, so a wording change is one edit.

## Status

- The labels are "Known", "Learning", and "Unknown" (want to learn). One
  word each fits a phone.
- Never color alone. Status is a glyph whose shape carries the meaning:
  Known a filled check, Learning a half-filled circle, Unknown an empty
  ring, each in its status color. Its word is its accessible name.
- Status is set with a rail of capsules, one per word.
- The tune screen shows the status and never sets it. Only the tune's edit
  form sets it.
- A required field never clears: pressing the chosen capsule leaves it
  chosen. An optional field does the opposite.
- An unrecognized status value shows as want to learn.

## Search and create

Every box that searches tunes also offers to create one; a recordings search
does not.

- A non-empty query shows an add row under the results: `Add "query"`, or
  `Add another "query"` when the title exists. Titles are not unique, so an
  exact match never hides the offer.
- An exact match hidden by a filter or the archived setting is named, with
  an Open link, before the add row.
- Enter opens the only visible result, or the hidden exact match, or creates
  when nothing matches. With two or more results Enter only closes the
  keyboard. Enter never creates a duplicate title.
- The add row carries the typed title into the new tune form, and from a
  picker also the list or the recording.
- A picker never hides a tune. One already in the list stays in the results,
  marked "In this list" and inert. Pickers search archived tunes too.
- The search field is named for what it searches and its placeholder repeats
  that. "Clear search" appears while the field has focus.
- A search matches stored names, a row's parent's name included, never text
  composed for display, such as a title made from a date.
- Query text lasts the app session and filters persist. Opening the new
  tune form and signing out clear the query.

## Filters

The catalog and Recordings each open a filter sheet from a Filters control.

- The control that opens the filter sheet sits with the search field, not in
  the toolbar, and carries a count: "Filters, 2 set". Filters persist, so a
  stale one must announce itself.
- The most-used facets sit on the screen. The rest are in the sheet.
- A facet appears only when the catalog holds values for it, and a tuning
  only for a played instrument. A hidden facet is cleared by every write, so
  it never narrows the catalog in silence.
- A value the catalog no longer holds still gets an option, so a stale filter
  never reads as Any.
- Every choice in the sheet applies at once. Reset clears the sheet's filters
  only. Done closes it.
- A set filter shows on the screen as a removable capsule. A tuning capsule
  names its instrument, and a composer or learned-from capsule names its
  field, because values can collide: two instruments can share a tuning's
  name, and one person can be both composer and teacher.
- The list header's count reads "84 tunes", or "11 of 84 tunes" while
  narrowed, and is absent when the catalog is empty.
- Matching ignores case and accents.
- List screens keep their own Show archived setting.

## Stats

The stats page looks back. It never nudges, and it keeps no streaks or
points.

- Only what the musician uses. Tunes, lists, and recordings always show, at
  zero too, on the page and in the Settings row that opens it. Every other
  block, count, and value, such as the scans count, shows only when a
  non-archived tune holds it. A day's activity names only the kinds that
  happened, such as scans viewed.
- Blocks run from the whole to the particular: counts, recorded total,
  months, activity, on this day, breakdowns, rarities.
- A breakdown value that is a catalog filter (key, mode, type, tuning,
  genre, composer, learned from) opens the Catalog tab at its root with that
  filter set and every other filter and the search cleared, so the catalog
  shows exactly the tunes counted. A type, tuning, genre, composer, or
  learned from value is a row with a chevron. The key grid's key filters by
  key alone and each key and mode cell by both. A value that is not a
  filter, such as time signature, only reads, with no chevron. So does a
  value the stored filter would read as Any or No key, such as a genre named
  All.
- Each mark of a chart carries its value as text for assistive technology.
  When a mark is too small to tap, the chart is one tab stop that takes
  taps, hover, and the arrow keys, and shows the chosen mark's detail under
  it.
- Shading steps are the quartiles of the musician's own values, so a
  casual player and a daily one both see the full range. An empty slot
  stays in place, so the spacing reads as time.

## Gestures

Every gesture has a visible equivalent. Swipe actions are also menu items,
and a drag has Move.

- On touch a row swipes left to reveal one to three full-height actions in
  their tone: neutral, warning, or error. Every action is the same width. A
  label too long for that width shows shorter text, and the full label still
  names the button.
- A full swipe only opens the row. No swipe is destructive.
- A destructive glyph says what it destroys: trash for gone for good, a list
  with a cross for removed from a list.
- Editing a row opens the form as a sheet over the current screen.
- A long press on a row opens its menu.
- A draggable row also carries a Move control, so it reorders without a
  drag. After a move a live region says where the tune landed. Reordering
  stops while selecting, and a selecting row has no swipe actions.
- With a keyboard, the arrow keys walk the rows, Enter opens, Escape leaves
  selection, and Cmd-A or Ctrl-A selects all. A shortcut stands down while
  a text field or an overlay holds the keyboard.

## Selection and bulk actions

Selection is component state, never a URL.

- Enter from Select in the screen's More menu or in a row's menu.
- Each row's own control becomes its checkbox. A check mark on the leading
  edge is inert decoration.
- The count is a digit beside a word that can elide. A screen wearing the
  selection toolbar shows no back button.
- The selection holds only visible tunes. A tune hidden by search, a filter,
  or the archived setting leaves it. Select all means the current view.
- Every action applies at once, ends the mode, and raises a toast with Undo.
  There is no confirmation, because a confirmation gets clicked through and
  leaves no way back. A failed write keeps the mode and the selection.
  Cancelling a sheet keeps the selection.
- Delete is the exception. It takes recordings that no undo can bring back,
  so it confirms and raises no toast.
- Exits: the toolbar's exit control, Escape, leaving the screen, completing
  an action, or Android's back.
- Shift-click extends the selection. Cmd-A or Ctrl-A selects all and never
  clears.
- Focus moves to a row's checkbox on entering and returns to the opening
  control, or the screen landmark, on leaving.
- Bulk edit is the tune form over many tunes. Each row shows the shared
  value, `Not set`, or `Mixed`. Only a touched row is written, and Save is
  dead until one is. A choice row clears through Clear, a yes or no row keeps
  through Keep, and `Other…` keeps the current value.
- A field whose value is unique to one tune is never bulk editable.

## Forms

Every form is a sheet over the current screen. There is no form route and
no save bar.

- The sheet toolbar holds the actions: `Cancel` leads and a bold primary
  action trails, named for what it does. A sheet whose rows are the actions
  carries Cancel alone.
- A form is a column of sections, each an inset group of related fields. The
  header names the group, the footer carries help, and a validation message
  replaces the footer in red. Help is never a row inside a card.
- A control that is not a list, such as a pill grid or a chip rail, sits at
  the same gutter as the cards.
- A closed choice is a field row that opens the one picker. Never a
  segmented control: it announces itself as a tab list and spends the width
  on unchosen values. A pill grid stands in only where values carry their own
  color or the field is what the screen is for.
- A set answered once, such as instruments or music services, sits behind a
  row that names the choice and opens a sheet, never as a list of rows on
  the screen. When the names would wrap, the row counts the choice instead,
  as "2 of 7".
- Fields are ranked by how often they are touched. Rare ones go last, in one
  list of rows.
- A labeled field row has the label leading and the value trailing. The
  value elides first.
- Every control has a visible label. A name given only to assistive
  technology is not a label.
- A row that opens its own form carries its name and a chevron, and no value
  summary.
- Every field shows where to type. An empty row reads "Not set". A standalone
  field carries a placeholder naming what goes in it, never an example value.
- An empty selection that turns a feature off reads as that feature's empty
  state, such as "No services selected", because "Not set" reads as "uses
  the defaults".
- A single-field sheet has no header. Its title names the field.
- A form rejects as little as possible. Every limit that can be a cap
  enforced while typing is one. What is left shows under its field, takes
  focus, marks the field invalid, and clears at the first keystroke.
- A date known only in part is entered as Year, then an optional Month,
  then an optional Day, with a Clear date control.
- Which fields a form shows is decided when it opens. Nothing disappears
  mid-edit.
- The primary action is disabled while a write is pending or the form cannot
  yet succeed.
- A sheet that can lose typed work refuses a backdrop tap and a drag down.
  Cancel is the way out. Any sheet refuses while its own write is pending.
- A setting saves on toggle. Settings has no Save button.

## Sheets, menus, confirmations, and toasts

Each is implemented once. Each platform's page says how it presents.

- A sheet opens part way, or at full height at once for a long body or a
  form of many fields. Its title names the dialog.
- A destructive menu item is red and follows a separator. A cautionary one
  takes the warning color.
- A destructive action confirms through the app's own overlay. Only the
  named action resolves true. The button is the bare verb. The message
  names the consequence and says when data cannot come back:
  `Delete "Soldier's Joy"? This removes its links and list entries.`
- A toast is for an action that offers Undo, and for the rare error that
  arrives after the musician has left the screen. One at a time, above the
  frame's bottom chrome.
- A question the app must have answered has no Cancel, waits for a clean
  sync before it asks, and never opens over another modal.
- A destructive edit that needs more room than a confirmation opens as its
  own screen, not a sheet, such as cutting a recording down. It carries
  `Cancel` and a bold `Save`. Save confirms through the app's own overlay,
  naming what the edit keeps, before it writes.

## Mode panels

A screen whose tools are modes puts a segmented control under its main
surface.

- Each mode shows only its own controls. The panel keeps the height of its
  tallest mode, so switching modes never moves anything on the screen.
- A mode shows its current value beside its name only when that value
  differs from the mode's default. At the default, it shows only its name.
- A control that cannot run right now stays in place, disabled. Its reason
  goes to assistive technology, not onto the screen.
- Actions on the whole screen, such as Edit or Delete, live in its `⋯`
  menu, not in the panel.

## Recording and link rows

Recordings and links share one row shape.

- A fixed glyph slot on the leading edge shows the item's state.
- The row is the control and always answers a tap: play, download, embed in
  the dock, or open the provider's site.
- The title is the most specific name available: typed, then resolved, then
  composed from the date. A part a heading above already carries is dropped.
- The second line joins metadata with middle dots, or on a link is the link
  out. On a recording it holds the duration and one date, or a status word.
- A recording imported from a site adds a source line: the site's name and
  an external-link icon. It opens the page the recording came from.
- A row in a list not grouped by its parent adds a line naming the
  parent with a chevron. That line is its own control, only as wide as the
  name, and opens the parent, so a tap beside it plays. A red line
  carries a transfer error and a Retry, which retries at once, and follows
  the parent line.
- A line that is its own control is only as wide as its text and keeps its
  own 44 target. When two show, the row grows.
- A state that needs nothing shows a date, unless the title is already
  composed from it. The date follows the sort: under Date added it reads
  "Added <date>". Words are reserved for what needs attention.
- Sizes truncate rather than round. Durations read `m:ss`. The provider is
  named once per row.
- Rows that answer one question share one list under one header, the
  musician's own recordings first.
- A header carries only the name of what its rows belong to. When it leads
  somewhere, the whole line opens it.
- The dock opens only from a play tap. Opening a tune never loads a player.
  At most one item is loaded, and it stays loaded while the musician browses.
- Practice opens from the player. A recording row's actions are Edit, Add
  to tune or Remove from tune, Go to tune on a filed recording, Play first
  in lists, and Delete. An imported recording's menu also has Open on and
  the site's name, which opens the page it came from, and is never a swipe
  action. A link row's actions are Play first in lists, Add to recordings
  when the server can save its audio, and Remove. On a tune's own rows, a
  recording or link can be pinned to play first in lists, and the pinned
  row shows a pin mark.
- A live recording refuses a swipe dismissal. Discarding captured audio
  confirms first.

## Sorting

- A sorted list opens with a header line that scrolls with it: the count
  on the leading edge, the sort on the trailing edge. A screen with several
  lists under one sort carries it once, above the first.
- The sort shows the current choice and its direction as text and an
  arrow, "Title" with up for A to Z or oldest first, so the order is never
  a guess. Its spoken name says both in words: "Sort by Title, A to Z".
- It opens one menu named Sort that marks the current choice. Choosing that
  choice again reverses the order.
- The sort hides while selecting and while nothing is listed.
- Dates start newest first and names start at A.
- A sort choice is per device. Sign-out leaves it alone.
- An item with no name sorts after the named ones.
- A date that may be known only in part, such as a recording's year, sorts
  as the start of its period. An unknown date sorts last in either
  direction.
- A list grouped by a parent stays one card, with a short heading line per
  group that opens the parent. Its rows drop what that line already says.

## Search results from other services

A search of other services keeps nothing until the musician saves a result.

- A result that can be previewed plays in its own row before it is saved.
- One thing plays at a time across the app. A result that starts playing
  stops the dock and any other result.
- A control on a result row is named with the result's title, since every
  row carries the same verbs: "Link Soldier's Joy".
- One service's results always end with its "Search on {service}" row,
  which opens the service's own search page. Nothing found or a failure
  says so below that row, so every answer leaves a way on.
- A search starts only from the musician's tap, never from opening a
  screen, except where one choice leaves nothing else to pick.

## Empty, loading, sync, and offline states

- An empty list shows an icon, a title that says what is absent, an optional
  hint that says what to do, and an optional action.
- Loading is silence, not a spinner. A screen shows nothing in its body
  until its data is read. The only spinners are the sign-in splash and a
  transfer under way.
- The sync badge shows only `Offline`, `Sign in again`, and `Sync failed`.
  Settings holds the full state and the one manual sync control.
- Offline, a control that needs the network refuses rather than disables, so
  its name and its tap survive and the reason lands on the row. Sign out is
  the one control disabled, because the local catalog must not be deleted
  while its session is open.
- A remembered musician is admitted offline once the device reports no
  connection, or after 5 seconds, and the account row says so.

## Motion

- Motion shows where a thing came from and where it went, never
  decoration.
- Nothing moves on its own except the record control, the live waveform,
  and the speaker on the row a playing list is on.
- Under reduced motion a change cross-fades or happens at once.
