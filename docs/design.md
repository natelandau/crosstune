# Crosstune design patterns

This page records how the app behaves on every screen: the words it uses,
how it lays out a screen, what a row looks like, how gestures work, and what
the musician sees while something loads, fails, or waits for a connection.
A new screen follows these rules. When a rule and a screen disagree, the
rule wins and the screen is the bug.

Each pattern is implemented once. The table at the end of this page,
"Where each pattern lives", names the component for each one, so a new
screen composes it instead of rebuilding it. The palette, the type scale,
and the spacing scale are decided in the visual design spec in the project
vault and encoded in the stylesheet. This page describes their effect and
does not repeat their values.

## Words in the interface

- The glossary in `product.md` defines the terms and sets the two naming
  rules: song, never tune, and violin, never fiddle.
- Every label, button, heading, and tab is sentence case. Only proper nouns
  keep their capitals: Crosstune, YouTube, Apple Music, TIDAL.
- A button is a bare imperative verb: Edit, Save, Cancel, Delete, Archive,
  Rename, Select, Retry, Undo, Open. An object follows only when the target
  is ambiguous: Add song, Add link, Create list, Delete list, Add to list,
  Remove from song, Sync now.
- A count goes into the label of anything that acts on several songs:
  "Archive 3 songs", "Apply to 5", "Set 3 songs to Learning", "2 of 5 in
  it". One song reads "1 song".
- A song or list title inside a message sits in straight double quotes:
  `Delete "Soldier's Joy"?`, `Add "Soldier"`, `"Soldier's Joy" is archived.`
- Help text is one or two full sentences with a period. A label has no
  period.
- A placeholder that gives examples is lowercase and ends in three dots:
  `Tuesday jam, square dance set, ...`. A search placeholder is an
  imperative with a capital: `Search songs`, `Add a song`.
- A control that opens more interface ends in an ellipsis: `New list…`.
- The empty choice in a picker reads "Not set". In a filter it reads "All" on
  the key rail and "Any" inside the filter sheet. In the bulk edit sheet the
  clearing choice reads "No value", the unchanged choice for a yes or no
  field reads "Keep", and a field whose songs differ shows "Mixed".
- A set filter shows as a filled pill named for its value, and its remove
  control is named "Remove filter" and the value, so a screen reader hears
  "Remove filter Cross A (AEAE)".
- A relative date carries its verb: "Edited today", "Edited yesterday",
  "Edited Mar 4", with the year only when it is not the current year.
- A control that acts on one thing is named for the action and the thing,
  so a screen reader hears "Edit Soldier's Joy", "Reorder Soldier's Joy",
  "Play Soldier's Joy", "Open Soldier's Joy on YouTube". The visible control
  can show only an icon, but its name always carries the title.

## Layout and chrome

- Every screen's content sits in one centered column about 70 characters
  wide, with a 16px gutter on a phone. The column is a fixed width, so the
  text size setting scales the type and not the column. Floating controls,
  the docked player, and the toast align to the column's right edge on a
  wide screen, not the viewport's.
- The app bar is sticky and painted in the chrome color. It holds the
  lockup, the mark beside the app name, as a link home on the left, any
  actions the current page publishes, and the sync badge on the right. The
  song page publishes one More actions menu. In selection mode the same bar
  becomes the selection bar in place.
- The bottom navigation holds five slots in this order: Catalog, Lists, the
  record button, Recordings, Settings, as five equal slots edge to edge. A
  tab is a glyph over a short label. The current tab shows by color alone:
  its whole slot fills with the bar's text color and its glyph and label
  take the bar color, while the other tabs mute. There is no underline.
  Under a mouse, a slot tints faintly on hover. The selection action bar
  uses the same shape for its four slots.
- The record button in the navigation and the Record button on a song page
  are the only ways to start a recording. The song page's button files the
  new recording under that song. The navigation button sits in the center of
  the navigation and is the one red control on the screen. Its disc is a
  step larger than the bar's other controls and its cap rises above the
  bar's top edge, floating over the content that scrolls beneath it. The
  docked player sits above the cap.
