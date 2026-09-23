# Crosstune design rules

Rules every screen follows. When a rule and a screen disagree, the rule
wins and the screen is the bug. The client is Ionic React: each platform
supplies its own structure, and a rule says where the two differ on
purpose. Each pattern is implemented once, in `web/src/ui/` or its feature
folder. A new screen composes it and never rebuilds it.

## Words

- Song, never tune. Violin, never fiddle. The glossary in `product.md` holds
  the terms.
- Sentence case everywhere. Proper nouns keep their capitals. `ios` edit
  mode copies Apple's capitals.
- A button is a bare imperative verb: Edit, Save, Delete. Add an object only
  when the target is ambiguous: Add song, Add to list.
- Anything that acts on several songs carries the count: "Archive 3 songs",
  "1 song".
- A title inside a message sits in straight double quotes:
  `Delete "Soldier's Joy"?`
- Help text is one or two sentences with a period. A label has no period.
- An example placeholder is lowercase and ends in an ellipsis. A search
  placeholder is an imperative with a capital: `Search songs`.
- A control that opens more interface ends in an ellipsis: `New list…`.
- A glyph-only control is named in words.
- A picker's empty choice is named for what it does: "Not set" leaves a
  field empty, "Any" or "All" widens a filter, "Clear" erases across many
  songs, "Keep" changes nothing. Songs that disagree show "Mixed".
- A set filter is a filled capsule named for its value. Its remove control
  reads "Remove filter" plus the value.
- A relative date carries its verb: "Edited today", "Edited Mar 4", with the
  year only when it is not the current one.
- A control that acts on one thing is named action plus thing: "Edit
  Soldier's Joy". When the row is the control, its name is the verb plus the
  lines the row shows.

## Layout and chrome

Three axes decide the chrome. No screen asks which device it is on;
`src/platform/` answers.

| Axis    | Values           | Decides                                                   | Source                               |
| ------- | ---------------- | --------------------------------------------------------- | ------------------------------------ |
| Mode    | `ios`, `md`      | How components look and animate                           | Ionic's own detection, never forced  |
| Frame   | `phone`, `wide`  | Tab bar or sidebar, full width or a measured column       | Viewport width at 768px              |
| Pointer | `touch`, `mouse` | Swipe or hover, sheet or popover, whether shortcuts exist | `(hover: hover) and (pointer: fine)` |

- One router and one outlet always render. Routes are tab-scoped, so a song
  opened from a list stays in that tab and Back returns to the list.
- No overlay is a route. A modal or sheet opens over the current screen and
  the URL does not change.
- The phone frame has a tab bar and the wide frame a sidebar. The bar is
  hidden, not unmounted, on the wide frame, so each stack keeps its pushed
  pages.
- Wide-frame content sits in a 640px column, in pixels, so the text size
  setting scales the type and not the column.
- No app bar lockup and no link home.
- `Screen` is the one page component: page, toolbar, scrolling content, and
  landmark. A top-level screen opens with a large title on `ios` and the
  search bar under it. A pushed screen carries a back button.
- One action reached from several places opens one component, laid over the
  current tab, so finishing returns the musician where they were.
- Chrome at the bottom of the frame reserves its own room.
- An error shows beside the control that produced it. A group's error
  replaces its help text in red. A row action reports under its list. A
  screen action reports above the rows.

## Color, type, and icons

- Page background, fills, separators, and secondary text come from Ionic's
  per-mode defaults.
- Every screen and sheet takes the page background. A card is set off by a
  hairline ring in light mode and a lighter fill in dark, drawn as a shadow
  rather than a border so the content box and row inset never shift.
- Four Ionic roles carry meaning and no screen invents a fifth. `primary`
  tints anything chosen. `success` and `warning` mark status dots. `warning`
  also marks a cautionary action. `danger` marks every destructive one.
- The tab bar's record dot is recording red, through the `record` token,
  which does not move with `danger`.
- A control painted in a value's own color keeps that color when chosen.
- Dark mode is Ionic's system palette, switched by a class the appearance
  setting writes. The class and `data-theme` are stamped before first paint.
- `src/app/theme/variables.css` is imported outside every cascade layer.
  Ionic injects its component styles unlayered at runtime, and a layered
  rule loses to them whatever its specificity. Anything that must beat Ionic
  goes there.
