# Crosstune design patterns

This page records how the web client behaves. It covers the words it uses,
how it lays out a screen, what a row looks like, and how gestures work. It
also covers what the musician sees while something loads, fails, or waits for
a connection. A new screen follows these rules. When a rule and a screen
disagree, the rule wins and the screen is the bug.

The client is built on Ionic React, so each platform supplies its own
structure and each pattern below says where the two platforms differ on
purpose. Each pattern is implemented once. The table at the end of this page,
"Where each pattern lives", names the component for each one, so a new screen
composes it instead of rebuilding it.

## Words in the interface

- The glossary in `product.md` defines the terms and sets the two naming
  rules: song, never tune, and violin, never fiddle.
- Every label, button, heading, and tab is sentence case. Only proper nouns
  keep their capitals: Crosstune, YouTube, Apple Music, TIDAL. The one
  exception is the selection toolbar on `ios`, where `Select All`,
  `Deselect All`, and `3 Selected` are copied from Apple's own edit mode.
- A button is a bare imperative verb: Edit, Save, Cancel, Delete, Create,
  Rename, Select, Retry, Undo, Done, Reset. An object follows only when the
  target is ambiguous: Add song, Add songs, Add link, Add to list, Add list,
  Delete list, Sync now.
- A count goes into the label of anything that acts on several songs:
  "Archive 3 songs", "Remove 3 from list", "Edit 3 songs", "2 of 5 in it".
  One song reads "1 song".
- A song or list title inside a message sits in straight double quotes:
  `Delete "Soldier's Joy"?`, `Add "Soldier"`, `"Soldier's Joy" is archived.`
- Help text is one or two full sentences with a period. A label has no
  period.
- A placeholder that gives examples is lowercase and ends in an ellipsis:
  `Tuesday jam, square dance set, …`. A search placeholder is an imperative
  with a capital: `Search songs`.
- A control that opens more interface ends in an ellipsis: `New list…`,
  `Other…`. The key grid's empty choice is the bare glyph `?`, the shorthand a
  musician already writes on a tune list, named in words for a screen reader
  because a glyph reads as nothing aloud.
- The empty choice in a picker reads "Not set". In a filter it reads "All"
  on the status control, "All keys" on the key rail, whose other capsules
  are bare letters that need the reset to name what they are, and "Any"
  inside the filter sheet. In the bulk edit sheet the clearing choice reads
  "Clear" and the unchanged choice for a yes or no field reads "Keep". A
  field whose songs disagree shows "Mixed".
- A set filter shows as a filled capsule named for its value, and its remove
  control is named "Remove filter" and the value, so a screen reader hears
  "Remove filter Cross A (AEAE)".
- A relative date carries its verb: "Edited today", "Edited yesterday",
  "Edited Mar 4", with the year only when it is not the current year.
- A control that acts on one thing is named for the action and the thing, so
  a screen reader hears "Edit Soldier's Joy", "Reorder Soldier's Joy", "Open
  Soldier's Joy on YouTube". Where the row itself is the control, its name is
  the verb composed with the lines the row shows, so it stays true as those
  lines change.

## Layout and chrome

Three axes decide the chrome. No screen asks which device it is on.

| Axis    | Values           | Decides                                                      | Source                                        |
| ------- | ---------------- | ------------------------------------------------------------ | --------------------------------------------- |
| Mode    | `ios`, `md`      | How components look and animate                              | Ionic's own detection, never forced           |
| Frame   | `phone`, `wide`  | Tab bar or sidebar, full width or a measured column          | Viewport width at 768px                       |
| Pointer | `touch`, `mouse` | Swipe or hover, sheet or popover, whether shortcuts exist    | `(hover: hover) and (pointer: fine)`          |

- One router and one outlet always render. `IonTabs` owns the four
  navigation stacks, and routes are tab-scoped, so a song opened from a list
  stays in the Lists tab and Back returns to the list. The song page is one
  component mounted at every path that shows a song. Navigation goes only
  through Ionic's router, never through browser history.
- On the phone frame the tab bar holds five equal slots in this order:
  Catalog, Lists, the record button, Recordings, Settings. A tab is a glyph
  over a short label, and the current tab shows by color alone, which Ionic
  draws per mode. The center slot is empty and unreachable, because the
  record button is a dome that sits over it.
- The record dome rises above the bar's top edge, over the page that scrolls
  beneath it, and is the one red control on the screen. It is named "Start a
  new recording". A recording starts from one of three controls, and all three
  open the same modal. The dome serves the phone frame and the sidebar's
  Record item the wide frame. A song page's Record control serves both, and it
  alone files the recording under a song.
- On the wide frame the tab bar is hidden rather than unmounted, and an
  `IonSplitPane` sidebar takes its place. The sidebar holds the lockup, the
  four destinations, a Record item, and then the sync badge, in that order. It
  switches tabs through the hidden bar, so each stack keeps its pushed pages
  on both frames. Content sits in a column 640px wide, set in pixels so the
  text size setting scales the type and not the column.