- The record screen owns the viewport. It shows no navigation and no docked
  player.
- The docked player sits above the navigation in the chrome color, full
  width on a phone and a fixed width against the column's right edge on a
  wider screen. Floating controls and the toast move up to clear it.
- A screen is a page heading, then sections 32px apart. Inside a section,
  blocks sit 12px apart. A control sits 4px from the help text that explains
  it, and help text follows its control, never precedes it.
- An error about one control is a short red line under that control. A page
  action started from the app bar menu reports its failure under the page
  heading. A row action in a recording or link list reports under that list.
  A form action started from the save bar reports its failure inside the
  bar.

## Color, type, and icons

- The palette is eight colors and nothing is derived. Light mode has no
  grey surfaces. Rows sit flat on the page, not on cards.
- The app bar, the bottom navigation, and the docked player share one
  chrome color, the same slate in light and dark mode.
- Success and info are not green and blue. They are the slate and the clay,
  because only the status dot and the archived badge use them. Error is the
  coral, and it marks destructive actions and the record button.
- Type comes in named roles: timer, page heading, key line, app name, song
  title, body, control label, metadata, small. A screen uses a role and
  never sets a size, weight, or tracking of its own.
- Numerals are tabular wherever a number can change or line up: keys,
  tunings, time signatures, the timer, durations, positions.
- The text size setting has three steps, compact, regular, and roomy, and
  scales every size at once. Inputs never drop below 16px, so iOS does not
  zoom on focus.
- Appearance and text size are per device and need no account. They apply
  before the first paint, so there is no flash. Sign-out leaves them alone.
- Every tap target is at least 44px tall. Rows are 56px or 64px tall.
- Every icon is hidden from assistive technology and sits inside a control
  that carries its own name. Icons are small inline, medium on row and
  swipe actions, and large in the bottom navigation, in the selection
  action bar, and on the primary add controls, where the floating add
  button takes one step more.

## Identity

- The mark is a geometric CT monogram. The C's top arm runs straight into
  the T's crossbar, and the stroke changes to coral where the T begins. The
  T is a true T with its stem centered on its crossbar.
- Two colorways and no others. On a dark surface the C is white; on a light
  surface the C is slate. The T is always coral. The colorway follows the
  surface, never the brand. In the client the C takes the text color and
  the T the `mark` color token, which is the coral the sources are drawn
  with and does not move with `error`.
- The app icon, the favicon, and the PWA icons use the dark colorway on the
  slate tile. They are generated from `brand/icon-dark.svg` by
  `just web::icons` and never edited by hand.
- The name is set in Geist semibold in one color, the `brand` or `heading`
  type role. It is never split or recolored by syllable.
- A lockup is the bare mark to the left of the name, the mark as tall as
  the capitals, with a gap of 0.4 of the cap height.
- Inside the client the mark appears in the lockup, on the sign-in screen
  and in the app bar. On the bar the C is white on the chrome in both
  themes, because the bar is the same slate in both.
- The sources for marketing, bare and tiled in both colorways, live in
  `brand/` at the repository root.

## Song rows

Everywhere the app lists songs, it uses the same row.

- Line one is the title alone, truncated when long.
- Line two holds, in this order, each part omitted when unset: the key in
  bold tabular figures, the status dot with its label, the tunings in a
  muted tone, and the word "Archived".
- Tunings appear only for instruments the musician plays, joined with a
  middle dot, violin before banjo.
- An archived row is dimmed as a whole.
- Tapping the row opens the song. While selecting, a tap toggles the row's
  checkbox instead.
- In a list, the row gains a position number on the left and a drag handle
  on the right.
- The catalog, list detail, the picker that adds a song to a list, the
  picker that attaches a recording to a song, and the song headings on the
  Recordings screen all show this row. A screen never lays out a song's
  title and key its own way.