- Ionic's label styles are unlayered too, so each type role is applied again
  unlayered to reach inside an `ion-label`. Put a color utility on a child
  span, never on the role element.
- Ionic copies `aria-*` onto its inner control once, at load, and strips it
  from the host. State that changes later is written to the control itself.
- Type comes in named roles: title, headline, body, subheadline, footnote,
  caption, timer, each defined once per mode in `layer(components)`. A
  screen uses a role and never sets a size, weight, or tracking. A role whose
  size is the point of a screen takes the size as a step on the role, chosen
  by a data attribute.
- A group header that labels a form section takes footnote in the secondary
  color. One that names the thing its rows belong to takes the title role.
  Each kind keeps a constant height whether or not it carries a control or
  opens anything. When a naming header leads somewhere, a chevron says so
  and the whole line is the target.
- A group's add action is a control at the trailing edge of its header,
  never a row in the card or a loose button.
- Numerals are tabular wherever a number can change or line up.
- A musical key is a colored pill everywhere. Its hue comes from the pitch
  class on the circle of fifths, at constant lightness and chroma. A key the
  client cannot read keeps the pill with the neutral fill. Two sizes only:
  full, a 44px target, and compact, inside row metadata.
- The text size setting has three steps on the root font size. Inputs never
  drop below 16px, so iOS does not zoom on focus. iOS Dynamic Type is off.
- A measurement that lines up with an Ionic edge is in pixels, because
  Ionic's paddings are pixels.
- Appearance and text size are per device. Sign-out leaves them alone.
- Every tap target is at least 44px. Ionic injects a smaller unlayered
  minimum, so toolbar controls, row actions, and capsules each carry a rule
  that outranks it. Measure the control rather than trusting its class.
- Icons come from `lucide-react` as named imports, sized with a `size-*`
  class, hidden from assistive technology inside a named control. A glyph
  beside a word goes in the button's `start` slot. A text character is never
  an icon.

## Identity

- The mark is a geometric CT monogram. The C's top arm runs into the T's
  crossbar, and the stroke turns coral where the T begins.
- Two colorways: white C on a dark surface, slate C on a light one. The T is
  always coral, through the `mark` token, which does not move with `danger`.
- The lockup is the bare mark left of the name, as tall as the capitals.
- Icons are generated from `brand/` by `just web::icons`, never hand-edited.
- The status bar takes the page background.

## Song rows

Everywhere the app lists songs it uses one row.

- Line one is the title, truncated when long.
- Line two holds the key, the status dot with its label, the tunings for
  played instruments, and "Archived", each omitted when unset. A screen
  reader hears a comma between parts.
- An archived row is dimmed as a whole.
- A tap opens the song. While selecting, a tap toggles the row.
- In a list, the row gains a position number, a Reorder button, and a drag
  grip.

## Keys, modes, and tunings

- A row shows the key alone, never the mode. Modes are lowercase everywhere.
- A facet shows only when the song holds the value. A screen that shows what
  a song is puts every facet in one wrapping row, key first.
- A tuning field, filter, or badge appears only for an instrument the
  musician plays, except a field that already holds a value, which always
  shows so data never becomes unreachable.
- Tuning, mode, genre, feel, time signature, and part structure are open
  vocabularies picked from suggestions, each with an `Other…` choice that
  reveals a text field.
- Key is closed: a grid of pills, never typed. Both spellings of a black key
  are offered and share one hue. A stored key the grid lacks joins it as its
  own pill.
- A tuning suggestion reads name then strings, lowercase for a drone:
  "Cross A (AEAE)", "Sawmill (gDGCD)".
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
- Never color alone. A dot always has its label. Known is a filled success
  dot, learning a filled warning dot, want to learn a hollow ring.
- Status is a rail of capsules wherever it is set or filtered. A filter rail
  leads with All.
- A required field never clears: pressing the chosen capsule leaves it
  chosen. An optional field does the opposite.
- An unrecognized status value shows as want to learn.

## Search and create

Every box that searches songs also offers to create one.

- A non-empty query shows an add row under the results: `Add "query"`, or
  `Add another "query"` when the title exists. Titles are not unique, so an
  exact match never hides the offer.