- There is no app bar lockup and no link home. The sidebar's lockup is not a
  link.
- `Screen` is the one page component. It renders an `IonPage`, a toolbar, a
  scrolling content area, and the screen's landmark as `<main tabIndex={-1}>`
  inside the column. A top-level screen opens with a large title on `ios`,
  carries the search bar under that title, takes a trailing control for that
  search row through `searchEnd`, and shows the sync badge on the phone
  frame. A pushed screen carries a back button instead. Pass `grouped`
  for a screen made of inset groups, which takes the grouped background so
  each group reads as a card.
- The sync badge shows only the three states that need attention: `Offline`,
  `Sign in again`, and `Sync failed`. Settings is where the full state is
  read.
- An error shows beside the control that produced it. A group's own error
  replaces its help text in red, a row action reports under the list it acted
  on, and a screen's actions report above the rows. Settings gives each group
  its own action, so a refused write lands under the control that made it.
- The player dock sits in the tab frame's bottom slot, above the tab bar, and
  reserves its own room there, so no page ends up behind it.
- The record screen is a modal over whatever tab is open, so finishing returns
  the musician to where they were.

## Color, type, and icons

- The palette carries meaning and each platform supplies its own structure.
  Page background, grouped background, fills, separators, and secondary text
  come from Ionic's per-mode defaults, so an iPhone gets iOS greys and
  Android gets Material greys.
- Four Ionic roles are set: `primary` and `success` are the blue slate in
  light and the silver in dark, `warning` is the clay, and `danger` is the
  coral. `primary` tints buttons, links, the current tab, and the selection.
  `success` and `warning` are the known and learning dots. `warning` also
  marks the archived badge and a cautionary menu item. `danger` marks the
  record button and every destructive action. The key rail is the one
  exception to `primary` tinting the selection: its chosen capsule fills in
  the key's own hue, because filling with `primary` would repaint a key from
  its own color at the moment it is chosen. `All keys` has no pitch and keeps
  the `primary` fill.
- Dark mode is Ionic's system palette, switched by the `ion-palette-dark`
  class the appearance setting writes. The class and the `data-theme`
  attribute are both stamped by the inline script in `index.html` before
  the first paint, so there is no flash.
- On `md` in dark mode a plain list's rows take the page color, so its
  separators alone carry its structure, which is where Material sits a list
  item. Inset groups keep their own lighter row, so a card still reads as a
  card on the page behind it.
- `src/app/theme/variables.css` is imported outside every layer, because
  Ionic injects its component styles unlayered at runtime and a layered rule
  loses to them whatever its specificity.
- Type comes in named roles: title, headline, body, subheadline, footnote,
  caption, and timer, each defined once per mode. A screen uses a role and
  never sets a size, weight, or tracking of its own. The roles live in
  `layer(components)`, below the utilities, so a utility still wins.
- Ionic's own label styles sit outside every layer, so each role is applied
  again unlayered to reach inside an `ion-label`. That rule also beats a
  color utility on the role element. Inside an `ion-label`, put a color
  utility on a child span rather than on the role element.
- Numerals are tabular wherever a number can change or line up: keys,
  tunings, time signatures, the timer, durations, positions, and counts.
- A musical key is a colored pill wherever it appears. Its hue comes from the
  key's pitch class, placed by position on the circle of fifths, so keys a
  fifth apart are neighbors and two spellings of one pitch match. Lightness
  and chroma are constant, so no key reads louder than another. A key the
  client cannot read as a pitch class keeps the pill and takes the neutral
  capsule fill, so it never borrows a hue. Mode is not part of the key and a
  key is never inferred from one: "Am" reads as unrecognized. The pill comes
  in two sizes and no others: the full one fills a 44px tap target in the key
  rail, and the compact one sits in a line of row metadata without setting
  that row's height.
- The text size setting has three steps, compact, regular, and roomy, and
  moves the root font size, which scales every role at once. Inputs never
  drop below 16px, so iOS does not zoom on focus. iOS opts out of Dynamic
  Type, so the in-app setting owns the root size.
- Appearance and text size are per device and need no account. Sign-out
  leaves them alone.
- Every tap target is at least 44px. Ionic injects its own smaller minimum
  unlayered, so a toolbar control, a row action, a segment button, and a
  capsule each carry a rule that outranks it. Measure a control rather than
  trusting the class on it.
- Every icon comes from `lucide-react` as a named import, sized with a
  `size-*` class, and hidden from assistive technology inside a control that
  carries its own name.

## Identity

- The mark is a geometric CT monogram. The C's top arm runs straight into the
  T's crossbar, and the stroke changes to coral where the T begins.
- Two colorways and no others. On a dark surface the C is white, and on a
  light surface the C is slate. The T is always coral. The colorway follows
  the surface, never the brand. In the client the C takes the text color and
  the T the `mark` token, which does not move with `danger`.
- A lockup is the bare mark to the left of the name, the mark as tall as the
  capitals. Inside the client the lockup appears in two places: the sign-in
  screen and the sidebar header.