## Keys, modes, and tunings

- A row shows the key alone, never the mode. Mode and feel belong to the
  song page and the filter bar.
- The song page shows the key and the mode as one line under the title:
  "A mixolydian". Modes are lowercase everywhere, in selects, filters, and
  badges.
- On the song page every other facet is an outline badge, in this order:
  violin tuning, banjo tuning, time signature, Crooked, feel, genre, part
  structure, Lyrics. A badge appears only when the song has the value. An
  archived song adds a warning badge last.
- A tuning field, filter, or badge appears only for an instrument the
  musician plays. The one exception is a field that already holds a value,
  which is always shown so data never becomes unreachable. A song row is
  stricter and shows a tuning only for a played instrument.
- Key, tuning, genre, feel, and part structure offer their suggestions as
  chips and an Other… chip that reveals a text field, never a closed list,
  so a musician can always type a value the suggestions lack. A typed value
  then shows as a chip of its own. Keys are suggested with flats, not
  sharps. A tuning suggestion reads as a name and the strings in
  parentheses, with a lowercase letter for a drone string: "Cross A
  (AEAE)", "Sawmill (gDGCD)".
- The labels "Violin tuning" and "Banjo tuning" read the same on the song
  form, in the filter bar, and in the bulk edit sheet.

## Status

- A song is known, learning, or want to learn. The labels are "Known",
  "Learning", and "Want to learn".
- Status is never shown as color alone. Where a dot appears, its label
  appears beside it. Known is a filled dot in the success color, learning a
  filled dot in the info color, and want to learn a hollow ring.
- The dot and label pair appears in song rows and in the bulk status sheet.
  The status filter, the status picker on the song form, and the bulk edit
  select show the label alone.
- A status value the app does not recognize shows as want to learn.

## Search and create

Every box that searches songs also offers to create one, with the same
rules in the catalog, in the picker that adds a song to a list, and in the
picker that attaches a recording to a song.

- A non-empty query always shows an add row under the results, labeled
  `Add "query"`. Titles are not unique, because different songs share a
  name, so an exact match never hides the offer. When a song already
  carries the title the row reads `Add another "query"`.
- When the exact match exists but is hidden by the archived toggle or a
  filter, a note names it with an Open link before the add row:
  `"Soldier's Joy" is archived.` or `"Soldier's Joy" is hidden by your
filters.`
- Enter opens the only visible result, or the hidden exact match when
  nothing is visible, or creates when nothing matches anywhere. With two or
  more results Enter only closes the keyboard. Enter never creates a song
  whose title already exists. That takes a deliberate tap.
- The add row carries the typed title into the new song form, so nothing is
  retyped. From a picker it also carries the list or the recording, so the
  saved song is added to the list or holds the recording.
- A picker never hides a song it cannot offer. A song already in the list
  stays in the results, dimmed and marked "In this list", so an exact match
  is never mistaken for a missing song. Enter on it does nothing.
- The search box's placeholder reads "Search songs", the phone keyboard's
  return key reads Search, and a clear button inside the box empties the
  text and keeps focus there.
- The catalog query lasts for the visit. It survives opening a song and
  coming back. A new launch, a new tab, opening the new song form, and
  sign-out all clear it. Filters persist. Free text does not.
- Clearing a filter never touches the query. Status and key clear from
  their own All chips, a sheet filter from its pill or the sheet's Reset.

## Filters

Only the catalog has a filter bar.

- Row one is the search field beside the Filters button. The button carries
  a count of the filters set inside the sheet, and its name reads "Filters,
  2 set", because filters persist between visits and a stale one must
  announce itself.
- Row two is the status group: All, Known, Learning, Want to learn, with
  the pressed one filled.
- Row three is the key rail: All, then every key the catalog holds, as
  chips in one scrolling row that fades at its right edge. One tap sets a
  key, a tap on All or on the pressed key clears it. The rail appears only
  when the catalog holds keys.