- An exact match hidden by a filter or the archived setting is named, with
  an Open link, before the add row.
- Enter opens the only visible result, or the hidden exact match, or creates
  when nothing matches. With two or more results Enter only closes the
  keyboard. Enter never creates a duplicate title.
- The add row carries the typed title into the new song form, and from a
  picker also the list or the recording.
- A picker never hides a song. One already in the list stays in the results,
  marked "In this list" and inert. Pickers search archived songs too.
- The search field is named for what it searches and its placeholder repeats
  that. "Clear search" appears while the field has focus.
- Query text lasts the browser session and filters persist. Opening the new
  song form and signing out clear the query.

## Filters

Only the catalog has filters.

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
- A set filter shows on the screen as a removable capsule.
- A rail of chips stays on one line at every width and text size. It scrolls,
  fades at its end while there is more, and scrolls the chosen chip into
  view.
- Under the list a count reads "84 songs", or "11 of 84 songs" while
  narrowed, and is absent when the catalog is empty.
- Matching ignores case and accents.
- List screens keep their own Show archived setting.

## Gestures

Every gesture has a visible equivalent. Swipe actions are also hover buttons
and menu items, long press has the Select item, and drag has the move menu.

- On touch a row swipes left to reveal one to three full-height actions in
  their tone: neutral, warning, or error. Every action is the same width. A
  label too long for that width shows shorter text, and the full label still
  names the button.
- On a mouse the same actions are icon buttons on the row's trailing edge,
  shown on hover and keyboard focus, always in the tab order.
- A full swipe only opens the row. No swipe is destructive.
- A destructive glyph says what it destroys: trash for gone for good, a list
  with a cross for removed from a list.
- Editing a row opens the form as a sheet over the current screen.
- A press held 500 ms on a song row enters selection, on touch only. More
  than 10px of movement cancels it. The phone vibrates where it can.
- A reorder grip swallows every click and is unnamed, so a draggable row also
  carries a move button that opens a menu. After a move a live region says
  where the song landed. Both appear only with more than one visible song.
  Reordering stops while selecting, and a selecting row has no swipe actions.
- On `ios` a pushed page swipes back.
- On a mouse, `/` focuses search, arrow keys walk the rows, Enter opens,
  Escape leaves selection, and Cmd-A or Ctrl-A selects all. A shortcut
  stands down while a text field or an overlay holds the keyboard.

## Selection and bulk actions

Selection is component state, never a URL.

- Enter from the More actions menu or a long press.
- Each row's own control becomes its checkbox. A check mark on the leading
  edge is inert decoration.
- The chrome diverges on purpose. On `ios` the actions sit in a footer
  toolbar and the tab bar hides. On `md` the toolbar carries them and the tab
  bar stays.
- The count is a digit beside a word that can elide. A screen wearing the
  selection toolbar shows no back button.
- The selection holds only visible songs. A song hidden by search, a filter,
  or the archived setting leaves it. Select all means the current view.
- Every action applies at once, ends the mode, and raises a toast with Undo.
  There is no confirmation, because a confirmation gets clicked through and
  leaves no way back. A failed write keeps the mode and the selection.
  Cancelling a sheet keeps the selection.
- Delete is the exception. It takes recordings that no undo can bring back,
  so it confirms and raises no toast.
- Exits: the toolbar's exit control, Escape, leaving the screen, completing
  an action, or the Android hardware back button on a native build, which is
  registered below Ionic's overlays and above its router.
- Shift-click extends the selection. Cmd-A or Ctrl-A selects all and never
  clears.
- Focus moves to a row's checkbox on entering and returns to the opening
  control, or the screen landmark, on leaving.
- Bulk edit is the song form over many songs. Each row shows the shared
  value, `Not set`, or `Mixed`. Only a touched row is written, and Save is
  dead until one is. A choice row clears through Clear, a yes or no row keeps
  through Keep, and `Other…` keeps the current value.
- A field whose value is unique to one song is never bulk editable.

## Forms

Every form is a sheet on touch and a centered dialog on a mouse. There is
no form route and no save bar.

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
- A set answered once, such as instruments, sits behind a row that names the
  choice and opens a sheet, never as a list of rows on the screen.