- The app icon, the favicon, and the PWA icons are generated from
  `brand/icon-dark.svg` by `just web::icons` and never edited by hand.
- The status bar takes the page background, which the client reads back from
  the stylesheet whenever the appearance changes.
- The sources for marketing, bare and tiled in both colorways, live in
  `brand/` at the repository root.

## Song rows

Everywhere the app lists songs, it uses the same row.

- Line one is the title alone, truncated when long.
- Line two holds four parts in this order, each omitted when unset: the key
  in bold tabular figures, the status dot with its label, the tunings in the
  secondary color, and the word "Archived". A screen reader hears a comma
  between the parts.
- Tunings appear only for instruments the musician plays, joined with a
  middle dot, violin before banjo.
- An archived row is dimmed as a whole.
- Tapping the row opens the song. While selecting, a tap toggles the row
  instead.
- In a list, the row gains a position number on the left, and a Reorder
  button and a drag grip on the right.
- Five places show this row: the catalog, list detail, the picker that adds
  songs to a list, the picker that files a recording under a song, and the
  song headings on the Recordings screen. A screen never lays out a song's
  title and key its own way.

## Keys, modes, and tunings

- A row shows the key alone, never the mode.
- The song page shows the key and the mode as one line under the title:
  "A mixolydian". Modes are lowercase everywhere, in pickers, filters, and
  badges.
- On the song page every other facet is a capsule, in this order: violin
  tuning, banjo tuning, time signature, Crooked, feel, genre, part structure,
  Lyrics. A capsule appears only when the song has the value. An archived
  song adds a warning capsule last.
- A tuning field, filter, or badge appears only for an instrument the
  musician plays. The one exception is a field that already holds a value,
  which is always shown so data never becomes unreachable. A song row is
  stricter and shows a tuning only for a played instrument.
- Tuning, mode, genre, feel, time signature, and part structure are picked
  from a list of suggestions. Those lists never close the door: each one
  offers an `Other…` choice that reveals a text field, and a typed value then
  shows as its own option.
- Key is the exception, because it is a closed vocabulary: there are twelve
  pitch classes and no thirteenth, so a key is chosen from a grid of pills
  and never typed. Unknown leads the grid and is pressed until a key is set,
  the common keys follow in their own colors, and `More keys…` opens the
  rest as a menu. Both spellings of a black key are offered, F# and Gb alike,
  because musicians name them as different keys; the two share one hue,
  because they are one pitch. A key the grid does not hold, whether picked
  from that menu or stored by an older client, joins the grid as its own
  pill, so no stored key is ever unreachable. Which keys the grid shows is
  `QUICK_KEYS` in `suggestions.ts`, and the menu is whatever `ALL_KEYS` holds
  that the grid does not. A tuning suggestion reads as a name and the strings in
  parentheses, with a lowercase letter for a drone string: "Cross A (AEAE)",
  "Sawmill (gDGCD)".
- The labels "Violin tuning" and "Banjo tuning" read the same on the song
  form, in the filter sheet, and in the bulk edit sheet.

## Status

- A song is known, learning, or want to learn, labeled "Known", "Learning",
  and "Unknown". One word each fits the status control on a phone without
  wrapping.
- Status is never shown as color alone. Where a dot appears, its label
  appears beside it. Known is a filled dot in the success color, learning a
  filled dot in the warning color, and want to learn a hollow ring. A chosen
  capsule fills with `primary`, and success is that same slate, so the chosen
  dot takes the contrast color rather than disappearing into the fill behind
  it.
- The dot and label pair appears in song rows and in the status chooser.
  Everywhere else status is the label alone. It is a row of capsules on the
  song page, the song form, and the catalog's filter bar, so one control means
  one thing everywhere. The filter's row leads with All, the way the key rail
  leads with All keys, because a filter can narrow nothing. It is a select in
  the bulk edit sheet and a menu of three items for a bulk change.
- The status chooser never clears: a song always has a status, so pressing the
  chosen capsule leaves it chosen. The key grid is the opposite, because a
  song may have no key.
- A status value the app does not recognize shows as want to learn.

## Search and create

Every box that searches songs also offers to create one. The rules are the
same in the catalog, in the picker that adds songs to a list, and in the
picker that files a recording under a song.

- A non-empty query always shows an add row under the results, labeled
  `Add "query"`. Titles are not unique, because different songs share a name,
  so an exact match never hides the offer. When a song already carries the
  title the row reads `Add another "query"`.
- When the exact match exists but is hidden by the archived setting or a
  filter, a note names it with an Open link before the add row. The note
  reads `"Soldier's Joy" is archived.` or
  `"Soldier's Joy" is hidden by your filters.`
- Enter opens the only visible result, or the hidden exact match when nothing
  is visible, or creates when nothing matches anywhere. With two or more
  results Enter only closes the keyboard. Enter never creates a song whose
  title already exists. That takes a deliberate tap.
- The add row carries the typed title into the new song form, so nothing is
  retyped. From a picker it also carries the list or the recording, so the
  saved song is added to the list or holds the recording.