- Mode, violin tuning, banjo tuning, genre, and Show archived live in the
  filter sheet, in that order, each facet as a chip group whose first chip
  is Any. A facet appears only when the catalog holds values for it, and a
  tuning only when the musician also plays that instrument. A hidden facet
  can never narrow the catalog in silence.
- Every tap in the sheet applies at once, and the first line of the sheet's
  body, under its title, is the live count in the same words as the count
  row. Reset clears the sheet's filters and nothing else. Done closes it.
- A set sheet filter also shows under the key rail as a filled pill with a
  remove control. Show archived reads "Archived shown".
- Under the filters a count row reads "84 songs", or "11 of 84 songs" while
  anything narrows the list, and holds the Select button at its right edge.
  The row is absent while the catalog is empty.
- Matching ignores case and accents.
- Catalog filters persist and come back on the next launch. List screens
  have their own Show archived setting, off by default, shared by every
  list and untouched by the catalog.

## Gestures

Every gesture has a visible equivalent. Swipe actions also exist as buttons
on the song page, long press has the Select button, and drag has the move
menu.

- A list row swipes left to reveal one to three actions as icon buttons.
  Each action has a tone: neutral, warning, or error.
- With a mouse the same actions show as visible icon buttons at the row's
  right edge, because nothing hints that a row swipes.
- A full swipe only opens the row. It never runs an action, so no swipe is
  ever destructive.
- One row is open per screen. A scroll closes it. While a row is open, a
  tap on any row only closes it and does not open the song.
- These lists swipe, with their actions in order:

| List            | Actions                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| Catalog songs   | Edit (neutral), Archive or Unarchive (warning)                              |
| List songs      | Edit (neutral), Remove (error)                                              |
| Lists           | Edit (neutral), Delete (error)                                              |
| Recordings      | Rename (neutral), Add to song or Remove from song (warning), Delete (error) |
| Recording links | Remove (error)                                                              |

- Edit on a song row opens the song page in edit mode, and Save or Cancel
  returns to the screen the musician came from.
- Long press exists only on song rows and only to enter selection mode with
  that row selected. It takes half a second, a swipe or a scroll never
  counts as one, and the phone vibrates briefly where it can.
- Reordering in a list uses a grip handle at the row's right edge. A tap,
  a click, Enter, or Space on the handle opens a menu with Move to top,
  Move up, Move down, and Move to bottom, so reordering never needs a drag.
  After any move a screen reader hears the new position.
- Swipe is off while selecting, and every row rests closed.

## Selection and bulk actions

The catalog and list detail share one selection mode.

- The musician enters with the Select button or a long press on a row, and
  leaves with the Cancel selection button in the app bar, Escape, Back, or
  by completing any action. Android Back and browser Back leave the mode
  before they leave the screen.
- The app bar becomes the selection bar: Cancel selection on the left, "N
  selected" in the middle, Select all or Deselect all on the right.
- The bottom navigation becomes the action bar with four fixed slots in
  this order on every screen: Status, Edit, Add to list, More, each a
  glyph over its label like a tab. More holds Archive, Unarchive, and on
  a list Remove from list, each with its count.
  A slot with nothing selected dims and does not vanish.
- The selection holds only visible songs. A song hidden by search, a
  filter, or the archived toggle leaves the selection, so an action never
  touches a song the musician cannot see. Select all means every song in
  the current view.
- Every action applies at once, ends selection mode, and shows a toast with
  Undo. There is no confirm. Cancelling a sheet keeps the selection.
- Shift-click extends the selection from the last toggled row. Ctrl-A or
  Cmd-A selects all when focus is not in a text field.
- Focus moves to a row's checkbox on entering and returns to the Select
  button on leaving.
- The Edit sheet shows each field's shared value, "Mixed", or empty, and
  marks a field "will change" or "will clear" when the musician edits it.
  Only marked fields are saved. Title, alternate titles, and notes are
  never bulk editable.