- Fields are ranked by how often they are touched. Rare ones go last, in one
  list of rows.
- One spacing scale: a 16px gutter for cards and bare controls; header,
  footer, help, and error text at the 32px row inset; 24px above a header;
  8px below a header and above a footer; 16px between two cards with no
  header; 44px rows.
- A labeled field row has the label leading and the value trailing. The
  value elides first.
- Every control has a visible label. An `aria-label` alone is not a label.
- A row that opens its own form carries its name and a chevron, and no value
  summary.
- Every field shows where to type. An empty row reads "Not set". A standalone
  field carries a placeholder naming what goes in it, never an example value.
- A single-field sheet has no header. Its title names the field.
- A form rejects as little as possible. Every limit that can be a cap
  enforced while typing is one. What is left shows under its field, takes
  focus, marks the field invalid, and clears at the first keystroke.
- Which fields a form shows is decided when it opens. Nothing disappears
  mid-edit.
- The primary action is disabled while a write is pending or the form cannot
  yet succeed.
- A sheet that can lose typed work refuses a backdrop tap and a drag down.
  Cancel is the way out. Any sheet refuses while its own write is pending.
- A setting saves on toggle. Settings has no Save button.

## Sheets, menus, confirmations, and toasts

Each follows the pointer and is implemented once.

- A sheet is a bottom sheet with a grabber on touch, opening part way and
  dragging to full, or at full height at once for a long body or a form of
  many fields. On a mouse it is a centered dialog 480px wide. Its title names
  the dialog.
- A menu is an action sheet on touch and a popover on a mouse. A destructive
  item is red and follows a separator. A cautionary one takes the warning
  color.
- A destructive action confirms through the app's own overlay, an action
  sheet on touch and an alert on a mouse. Only the named action resolves
  true. The button is the bare verb. The message names the consequence and
  says when data cannot come back:
  `Delete "Soldier's Joy"? This removes its links and list entries.`
- A toast is for an action that offers Undo, and for the rare error that
  arrives after the musician has left the screen. One at a time, about 8
  seconds, anchored above the frame's bottom chrome.
- A question the app must have answered has no Cancel, waits for a clean
  sync before it asks, and never opens over another modal.

## Recording and link rows

Recordings and links share one row shape.

- A fixed glyph slot on the leading edge shows the item's state.
- The row is the control and always answers a tap: play, download, embed in
  the dock, or open the provider's site.
- The title is the most specific name available: typed, then resolved, then
  composed from the date. A part a heading above already carries is dropped.
- The second line joins metadata with middle dots, or on a link is the link
  out. A red third line carries a transfer error and a Retry, which retries
  at once.
- A state that needs nothing shows the creation date. Words are reserved for
  what needs attention.
- Sizes truncate rather than round. Durations read `m:ss`. The provider is
  named once per row.
- Rows that answer one question share one list under one header, the
  musician's own recordings first.
- A header carries only the name of what its rows belong to. When it leads
  somewhere, the whole line opens it.
- The dock opens only from a play tap. Opening a song never loads a player.
  At most one item is loaded, and it stays loaded while the musician browses.
- A live recording refuses a swipe dismissal. Discarding captured audio
  confirms first.

## Empty, loading, sync, and offline states

- An empty list shows an icon, a title that says what is absent, an optional
  hint that says what to do, and an optional action.
- Loading is silence, not a spinner. A screen renders its one page in every
  state and shows nothing in the body until its data is read. Never swap the
  page element after the outlet has mounted it. The only spinners are the
  sign-in splash and a transfer under way.
- The sync badge shows only `Offline`, `Sign in again`, and `Sync failed`.
  Settings holds the full state and the one manual sync control. Pull to
  refresh syncs on touch.
- Offline, a control that needs the network refuses rather than disables, so
  its name and its tap survive and the reason lands on the row. Sign out is
  the one control disabled, because the local catalog must not be deleted
  while its session is open.
- A remembered musician is admitted offline once the browser reports no
  connection, or after 5 seconds, and the account row says so.

## Motion

- Page transitions and swipe back are Ionic's per-mode defaults, off on the
  wide frame. Overlays use Ionic's own presentation.
- The app adds no motion of its own beyond the record control and the live
  waveform. Under reduced motion neither animates.