- A picker never hides a song it cannot offer. A song already in the list
  stays in the results, marked "In this list", so an exact match is never
  mistaken for a missing song. A tap on it does nothing.
- A picker searches archived songs too, and an archived row says so in its
  name.
- The search field is named for what it searches, and its placeholder
  repeats that name. The phone keyboard's return key reads Search, and a
  clear button named "Clear search" appears while the field has focus.
- The catalog query lasts for the browser session. It survives opening a song
  and coming back. A new tab, a new session, opening the new song form, and
  sign-out all clear it. Filters persist. Free text does not.
- Clearing a filter never touches the query.

## Filters

Only the catalog has filters.

- The catalog's toolbar holds Add song, plus More actions while a song is
  visible.
- The search field sits under the large title on `ios` and in the toolbar on
  `md`, and the Filters control sits at the trailing edge of that same row,
  with the field giving up the room it takes. Filters belongs with the
  controls it governs, not with the toolbar's actions. It carries a count of
  the filters set inside the sheet, and its name reads "Filters, 2 set",
  because filters persist between visits and a stale one must announce
  itself.
- Under the search comes the status row: All, Known, Learning, Unknown, as
  capsules.
- Then the key rail: All keys, then every key the catalog holds, as capsules
  in one scrolling row that fades at its end while there is more to scroll
  to. Each key wears its own pill, the same one a song row shows, so the rail
  reads as the keys themselves rather than as plain chips. One tap sets a
  key, a tap on All keys or on the pressed key clears it. The chosen key
  fills in its own hue. The rail appears only when the catalog holds keys.
- Then a row of filled capsules, one per filter set inside the sheet, each
  removable. Show archived reads "Archived shown".
- Mode, violin tuning, banjo tuning, and genre live in the filter sheet as
  select rows, in that order, each offering Any first, with Show archived as
  a toggle below them. A facet appears only when the catalog holds values for
  it, and a tuning only when the musician also plays that instrument. A
  hidden facet is cleared by every write, so it can never narrow the catalog
  in silence. A value the catalog no longer holds still gets an option of its
  own, so a stale filter never reads as Any.
- Every choice in the sheet applies at once. The first line of the sheet is
  the live count, in the same words as the count under the list, and a
  footnote under the toggle counts the archived songs. Reset clears the
  sheet's filters and nothing else. Done closes it.
- Under the list a count reads "84 songs", or "11 of 84 songs" while anything
  narrows it. The count is absent while the catalog holds no songs at all.
- Matching ignores case and accents.
- Catalog filters persist and come back on the next launch. List screens have
  their own Show archived setting, off by default, shared by every list and
  untouched by the catalog.

## Gestures

Every gesture has a visible equivalent. Swipe actions also exist as hover
buttons and as menu items, long press has the Select item, and drag has the
move menu.

- On touch a row swipes left to reveal one to three actions as full-height
  buttons filled with their tone: neutral, warning, or error. Running an
  action closes the row it ran on.
- Every revealed action is 5rem wide, whatever its label reads, so one row's
  actions are all the same target and the same action lands in the same place
  on every list. A label too long to read on one line at that width shows a
  shorter text instead: Add to song reads Add, Remove from song reads Remove.
  The full label still names the button to a screen reader.
- On a mouse the same actions are icon buttons laid over the row's trailing
  edge, shown on hover and on keyboard focus, because nothing hints that a
  row swipes. They keep their place in the tab order at all times.
- A full swipe only opens the row. It never runs an action, so no swipe is
  ever destructive.
- These lists carry actions, in this order:

| List                    | Actions                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| Catalog songs           | Edit (neutral), Archive or Unarchive (warning)                              |
| List songs              | Edit (neutral), Remove (error)                                              |
| Lists                   | Edit (neutral), Delete (error)                                              |
| Recordings              | Rename (neutral), Add to song or Remove from song (warning), Delete (error) |
| Links                   | Remove (error)                                                              |
| Lists on the song page  | Remove (error)                                                              |

- A destructive action's glyph says what it destroys: the trash for
  something that is gone for good, such as a song, a recording, a list, or a
  link, and a list with a cross for a song only taken out of a list.
- Edit on a song row opens the song form as a sheet over the screen the
  musician is on. Cancel and Save both return to that screen.
- A press held for half a second on a song row enters selection mode with
  that row selected. It is wired on touch alone, because a mouse has the
  Select item instead. A movement of more than 10px cancels the hold, so a
  swipe or a scroll never counts as one, and the phone vibrates briefly where
  it can.
- Reordering a list uses `IonReorderGroup`. Each row carries two trailing
  controls, because `ion-reorder` swallows every click inside it. The first
  is a `Reorder <title>` button, which opens a move menu with Move to top,
  Move up, Move down, and Move to bottom. Each item appears only where it
  applies. The second is a grip that only drags, unnamed because dragging is
  not a control a screen reader can offer. The grip comes last so that it
  keeps the row's trailing edge, which is where a drag looks for it. After a
  move a live region says where the song landed.