- A field with a vocabulary is a chip group like the song form's, with the
  same suggestions and Other… chip. Its chips show only the pending change:
  no chip filled keeps every song as it is, the shared value or "Mixed"
  reads in the field's legend, and a trailing "No value" chip clears the
  field. Status has no "No value" chip. A tap that lands on the shared
  value is no change. Crooked and Has lyrics stay Keep, Yes, No; Learned
  from and Learned on stay a text and a date field, where emptying the
  field clears it.

## Forms

- The song form serves both new and edit and ranks its fields by how often
  a musician touches them. Title, status, key, one tuning per visible
  instrument, and notes come first with full controls. Then a Details list
  gives one line each, in this order, to also known as, mode, genre, time
  signature, feel, parts, crooked, has lyrics, learned from, and learned
  on. A line shows its value or "Not set", and a tap opens a picker sheet
  or a text sheet for it. Crooked and has lyrics are switches in the line,
  and learned on is a date field in the line. The bulk edit sheet keeps its
  own order.
- Only the title is required. The one validation message is "A title is
  required", shown under the title field on submit, and the title field
  takes focus. Every other limit is a length cap the field enforces as the
  musician types, so there is nothing else to reject.
- Each field in a multi-field form has a visible label. A single-input
  form whose title or placeholder states its purpose, such as a rename
  sheet or the create list row, needs no separate label.
- A select's empty choice reads "Not set". Free text with a vocabulary
  offers suggestions and accepts anything.
- The tuning fields to show are decided when the form opens, so a field
  never disappears mid-edit.
- In a page form the actions sit in a bar fixed above the navigation and
  the player, so Save is reachable without scrolling: the primary action
  comes first and takes the remaining width, with Cancel beside it. In a
  sheet, Cancel is on the left and the primary action on the right, both
  the same width. A sheet whose rows are the actions has only a full-width
  Cancel at the bottom.
- The submit button is disabled while the write is pending and, where the
  form cannot succeed yet, until it can: the link form until the URL is
  valid, the bulk edit sheet until a field is touched.
- Toggling a setting saves it at once. There is no Save button on the
  settings screen.

## Sheets, menus, confirmations, and toasts

- A sheet slides up from the bottom on a phone and is a centered dialog on
  a wider screen. It has a title, traps focus, closes on a backdrop tap or
  Escape, and returns focus to where it was.
- A menu is a native popover anchored to its button. It opens over the page,
  never clipped by the row it belongs to, focus lands on its first enabled
  item, the arrow keys move focus between items, and Escape or a tap outside
  closes it and returns focus to the button.
- The song page's actions, Edit, Add to list, Archive or Unarchive, and
  Delete, live in a More actions menu in the app bar. Delete follows a
  divider and is red.
- The song page's Lists section shows each list the song is in as a pill
  with a remove control named "Remove from" and the list, beside an Add to
  list button that opens the shared list picker.
- A destructive action confirms with the browser's own confirm dialog,
  never a custom one. The message names the consequence and warns when
  data cannot be recovered: `Delete "Soldier's Joy"? This removes its
links, list entries, and 3 recordings. Some recordings have not uploaded,
so they cannot be recovered.` A recording that has uploaded reads `It is
removed from every device.` instead.
- The exception is a bulk action, which applies at once with Undo in a
  toast, because a confirm gets clicked through and leaves no way back.
- A destructive button is an outlined red button. Inside a menu, a
  destructive item is red and a cautionary one is the warning color.
- A toast is for an action that offers Undo, and for the rare error that
  arrives after the musician has left the screen. Every other error shows
  inline beside the control that failed.
- One toast at a time. A new one replaces the old and drops its Undo. It
  sits above the navigation and the player, stays about eight seconds,
  pauses while hovered or focused, and is announced without taking focus.

## Recording and link rows