- Both controls appear only while the list holds more than one visible song.
- Reordering stops while selecting, because a drag and a multi-select cannot
  share one touch gesture. A selecting row also carries no swipe actions at
  all.
- On `ios` a pushed page swipes back, Ionic's own gesture.
- On a mouse, `/` focuses the search field, the arrow keys walk the rows,
  Enter opens the focused row, Escape leaves selection mode, and Cmd-A or
  Ctrl-A selects all. A shortcut stands down while a text field or an overlay
  holds the keyboard.

## Selection and bulk actions

The catalog and list detail share one selection mode. It is component state,
not a URL, so a link can never enter it.

- The musician enters with `Select`, the first item of the `More actions`
  menu, on both screens, or with a long press on a row. The catalog offers
  Select only while a song is visible.
- Each row's own control becomes its checkbox, carrying `role="checkbox"` and
  `aria-checked`, and a check mark appears on the leading edge as inert
  decoration.
- The chrome is the one place the two platforms diverge on purpose, because
  edit mode is a strong convention on each and the two disagree.

|             | `ios`                             | `md`, phone and wide                     |
| ----------- | --------------------------------- | ---------------------------------------- |
| Leading     | `Select All` or `Deselect All`    | `Cancel selection`                       |
| Title       | `3 Selected`                      | `3 selected`                             |
| Trailing    | `Done`                            | Status, Edit, Add to list, More actions  |
| Actions     | a footer toolbar of text buttons  | the toolbar itself                       |
| Tab bar     | hidden                            | stays                                    |

- On `md`, Select all and Deselect all live in the More actions menu, which
  stays live at zero selected because the mode always opens there.
- The count is a digit beside a word that can elide, so a bar with no room
  drops the word and never a digit. A screen wearing the selection toolbar
  shows no back button, because its exit control takes that place.
- The selection holds only visible songs. A song hidden by search, a filter,
  or the archived setting leaves the selection, so an action never touches a
  song the musician cannot see. Select all means every song in the current
  view.
- Every action applies at once, ends the mode, and raises a toast with Undo.
  There is no confirmation, because a confirmation gets clicked through and
  leaves no way back. A failed write keeps both the mode and the selection.
  Cancelling a sheet keeps the selection.
- Delete is the one exception, because it takes recordings with it and no
  undo can bring back a recording already gone from the server. It confirms
  through the app's own overlay, the same question the song page asks, and
  raises no toast. Dismissing the confirmation keeps the mode and the
  selection.
- The musician leaves with the toolbar's own exit control, Escape on a mouse,
  leaving the screen, or by completing any action, plus, on a native build,
  the Android hardware back button. The back button is registered below
  Ionic's overlays and above its router, so Back closes a sheet, then leaves
  selection, then leaves the screen.
- Shift-click extends the selection from the last toggled row. Cmd-A or
  Ctrl-A selects all and never clears it, because the one key that means
  everything must not also mean nothing.
- Focus moves to a row's checkbox on entering, the held row or the first one.
  On leaving it returns to the control the mode opened from, or to the
  screen's landmark when that control has gone.
- Status opens a menu of the three statuses. Add to list opens the same list
  picker the song page uses. The overflow holds Archive and Unarchive, on a
  list Remove from list, and Delete last of all, each counting only the songs
  it will change. It is named `More actions` in the `md` toolbar and `More` in
  the `ios` footer.
- Bulk edit is the song form's own Details list over many songs: Status, Key,
  a group per visible tuning, then the details. Each row reads the value
  every selected song shares, `Not set` when they are all empty, or `Mixed`
  when they disagree. Only a row the musician touches is written, and Save
  stays dead until one is. A choice row clears through its own Clear option,
  and a yes or no row keeps every song as it is through Keep. Status has no
  empty choice at all, because a status cannot be cleared. `Other…` here
  keeps the current value rather than clearing it, because clearing has its
  own option.
- Title, alternate titles, and notes are never bulk editable.

## Forms

Every form is a sheet, or a centered dialog on a mouse frame. There is no
form route and no save bar.

- The actions live in the sheet's toolbar: `Cancel` leads, and a bold
  primary action trails, named for what it does: Save, Add, Create, Add link,
  Done. The filter sheet leads with Reset instead, and a sheet whose rows are
  the actions carries Cancel alone.
- A form is a column of sections, not a column of fields. A section is an
  inset group holding one or more related fields; its header names the group,
  its footer carries help for the group, and a validation message replaces
  that footer in red. Help text is never a row inside a card, because a line
  between two hairlines reads as another row. A control that is not a list, a
  segmented control or a grid of pills, sits on the grouped background at the
  same gutter as the cards.
- One spacing scale serves every form and every grouped screen: a 16px
  gutter for cards and bare controls, header, footer, help, and error text at
  the 32px row inset so it lines up with the row labels, 24px above a header,
  8px below a header and above a footer, 16px between two cards with no
  header between them, and the 44px row height every tap target keeps.
- Every field shows where to type. A row with no value reads "Not set" rather
  than reading as empty space, and a field standing on its own rather than in a
  row carries a placeholder naming what goes in it. A placeholder is never an
  example value: a musician cannot tell a hint from something the form already
  holds, and an example drawn from one tradition means nothing to someone who
  plays another.
- A single-field sheet carries no header at all: its title already names the
  field, and a header under it would only repeat it.
- The song form serves both new and edit and ranks its fields by how often a
  musician touches them. The title is one field on its own, with no header,
  since the sheet is titled New song or Edit song. Then Status, then Key, then a Tuning group holding one row per visible instrument, then
  Notes. Then a Details list gives one row each, in this order, to Also known
  as, Mode, Genre, Time signature, Feel, Parts, Crooked, Has lyrics, Learned
  from, and Learned on. A detail row is an inline select, input, toggle, or
  date row, so no sheet stacks on the song form.
- Only the title is required. The one validation message is "A title is
  required", shown under the title field on submit; the field takes focus and
  marks itself invalid, and the message clears at the first keystroke. Every
  other limit is a length cap the field enforces as the musician types, so
  there is nothing else to reject.
- The tuning fields to show are decided when the form opens, so a field never
  disappears mid-edit.
- The primary action is disabled while the write is pending. Where the form
  cannot succeed yet, it stays disabled until it can: the bulk edit sheet
  until a row is touched, the list picker's Create until a name is typed.
- Five sheets refuse a backdrop tap and a drag down: the song form, the list
  name sheet, the rename recording sheet, the paste link sheet, and the
  first-run question. Cancel is the way out of the first four. The filter
  sheet, the pickers, and the bulk edit sheet do dismiss that way, and each of
  them closes through its dismissal rather than around it. Any sheet refuses
  while its own write is pending.
- Toggling a setting saves it at once. There is no Save button on the
  settings screen.

## Sheets, menus, confirmations, and toasts

Each of these follows the pointer, and each is implemented once.

- A sheet is a bottom sheet with a grabber on touch, opening part way and
  dragging to full, and a centered dialog 480px wide on a mouse. It has a
  title, which also names the dialog, because Ionic does not read the toolbar
  title. A title that counts what is selected stays in step with the count.
- A menu is an action sheet on touch and a popover anchored to its button on
  a mouse. A destructive item is red and follows a separator, and a
  cautionary one takes the warning color. The action sheet adds its own
  Cancel.
- The song page's toolbar holds Edit and a More actions menu of Add to list,
  Archive or Unarchive, and Delete.
- The song page's Lists group shows each list the song is in as a row. The
  row opens the list and carries a Remove action. An "Add to list" row below
  them opens the shared list picker.
- A destructive action confirms through the app's own overlay, which follows
  the pointer: an action sheet from the bottom on touch, an alert on a mouse.
  It resolves true only for the named action, so a backdrop tap, Escape, and
  Cancel all mean no. The confirming button is the bare verb.
- The message names the consequence and warns when data cannot be recovered.
  Deleting a song reads
  `Delete "Soldier's Joy"? This removes its links and list entries.`, which
  grows to name the recordings it takes with it, and gains
  `Some recordings have not uploaded, so they cannot be recovered.` when one
  of them has not. Deleting a recording reads
  `It is removed from every device.`, or
  `It has not been uploaded, so this cannot be undone.` Deleting a list reads
  `Its songs stay in the catalog.`
- A bulk action is the exception, and applies at once with Undo in a toast.
  Bulk Delete is the exception to that exception: it confirms, and its
  question counts the selection, `Delete 12 songs? This removes their links,
  list entries, and 4 recordings.`, naming one selected song by title the way
  the song page does.
- A toast is for an action that offers Undo, and for the rare error that
  arrives after the musician has left the screen. Every other error shows
  inline beside the control that failed.
- One toast at a time, from one provider mounted in the shell. A new one
  replaces the old. It stays about eight seconds. On the phone frame it
  anchors to the tab bar, so a message raised by the action that ended
  selection mode waits for the bar to come back rather than landing on top of
  it. The wide frame has no tab bar, so the toast takes the bottom of the
  page and waits for nothing.
- The first-run question "Which instruments do you play?" has no Cancel at
  all, so answering it is the only way out. It opens once the first clean sync
  of a session finds no saved answer, never over the record screen and never
  in an offline session. Done saves whatever is checked, even nothing.

## Recording and link rows

Recordings and links share one row shape.

- The row has a fixed glyph slot on the left, at the row's tap height. For a
  recording the slot holds play, stop, a spinner, or a download cloud. For a
  link it holds play or stop when the provider can be embedded, and nothing
  when it cannot.
- The row itself is the control. Tapping a recording plays it when the audio
  is on the device and downloads it when it is not. Tapping a link plays it
  in the dock when the provider can be embedded, and opens the provider's own
  site in a new tab when it cannot, so no row is ever dead to a tap.
- A recording's title is its own label, then the song's title, then
  "Recording," with the date and time. In a list that already heads the
  recording's group with that song, the song is skipped, so a row never
  repeats the heading above it.