Recordings and links share one row shape.

- The row has a fixed glyph slot on the left. For a recording the slot
  holds play, stop, a spinner, or a download cloud. For a link it holds the
  artwork or a badge with the provider's first letter.
- The row itself is the control. Tapping a recording plays it if the audio
  is on the device and downloads it if not. Tapping a link plays it in the
  docked player when the provider can be embedded.
- A recording's title is its label, then its song's title, then
  "Recording," with the date and time. Its second line is duration, then
  status or the recorded time, then size, joined with middle dots. A third
  red line carries an upload or download error, with a Retry button at the
  right edge.
- Status words are Recording, Waiting to upload, Uploading, Storage full,
  Upload failed, Downloading, Processing, and Couldn't process. A recording
  that needs nothing from the musician shows no status. A recording whose
  upload has failed and is waiting to try again adds the count, "3 failed
  tries", keeps the last error on the red line, and offers Retry, which
  tries again at once instead of after the backoff.
- Durations read `m:ss`. Sizes truncate rather than round, so a size never
  overstates.
- A link's second line is its optional label. Its right-hand control opens
  the provider's app or site and is named for the provider: "Open Soldier's
  Joy on YouTube".
- On the Recordings screen, recordings group under their song with the song
  row as the heading, unfiled recordings first under "Unfiled".
- The docked player opens only from a Play tap. Opening a song never loads
  a player. At most one recording is loaded, and it stays loaded while the
  musician browses.

## Empty, loading, sync, and offline states

- An empty list shows a centered title, an optional hint, and an optional
  action. Titles in use: "No songs yet" with the hint "Add the first song
  you know.", "Nothing matches", `No song called "query"`, "No lists yet",
  "Nothing in this list", "Every song here is archived", "This song is
  gone", "This list is gone", "No recordings yet".
  Inside a section, such as the recordings on a song page, the empty state
  is compact so the section's controls stay in reach.
- Loading is silence, not a spinner. A screen shows nothing until its data
  is ready. The only spinners are the sign-in splash, a downloading
  recording row, and the syncing badge.
- The sync badge in the app bar reads Synced, Syncing, Offline, Sign in
  again, or Sync failed. Synced and Syncing are quiet outlines. Offline is
  a warning fill. Sign in again and Sync failed are error fills. Only a
  state that needs attention takes a fill.
- Offline, a control that needs the network refuses rather than disables.
  It keeps its name and its focus, dims, and does nothing when pressed.
- The docked player says "Offline", "Couldn't download", "Downloading", or
  "Not available", with an inline Retry.
- Settings shows the sync status, the recordings transfer status (Up to
  date, Transferring, Offline, Transfer failed), a count of changes the
  server rejected, and a Sync now button. A failed fetch while the browser
  reports a connection is a transfer failure, not offline, because the
  storage host or a blocked origin refused. Sign out is disabled offline with the help text
  "Sign out needs a connection."
- A remembered musician is admitted offline after a five second grace
  period, and Settings then reads "Signed in (offline)".

## Motion

- Movement uses one emphasized easing curve. Fades ease out.
- Under reduced motion, colors and opacity still fade and nothing moves or
  scales.
- A swipe row snaps in a fifth of a second. A sheet slides up in about half
  a second. Entering selection mode animates the bars, the checkbox slots,
  and the row tints, with a short stagger down the first few rows.
- State never waits for an animation. A tap during a checkbox slide still
  toggles the row.

## Where each pattern lives

Paths are relative to `web/src/`, except one written as `../index.html`,
which sits beside it in `web/`. A new screen composes the component in the
right column instead of rebuilding the pattern.