- Its second line joins four parts with middle dots: the duration, the
  status word or the recorded time, the count of failed uploads, and how much
  of the quota is spent when a full one blocked it. A download offered while
  offline reads the duration and "Offline" instead.
- A third red line carries an upload or download error, with a Retry button
  at the row's trailing edge.
- Status words are Recording, Waiting to upload, Uploading, Storage full,
  Upload failed, Downloading, Processing, and Couldn't process. A recording
  that needs nothing from the musician shows when it was made instead. A
  recording whose upload has failed and is waiting to try again adds the
  count, "3 failed tries", and offers Retry, which tries again at once
  instead of after the backoff.
- Durations read `m:ss`. Sizes truncate rather than round, so a size never
  overstates.
- A link's title is what the provider resolved it to, then the label the
  musician typed, then its host. Its second line is the link out to the
  provider: the provider's name and an arrow, or "Open" for a provider with
  no name of its own, named in full for a screen reader as "Open Soldier's
  Joy on YouTube". The provider is named there and nowhere else on the row,
  and a label the musician typed shows only where it stands in as the title.
- On the Recordings screen, recordings group under their song. The group is
  headed by the song's own row where the catalog holds the song, and by a
  plain header otherwise. Unfiled recordings head their group with "Unfiled".
- The dock opens only from a play tap. Opening a song never loads a player.
  At most one item is loaded, and it stays loaded while the musician browses.
  Starting a recording closes it.
- The record screen is a modal with a status line, a live waveform, a timer,
  a round red Stop, and Cancel below it. A live recording refuses a swipe
  dismissal, so Stop and Cancel are the ways out, and Cancel confirms before
  it discards anything captured.

## Empty, loading, sync, and offline states

- An empty list shows an icon, a title, an optional hint, and an optional
  action. Titles in use: "No songs yet" with the hint "Add the first song you
  know.", "Nothing matches", `No song called "query"`, "No lists yet",
  "Nothing in this list", "Every song here is archived", "This song is gone",
  "This list is gone", "No recordings yet", and, inside a section on the song
  page, the compact "Nothing recorded yet".
- Loading is silence, not a spinner. A screen renders its one page in every
  state and shows nothing in the body until its data is read. Swapping the
  page element after the outlet has mounted it leaves the outlet holding a
  detached page. The only spinners are the sign-in splash and a downloading
  recording row.
- The sync badge shows `Offline`, `Sign in again`, and `Sync failed`, and
  says nothing while a sync is clean or running. It sits at the leading edge
  of a top-level toolbar on the phone frame, and last in the sidebar on the
  wide frame.
- Settings shows the full state: the sync status (Synced, Syncing, Offline,
  Sign in again, Sync failed), the recordings transfer status (Up to date,
  Transferring, Offline, Transfer failed), a count of changes the server
  rejected, and a Sync now button.
- Pull to refresh on Catalog, Lists, and Recordings runs a sync on touch.
  Sync now in Settings is its visible equivalent.
- Offline, a control that needs the network refuses rather than disables. The
  download row keeps its name and its tap, dims, and says Offline on its meta
  line. Sign out is the one control that is disabled instead, with the help
  text "Sign out needs a connection.". The session cannot be ended without a
  connection, and the local catalog must not be deleted while the session it
  belongs to is open.
- The dock says "Offline", "Couldn't download", "Downloading", or "Not
  available", with an inline Retry once a download has failed and the device
  is online again.
- A remembered musician is admitted offline once the browser reports no
  connection, or after a five second grace period, and the account row then
  reads "Signed in (offline)".

## Motion

- Page transitions and swipe-back are Ionic's per-mode defaults, unmodified.
  On the wide frame they are off, and the pane swaps in place.
- Sheets, modals, menus, alerts, and toasts use Ionic's own presentation.
- The app's own motion is two things: the record dome scales down while
  pressed, and the waveform on the record screen scrolls as it draws.
- Under reduced motion the dome does not scale and the waveform updates fixed
  bars in place.

## Where each pattern lives

Paths are relative to `web/`. A new screen composes the component in the right
column instead of rebuilding the pattern.

| Pattern                                   | Implemented in                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Mode, frame, and pointer                  | `src/platform/mode.ts`, `src/platform/frame.ts`, `src/platform/pointer.ts`                        |
| Router, outlet, and the two frames        | `src/app/Shell.tsx`, `src/app/routes.tsx`, `src/app/tabs.ts`                                      |
| Tab bar and the record dome               | `src/app/PhoneTabBar.tsx`, with the dome's styles in `src/app/theme/variables.css`            |
| Sidebar                                   | `src/app/Sidebar.tsx`                                                                     |
| Page, toolbar, landmark, content column   | `src/ui/Screen.tsx`                                                                       |
| Inset group, its header, help, and error  | `src/ui/Group.tsx`, `src/ui/SectionHeader.tsx`                                                |
| Palette, type roles, layer order          | `src/app/theme/variables.css`, `src/app/theme/typography.css`, `src/app.css`                      |
| Appearance and text size setting          | `src/features/settings/appearance.ts`, the inline script in `index.html`               |
| The mark and the lockup                   | `src/ui/Mark.tsx`, with the sources in `brand/` at the root                                        |
| List row, swipe and hover actions         | `src/ui/Row.tsx`                                                                          |
| Long press                                | `src/ui/longPress.ts`, with the haptic in `src/platform/haptics.ts`                           |
| Keyboard shortcuts and arrow keys         | `src/ui/useShortcut.ts`                                                                   |
| Song row                                  | `src/features/catalog/SongItem.tsx` (`SongItem`, `SongLines`, `StatusDot`)                |
| List row for lists                        | `src/features/lists/ListItem.tsx`                                                         |
| Status labels                             | `src/features/catalog/status.ts`                                                          |
| Key and mode line, facet capsules         | `src/features/song/SongScreen.tsx`                                                        |
| Capsule, rail chip, and badge             | `src/ui/Capsule.tsx`                                                                      |
| Which tunings to show                     | `src/features/settings/instruments.ts`                                                    |
| Instrument checkboxes, first-run question | `src/features/settings/InstrumentRows.tsx`, `src/features/settings/FirstRunSheet.tsx`         |
| Suggestion vocabularies                   | `src/features/song/suggestions.ts`                                                        |
| Suggestion picker with `Other…`           | `src/features/song/SuggestSelect.tsx`                                                     |
| One shape for a labeled field row         | `src/ui/FieldRow.tsx`                                                                     |
| Status chooser                            | `src/features/song/StatusChooser.tsx`                                                     |
| Key grid and the two key vocabularies     | `src/features/song/KeyChooser.tsx`, `src/features/song/suggestions.ts`                    |
| Key pill and its colors                   | `src/ui/KeyPill.tsx`, `src/ui/keyColor.ts`                                                |
| Search field                              | `src/ui/SearchField.tsx`                                                                  |
| Search or create                          | `src/features/catalog/searchIntent.ts`, `src/features/catalog/SearchOffer.tsx`                |
| Song search picker                        | `src/features/catalog/SongSearch.tsx`                                                     |
| Catalog query for the session             | `src/features/catalog/searchSession.ts`                                                   |
| Filter rules and count wording            | `src/features/catalog/filters.ts`                                                         |
| Filter bar and filter sheet               | `src/features/catalog/CatalogFilters.tsx`, `src/features/catalog/CatalogFilterSheet.tsx`      |
| Reorder grip and move menu                | `src/features/lists/ListSongs.tsx`                                                        |
| Selection mode, focus, keys, back button  | `src/features/selection/useSelection.ts`, `src/features/selection/useSongSelection.ts`        |
| Selection toolbar and footer              | `src/features/selection/SelectionToolbar.tsx`, `src/features/selection/SelectionFooter.tsx`   |
| Hiding the tab bar while selecting        | `src/features/selection/SelectionProvider.tsx`                                            |
| Bulk actions, their toasts and undo       | `src/features/selection/useBulkActions.tsx`, `src/features/selection/copy.ts`                 |
| Bulk edit sheet                           | `src/features/selection/BulkEditSheet.tsx`, `src/features/selection/batchEdit.ts`             |
| Song form and its limits                  | `src/features/song/SongFormSheet.tsx`, `src/features/song/limits.ts`                          |
| Song form detail fields                   | `src/features/song/detailFields.ts`                                                       |
| List picker and song picker               | `src/features/lists/ListPicker.tsx`, `src/features/lists/SongPickerSheet.tsx`                 |
| Sheet and dialog                          | `src/ui/Sheet.tsx`                                                                        |
| Menu                                      | `src/ui/Menu.tsx`                                                                         |
| Confirmation                              | `src/ui/Confirm.tsx`, message wording in `src/features/song/deleteSongMessage.ts`             |
| Toast and Undo                            | `src/ui/Toast.tsx`                                                                        |
| Inline error and one wording for refusals | `src/ui/InlineError.tsx`, `src/ui/useAction.ts`                                               |
| Recording and link rows                   | `src/features/recordings/RecordingItem.tsx`, `src/features/links/LinkItem.tsx`                |
| Recording title, meta, and row control    | `src/features/recordings/recordingRow.ts`, `src/features/player/rowGlyphs.tsx`                |
| Recording status words and sizes          | `src/features/recording/format.ts`                                                        |
| Row actions on a recording                | `src/features/recordings/useRecordingActions.ts`                                          |
| Record screen and the one seam into it    | `src/features/recording/RecordModal.tsx`, `src/features/recording/useRecord.tsx`              |
| Player dock                               | `src/features/player/Dock.tsx`, `src/features/player/playerHeight.ts`                         |
| Empty state                               | `src/ui/EmptyState.tsx`                                                                   |
| Sync badge and the full state             | `src/ui/SyncBadge.tsx`, `src/sync/labels.ts`, `src/features/settings/SyncGroup.tsx`               |
| Relative date wording                     | `src/features/lists/editedLabel.ts`                                                       |
| Reduced motion                            | `src/platform/motion.ts`, `src/app/theme/variables.css`                                       |