| Pattern                                   | Implemented in                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Song count wording                        | `features/selection/copy.ts`, and the catalog's count row in `features/catalog/filters.ts` (`songCountLabel`)                            |
| Relative date wording                     | `features/lists/editedLabel.ts`                                                                                                          |
| Column, app bar, navigation, main region  | `components/RootLayout.tsx`, `components/AppBar.tsx`, `components/Dock.tsx`                                                              |
| Page actions in the app bar               | `components/pageChrome.ts`, `components/ActionMenu.tsx`                                                                                  |
| Record button                             | `features/recording/RecordButton.tsx`                                                                                                    |
| Docked player                             | `features/player/PlayerDock.tsx`                                                                                                         |
| Page heading, sections, fields, help text | `components/Page.tsx`                                                                                                                    |
| Palette, type roles, spacing, motion      | `app.css`                                                                                                                                |
| The mark and the sign-in lockup           | `components/Mark.tsx` (`Mark`, `Lockup`); sources in `brand/` at the root                                                                |
| Appearance and text size setting          | `features/settings/appearance.ts`, the inline script in `../index.html`                                                                  |
| Song row                                  | `features/catalog/SongCard.tsx` inside `features/catalog/SongRow.tsx`                                                                    |
| Status dot and labels                     | `features/catalog/StatusDot.tsx`                                                                                                         |
| Key and mode line, facet badges           | `features/song/SongDetail.tsx`                                                                                                           |
| Lists on the song page                    | `features/song/SongLists.tsx`                                                                                                            |
| Which tunings to show                     | `features/settings/instruments.ts`                                                                                                       |
| Suggestion vocabularies                   | `features/song/suggestions.ts`                                                                                                           |
| Search or create                          | `features/catalog/searchIntent.ts`, `features/catalog/SearchSuggestion.tsx`                                                              |
| Song search picker                        | `features/catalog/SongSearchPicker.tsx`                                                                                                  |
| Catalog query for the visit               | `features/catalog/searchSession.ts`                                                                                                      |
| Filter bar and filter rules               | `features/catalog/FilterBar.tsx`, `features/catalog/FilterSheet.tsx`, `features/catalog/filters.ts`                                      |
| Filter sheet                              | `features/catalog/FilterSheet.tsx`                                                                                                       |
| Show archived toggle                      | `features/catalog/ShowArchivedToggle.tsx`                                                                                                |
| Swipe row and actions                     | `components/SwipeRow.tsx`, `components/swipe.ts`                                                                                         |
| Long press                                | `components/useLongPress.ts`                                                                                                             |
| Reorder handle and move menu              | `features/lists/ReorderHandle.tsx`                                                                                                       |
| Selection mode, bars, sheets              | `features/selection/`, `editMode.ts`                                                                                                     |
| Choice chips and their label              | `ChoiceChips` and `ChipsField` in `components/ChoiceChips.tsx`                                                                           |
| Picker and text sheets                    | `components/PickerSheet.tsx`                                                                                                             |
| Detail, switch, and date rows             | `components/DetailRow.tsx`                                                                                                               |
| Fixed save bar                            | `components/SaveBar.tsx`                                                                                                                 |
| Song form and its limits                  | `features/song/SongForm.tsx`, `features/song/limits.ts`                                                                                  |
| Song form detail fields                   | `features/song/detailFields.ts`                                                                                                          |
| Menu                                      | `components/PopoverMenu.tsx`, the app bar menu in `components/ActionMenu.tsx`, the dock's More in `features/selection/BulkActionBar.tsx` |
| Sheet                                     | `components/Sheet.tsx`                                                                                                                   |
| Toast                                     | `components/Toast.tsx`                                                                                                                   |
| Inline error under a control              | `components/useAction.ts`, `ErrorText` in `components/Page.tsx`                                                                          |
| Recording and link rows                   | `features/recordings/RecordingRow.tsx`, `features/links/LinkRow.tsx`, `features/player/rowGlyphs.tsx`                                    |
| Recording status words                    | `features/recording/format.ts`                                                                                                           |
| Empty state                               | `components/EmptyState.tsx`                                                                                                              |
| Sync badge                                | `components/SyncIndicator.tsx`                                                                                                           |
