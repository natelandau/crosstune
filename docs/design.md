# Crosstune design patterns

This page holds the rules a screen follows. When a rule and a screen disagree,
the rule wins and the screen is the bug.

The client is built on Ionic React, so each platform supplies its own structure,
and a rule says where the two platforms differ on purpose. Each pattern is
implemented once. The table at the end, "Where each pattern lives", names the
component for each one, so a new screen composes it instead of rebuilding it.

## What belongs on this page

A rule belongs here when it constrains a screen that does not exist yet. It
names the constraint and gives the reason, because a rule with no reason gets
traded away by the first person who finds it inconvenient.

Three things do not belong here, however true they are.

- An inventory of what a screen holds today. The screen already says that, and
  it says it accurately. A copy here only goes stale and then lies.
- A decision that binds one feature. Its spec holds it.
- A mechanism, unless it is a trap that catches whoever builds the next screen.
  Ionic's unlayered styles are such a trap. The name of a constant is not.

The authority clause above is only safe while this page holds rules alone. A
page that also lists what exists cannot claim that the screen is the bug.

## Words in the interface

- The glossary in `product.md` sets the two naming rules: song, never tune, and
  violin, never fiddle.
- Every label, button, heading, and tab is sentence case. Only proper nouns keep
  their capitals. The one exception is `ios` edit mode, where the selection
  toolbar copies Apple's own capitals.
- A button is a bare imperative verb: Edit, Save, Delete. An object follows only
  when the target is ambiguous: Add song, Add to list.
- A count goes into the label of anything that acts on several songs: "Archive 3
  songs". One song reads "1 song".
- A song or list title inside a message sits in straight double quotes:
  `Delete "Soldier's Joy"?`
- Help text is one or two full sentences with a period. A label has no period.
- A placeholder that gives examples is lowercase and ends in an ellipsis. A
  search placeholder is an imperative with a capital: `Search songs`.
- A control that opens more interface ends in an ellipsis: `New list…`.
- A control whose face is a glyph rather than a word is named in words, because
  a glyph reads as nothing aloud. The key grid's empty choice shows `?`, the
  shorthand a musician already writes on a tune list, and is named "Unknown
  key".
- The empty choice in a picker is named for what choosing it does. It reads "Not
  set" where it leaves a field empty, "Any" or "All" where it widens a filter,
  "Clear" where it erases a value across many songs, and "Keep" where it changes
  nothing. A field whose songs disagree shows "Mixed".
- A set filter shows as a filled capsule named for its value, and its remove
  control is named "Remove filter" and the value, so a screen reader hears
  "Remove filter Cross A (AEAE)".
- A relative date carries its verb: "Edited today", "Edited Mar 4", with the
  year only when it is not the current year.
- A control that acts on one thing is named for the action and the thing, so a
  screen reader hears "Edit Soldier's Joy". Where the row itself is the control,
  its name is the verb composed with the lines the row shows, so it stays true
  as those lines change.

## Layout and chrome

Three axes decide the chrome. No screen asks which device it is on.

| Axis    | Values           | Decides                                                   | Source                               |
| ------- | ---------------- | --------------------------------------------------------- | ------------------------------------ |
| Mode    | `ios`, `md`      | How components look and animate                           | Ionic's own detection, never forced  |
| Frame   | `phone`, `wide`  | Tab bar or sidebar, full width or a measured column       | Viewport width at 768px              |
| Pointer | `touch`, `mouse` | Swipe or hover, sheet or popover, whether shortcuts exist | `(hover: hover) and (pointer: fine)` |

- One router and one outlet always render. Routes are tab-scoped, so a song
  opened from a list stays in that tab and Back returns to the list. Navigation
  goes only through Ionic's router, never through browser history.
- The phone frame carries a tab bar and the wide frame a sidebar. The bar is
  hidden rather than unmounted on the wide frame, and the sidebar switches tabs
  through it, so each stack keeps its pushed pages on both frames.
- Content on the wide frame sits in a column 640px wide, set in pixels so the
  text size setting scales the type and not the column.
- There is no app bar lockup and no link home.
- `Screen` is the one page component. It renders the page, the toolbar, the
  scrolling content, and the screen's landmark inside the column. A top-level
  screen opens with a large title on `ios` and carries the search bar under it.
  A pushed screen carries a back button instead.
- One action reached from several places opens one component. The record screen
  is reached three ways and is the same modal each time, laid over whatever tab
  is open, so finishing returns the musician where they were.
- Chrome that occupies the bottom of the frame reserves its own room, so no page
  ends up behind it.
- An error shows beside the control that produced it. A group's own error
  replaces its help text in red, a row action reports under the list it acted
  on, and a screen's action reports above the rows. A screen with several groups
  gives each its own error line, so a refused write lands under the control that
  made it.

## Color, type, and icons

- The palette carries meaning and each platform supplies its own structure. Page
  background, fills, separators, and secondary text come from Ionic's per-mode
  defaults, so an iPhone gets iOS greys and Android gets Material greys.
- Every screen and every sheet takes the page background, whether it is one list
  or a column of cards, so no screen sits a shade apart from the one beside it in
  the tab bar. A card is told apart from the page under it by a hairline ring in
  light mode and by a lighter fill in dark, drawn in the color and weight of the
  separators between its own rows. The ring is a shadow rather than a border,
  because a border would shrink the card's content box and drift its rows off the
  inset that every header and footer lines up against.
- Four Ionic roles carry meaning and no screen invents a fifth. `primary` tints
  anything chosen, `success` and `warning` mark the status dots, `warning` also
  marks a cautionary action, and `danger` marks every destructive one.
- A control that paints itself in a value's own color is the one exception to
  `primary` tinting the selection, because filling with `primary` would repaint
  the value from its own color at the moment it is chosen. A value with no color
  of its own keeps the `primary` fill.
- Dark mode is Ionic's system palette, switched by a class the appearance
  setting writes. The class and the `data-theme` attribute are both stamped
  before the first paint, so there is no flash.
- On `md` in dark mode a plain list's rows take the page color, so its
  separators alone carry its structure, which is where Material sits a list
  item. Inset groups keep their own lighter row, so a card still reads as a card
  on the page behind it.
- `src/app/theme/variables.css` is imported outside every layer, because Ionic
  injects its component styles unlayered at runtime and a layered rule loses to
  them whatever its specificity. Anything that must beat Ionic goes there.
- Type comes in named roles: title, headline, body, subheadline, footnote,
  caption, and timer, each defined once per mode. A screen uses a role and never
  sets a size, weight, or tracking of its own. The roles live in
  `layer(components)`, below the utilities, so a utility still wins.
- A group header takes one of two roles, chosen by what the header does. One
  that labels a section of a form takes the footnote role in the secondary
  color, quieter than the rows it introduces. One that carries the name of the
  thing those rows belong to, a song over its recordings, takes the title role,
  a step under the screen's own title, so the screen reads from its title down
  to its rows rather than flat across them.
- A naming header keeps the tap height whether or not it opens anything, so
  every group on a screen sets its rows off by the same distance. Where it leads
  into what it names, a chevron says so and the whole line is the target. The
  heading keeps the name by itself and the control is named for the verb and the
  name, so heading navigation and the control each read the way they should.
- Ionic's own label styles sit outside every layer, so each role is applied
  again unlayered to reach inside an `ion-label`. That rule also beats a color
  utility on the role element. Inside an `ion-label`, put a color utility on a
  child span rather than on the role element.
- Ionic copies `aria-*` onto its inner native control once, while the component
  loads, and takes the attribute off the host. An attribute set on the host
  afterwards reaches nothing, so state that changes later is written to the
  control itself.
- Numerals are tabular wherever a number can change or line up.
- A musical key is a colored pill wherever it appears. Its hue comes from the
  key's pitch class, placed by position on the circle of fifths, so keys a fifth
  apart are neighbors and two spellings of one pitch match. Lightness and chroma
  are constant, so no key reads louder than another. A key the client cannot
  read as a pitch class keeps the pill and takes the neutral fill, so it never
  borrows a hue. The pill comes in two sizes and no others: the full one fills a
  44px tap target, and the compact one sits in a line of row metadata without
  setting that row's height.
- The text size setting has three steps and moves the root font size, which
  scales every role at once. Inputs never drop below 16px, so iOS does not zoom
  on focus. iOS opts out of Dynamic Type, so the in-app setting owns the root
  size.
- A measurement that lines up with an Ionic edge is in pixels, not rem, because
  Ionic's own paddings are pixels and a rem would drift away from them at every
  text size but one.
- Appearance and text size are per device and need no account. Sign-out leaves
  them alone.
- Every tap target is at least 44px. Ionic injects its own smaller minimum
  unlayered, so a toolbar control, a row action, and a capsule each carry a rule
  that outranks it. Measure a control rather than trusting the class on it.
- Every icon comes from `lucide-react` as a named import, sized with a `size-*`
  class, and hidden from assistive technology inside a control that carries its
  own name.
- A glyph on a button with a word beside it goes in the button's `start` slot,
  which the theme spaces. Ionic spaces that slot only for an icon element of its
  own, so a glyph set anywhere else sits against its word. A text character is never an icon.

## Identity

- The mark is a geometric CT monogram. The C's top arm runs straight into the
  T's crossbar, and the stroke changes to coral where the T begins.
- Two colorways and no others. On a dark surface the C is white, and on a light
  surface the C is slate. The T is always coral. The colorway follows the
  surface, never the brand. In the client the T takes the `mark` token, which
  does not move with `danger`.
- A lockup is the bare mark to the left of the name, the mark as tall as the
  capitals.
- The app icon, the favicon, and the PWA icons are generated from the brand
  source by `just web::icons` and never edited by hand.
- The status bar takes the page background, which the client reads back from the
  stylesheet whenever the appearance changes.

## Song rows

Everywhere the app lists songs, it uses the same row. A screen never lays out a
song's title and key its own way.

- Line one is the title alone, truncated when long.
- Line two holds the key, the status dot with its label, the tunings, and the
  word "Archived", each omitted when unset. A screen reader hears a comma
  between the parts.
- Tunings appear only for instruments the musician plays.
- An archived row is dimmed as a whole.
- Tapping the row opens the song. While selecting, a tap toggles the row
  instead.
- In a list, the row gains a position number, a Reorder button, and a drag grip.

## Keys, modes, and tunings

- A row shows the key alone, never the mode.
- Modes are lowercase everywhere, in pickers, filters, and badges.
- A facet appears as a capsule only when the song holds the value.
- The song page carries every facet the song holds in one wrapping row under the
  title: the key first, then the mode, the status, and the rest. What the song is
  reads as one thing, so no facet sits on a line of its own and none is ranked
  above another by where it landed. The row wraps rather than scrolling, because
  a facet past the edge of a rail is a facet the musician never learns about.
- A tuning field, filter, or badge appears only for an instrument the musician
  plays. The one exception is a field that already holds a value, which is
  always shown so data never becomes unreachable. A song row is stricter and
  shows a tuning only for a played instrument.
- Tuning, mode, genre, feel, time signature, and part structure are open
  vocabularies picked from suggestions. None closes the door: each offers an
  `Other…` choice that reveals a text field, and a typed value then shows as its
  own option.
- Key is closed, because there are twelve pitch classes and no thirteenth. It is
  chosen from a grid of pills and never typed. The common keys sit on the grid,
  and `More keys…` opens the rest as a menu. Both spellings of a black key are
  offered, F# and Gb alike, because musicians name them as different keys. The
  two share one hue, because they are one pitch.
- A key the grid does not hold, whether picked from that menu or stored by an
  older client, joins the grid as its own pill, so no stored key is ever
  unreachable.
- A tuning suggestion reads as a name and the strings in parentheses, with a
  lowercase letter for a drone string: "Cross A (AEAE)", "Sawmill (gDGCD)".
- A field's label reads the same wherever it appears, so "Violin tuning" is that
  field's name on every screen. A row under a header that already carries half
  the name may shorten what it shows, but the full name stays what a screen
  reader hears.

## Status

- A song is known, learning, or want to learn, labeled "Known", "Learning", and
  "Unknown". One word each fits the control on a phone without wrapping.
- Status is never shown as color alone. Where a dot appears, its label appears
  beside it. Known is a filled dot in the success color, learning a filled dot
  in the warning color, and want to learn a hollow ring.
- A chosen capsule fills with `primary`, and success is that same slate, so the
  chosen dot takes the contrast color rather than disappearing into the fill
  behind it.
- One control means one thing everywhere, so status is a row of capsules wherever
  a musician sets or filters it. A filter's row leads with All, because a filter
  can narrow nothing.
- The song page shows status as a facet and does not set it. A song is read far
  more often than its status is changed, and a control on the page would rank
  status above every other facet beside it, so the change happens where every
  other facet is changed: the edit sheet.
- The status control never clears: a song always has a status, so pressing the
  chosen capsule leaves it chosen. A field that can be empty does the opposite,
  and pressing its chosen value clears it.
- A status value the app does not recognize shows as want to learn.

## Search and create

Every box that searches songs also offers to create one, and the rules are the
same in every one of them.

- A non-empty query always shows an add row under the results, labeled
  `Add "query"`. Titles are not unique, because different songs share a name, so
  an exact match never hides the offer. When a song already carries the title the
  row reads `Add another "query"`.
- When the exact match exists but is hidden by a filter or the archived setting,
  a note names it with an Open link before the add row.
- Enter opens the only visible result, or the hidden exact match when nothing is
  visible, or creates when nothing matches anywhere. With two or more results
  Enter only closes the keyboard. Enter never creates a song whose title already
  exists. That takes a deliberate tap.
- The add row carries the typed title into the new song form, so nothing is
  retyped. From a picker it also carries the list or the recording, so the saved
  song is added to the list or holds the recording.
- A picker never hides a song it cannot offer. A song already in the list stays
  in the results, marked "In this list", so an exact match is never mistaken for
  a missing song. A tap on it does nothing.
- A picker searches archived songs too, and an archived row says so in its name.
- The search field is named for what it searches, and its placeholder repeats
  that name. A clear button named "Clear search" appears while the field has
  focus.
- Free text lasts for the browser session and filters persist. Opening the new
  song form and signing out both clear the query. Clearing a filter never
  touches it.

## Filters

Only the catalog has filters.

- The control that opens the filter sheet sits with the search field it narrows,
  not with the toolbar's actions, and carries a count of the filters set inside.
  Its name reads "Filters, 2 set", because filters persist between visits and a
  stale one must announce itself.
- The facets a musician reaches for most sit on the screen, and the rest live one
  tap away in the sheet.
- A facet appears only when the catalog holds values for it, and a tuning only
  when the musician also plays that instrument. A hidden facet is cleared by
  every write, so it can never narrow the catalog in silence.
- A value the catalog no longer holds still gets an option of its own, so a stale
  filter never reads as Any.
- Every choice in the sheet applies at once. Reset clears the sheet's filters and
  nothing else. Done closes it.
- A set filter shows on the screen as a removable capsule, so nothing narrows the
  list without saying so.
- A rail of chips that can overflow fades at its end while there is more to
  scroll to, and the fade goes once there is not.
- Under the list a count reads "84 songs", or "11 of 84 songs" while anything
  narrows it. The count is absent while the catalog holds no songs at all.
- Matching ignores case and accents.
- Catalog filters persist and come back on the next launch. List screens keep
  their own Show archived setting, untouched by the catalog.

## Gestures

Every gesture has a visible equivalent. Swipe actions also exist as hover buttons
and as menu items, long press has the Select item, and drag has the move menu.

- On touch a row swipes left to reveal one to three actions as full-height
  buttons filled with their tone: neutral, warning, or error.
- Every revealed action is the same width, whatever its label reads, so one row's
  actions are all the same target and the same action lands in the same place on
  every list. A label too long to read on one line at that width shows a shorter
  text instead. The full label still names the button to a screen reader.
- On a mouse the same actions are icon buttons laid over the row's trailing edge,
  shown on hover and on keyboard focus, because nothing hints that a row swipes.
  They keep their place in the tab order at all times.
- A full swipe only opens the row. It never runs an action, so no swipe is ever
  destructive.
- A destructive action's glyph says what it destroys: the trash for something
  that is gone for good, and a list with a cross for a song only taken out of a
  list.
- Editing a row opens the form as a sheet over the screen the musician is on, and
  both ways out return to that screen.
- A press held for half a second on a song row enters selection mode with that
  row selected. It is wired on touch alone, because a mouse has the Select item
  instead. A movement of more than 10px cancels the hold, so a swipe or a scroll
  never counts as one, and the phone vibrates briefly where it can.
- A reorder control swallows every click inside it, so a row that drags carries a
  separate button for the same move. That button opens a menu, and each item
  appears only where it applies. The grip itself is unnamed, because dragging is
  not a control a screen reader can offer, and it comes last so it keeps the
  row's trailing edge, which is where a drag looks for it. After a move a live
  region says where the song landed.
- Both controls appear only while the list holds more than one visible song.
- Reordering stops while selecting, because a drag and a multi-select cannot
  share one touch gesture. A selecting row also carries no swipe actions at all.
- On `ios` a pushed page swipes back, Ionic's own gesture.
- On a mouse, `/` focuses the search field, the arrow keys walk the rows, Enter
  opens the focused row, Escape leaves selection mode, and Cmd-A or Ctrl-A
  selects all. A shortcut stands down while a text field or an overlay holds the
  keyboard.

## Selection and bulk actions

Selection is component state, not a URL, so a link can never enter it.

- The musician enters from the More actions menu or with a long press on a row.
- Each row's own control becomes its checkbox, and a check mark appears on the
  leading edge as inert decoration.
- The chrome is the one place the two platforms diverge on purpose, because edit
  mode is a strong convention on each and the two disagree. On `ios` the actions
  sit in a footer toolbar and the tab bar hides. On `md` the toolbar itself
  carries them and the tab bar stays.
- The count is a digit beside a word that can elide, so a bar with no room drops
  the word and never a digit. A screen wearing the selection toolbar shows no
  back button, because its exit control takes that place.
- The selection holds only visible songs. A song hidden by search, a filter, or
  the archived setting leaves the selection, so an action never touches a song
  the musician cannot see. Select all means every song in the current view.
- Every action applies at once, ends the mode, and raises a toast with Undo.
  There is no confirmation, because a confirmation gets clicked through and
  leaves no way back. A failed write keeps both the mode and the selection.
  Cancelling a sheet keeps the selection.
- Delete is the one exception, because it takes recordings with it and no undo
  can bring back a recording already gone from the server. It confirms through
  the app's own overlay and raises no toast.
- The musician leaves with the toolbar's own exit control, Escape on a mouse,
  leaving the screen, or by completing any action, plus the Android hardware back
  button on a native build. That button is registered below Ionic's overlays and
  above its router, so Back closes a sheet, then leaves selection, then leaves
  the screen.
- Shift-click extends the selection from the last toggled row. Cmd-A or Ctrl-A
  selects all and never clears it, because the one key that means everything must
  not also mean nothing.
- Focus moves to a row's checkbox on entering, the held row or the first one. On
  leaving it returns to the control the mode opened from, or to the screen's
  landmark when that control has gone.
- Bulk edit is the song form over many songs. Each row reads the value every
  selected song shares, `Not set` when they are all empty, or `Mixed` when they
  disagree. Only a row the musician touches is written, and Save stays dead until
  one is. A choice row clears through its own Clear option, and a yes or no row
  keeps every song as it is through Keep. `Other…` here keeps the current value
  rather than clearing it, because clearing has its own option.
- A field whose value is unique to one song is never bulk editable.

## Forms

Every form is a sheet, or a centered dialog on a mouse frame. There is no form
route and no save bar.

- The actions live in the sheet's toolbar: `Cancel` leads, and a bold primary
  action trails, named for what it does. A sheet whose rows are the actions
  carries Cancel alone.
- A form is a column of sections, not a column of fields. A section is an inset
  group holding one or more related fields. Its header names the group, its
  footer carries help for the group, and a validation message replaces that
  footer in red. Help text is never a row inside a card, because a line between
  two hairlines reads as another row.
- A control that is not a list, a grid of pills or a rail of chips, sits on the
  page at the same gutter as the cards.
- A closed choice is a field row whose value opens the client's one picker. A
  segmented control is never that row: it announces itself to assistive
  technology as a tab list, and it spends the row's width on the values a
  musician is not choosing rather than on the one they chose. A grid of pills
  stands in only where the values carry their own color, or where the field is
  what the musician came to the screen for, which is status and key on the song
  form and nothing else.
- A set a musician answers once sits behind a row that names what is chosen,
  rather than as a list of rows on the screen: the row shows the set and opens
  the list in a sheet, where each tap still writes at once. A question answered
  at install must not push every setting under it off the screen.
- A form ranks its fields by how often a musician touches them. The rare ones go
  last, in one list of rows.
- One spacing scale serves every form and every grouped screen: a 16px gutter for
  cards and bare controls, header, footer, help, and error text at the 32px row
  inset so it lines up with the row labels, 24px above a header, 8px below a
  header and above a footer, 16px between two cards with no header between them,
  and the 44px row height every tap target keeps.
- Every labeled field in a card takes one shape: the label leads and the value
  trails. A long value gives up its width first and elides, so the label is never
  the thing that gets clipped.
- Every field carries a name a musician can read. An accessible name is not
  one, so a control whose only name is its `aria-label`, under a header that
  names something else, is a field nobody can name.
- Every field shows where to type. A row with no value reads "Not set" rather
  than reading as empty space, and a field standing on its own rather than in a
  row carries a placeholder naming what goes in it. A placeholder is never an
  example value: a musician cannot tell a hint from something the form already
  holds, and an example drawn from one tradition means nothing to someone who
  plays another.
- A single-field sheet carries no header at all: its title already names the
  field, and a header under it would only repeat it.
- A form rejects as little as possible. Every limit that can be a cap the field
  enforces while typing is one, so there is nothing to reject. What is left is
  shown under the field it belongs to, takes focus, marks the field invalid, and
  clears at the first keystroke.
- A decision that changes which fields a form shows is made when the form opens,
  so a field never disappears mid-edit.
- The primary action is disabled while the write is pending, and where the form
  cannot succeed yet, it stays disabled until it can.
- A sheet that can lose typed work refuses a backdrop tap and a drag down, and
  Cancel is the way out. Every other sheet dismisses that way and closes through
  its dismissal rather than around it. Any sheet refuses while its own write is
  pending.
- Toggling a setting saves it at once. There is no Save button on the settings
  screen.

## Sheets, menus, confirmations, and toasts

Each of these follows the pointer, and each is implemented once.

- A sheet is a bottom sheet with a grabber on touch, opening part way and
  dragging to full, and a centered dialog 480px wide on a mouse. It has a title,
  which also names the dialog, because Ionic does not read the toolbar title. A
  title that counts what is selected stays in step with the count.
- A menu is an action sheet on touch and a popover anchored to its button on a
  mouse. A destructive item is red and follows a separator, and a cautionary one
  takes the warning color. The action sheet adds its own Cancel.
- A destructive action confirms through the app's own overlay, which follows the
  pointer: an action sheet from the bottom on touch, an alert on a mouse. It
  resolves true only for the named action, so a backdrop tap, Escape, and Cancel
  all mean no. The confirming button is the bare verb.
- The message names the consequence and warns when data cannot be recovered:
  `Delete "Soldier's Joy"? This removes its links and list entries.` It grows to
  name anything else the action takes with it, and says plainly when something
  cannot be brought back.
- A toast is for an action that offers Undo, and for the rare error that arrives
  after the musician has left the screen. Every other error shows inline beside
  the control that failed.
- One toast at a time, from one provider mounted in the shell. A new one replaces
  the old. It stays about eight seconds. It anchors above the frame's own bottom
  chrome, so a message raised by the action that ended selection mode waits for
  the bar to come back rather than landing on top of it.
- A question the app must have an answer to has no Cancel at all, so answering it
  is the only way out. It waits for a clean sync before it asks, so it never asks
  what the server already knows, and it never opens over another modal.

## Recording and link rows

Recordings and links share one row shape.

- The row has a fixed glyph slot on the leading edge, at the row's tap height,
  holding whatever the item's state calls for.
- The row itself is the control, and every row answers a tap. A recording plays
  when its audio is on the device and downloads when it is not. A link plays in
  the dock when the provider can be embedded, and opens the provider's own site
  when it cannot, so no row is ever dead to a tap.
- A row's title is the most specific name it has, falling back through what the
  musician typed, what the provider resolved, and what the app can compose from
  the date. Where a heading above the row already carries part of that name, the
  row drops it rather than repeating it.
- The second line joins the row's metadata with middle dots, and on a link it is
  the link out to the provider instead. Either way it sits the same distance
  under the title, so two rows in one list read as one shape. A third line, in
  red, carries a transfer error and a Retry button at the trailing edge.
- A state that needs nothing from the musician shows when the item was made
  rather than naming itself, so the words that remain all mean something needs
  attention.
- Retry tries again at once rather than waiting out the backoff.
- Sizes truncate rather than round, so a size never overstates. Durations read
  `m:ss`.
- The provider is named once on a row and nowhere else on it.
- A song's recordings and its links are one list, headed Recordings, with the
  recordings first because they are the musician's own. Both answer the one
  question the section exists for, how to hear this song, and a second header
  between them would break that answer in two.
- On the recordings screen, recordings group under their song, headed by that
  song's name and nothing else. The key, the status, and the tunings stay on the catalog's own song row,
  because a header that repeats them competes with the rows it introduces. The
  header opens the song.
- The dock opens only from a play tap. Opening a song never loads a player. At
  most one item is loaded, and it stays loaded while the musician browses.
- A live recording refuses a swipe dismissal, so its own controls are the ways
  out, and the one that discards captured audio confirms first.

## Empty, loading, sync, and offline states

- An empty list shows an icon, a title, an optional hint, and an optional action.
  The title says what is absent, and the hint says what to do about it.
- Loading is silence, not a spinner. A screen renders its one page in every state
  and shows nothing in the body until its data is read. Swapping the page element
  after the outlet has mounted it leaves the outlet holding a detached page. The
  only spinners are the sign-in splash and a transfer already under way.
- The sync badge shows only the states that need attention, `Offline`, `Sign in
  again`, and `Sync failed`, and says nothing while a sync is clean or running.
  Settings is where the full state is read, and it holds the one control that
  starts a sync by hand.
- Pull to refresh runs a sync on touch, and the Settings control is its visible
  equivalent.
- Offline, a control that needs the network refuses rather than disables, so its
  name and its tap survive and the reason arrives on the row. Sign out is the one
  control disabled instead, because the local catalog must not be deleted while
  the session it belongs to is open.
- A remembered musician is admitted offline once the browser reports no
  connection, or after a five second grace period, and the account row says so.

## Motion

- Page transitions and swipe-back are Ionic's per-mode defaults, unmodified. On
  the wide frame they are off, and the pane swaps in place.
- Sheets, modals, menus, alerts, and toasts use Ionic's own presentation.
- The app's own motion is two things: the record dome scales down while pressed,
  and the waveform on the record screen scrolls as it draws.
- Under reduced motion the dome does not scale and the waveform updates fixed
  bars in place.

## Where each pattern lives

Paths are relative to `web/`. A new screen composes the component in the right
column instead of rebuilding the pattern.

| Pattern                                   | Implemented in                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Mode, frame, and pointer                  | `src/platform/mode.ts`, `src/platform/frame.ts`, `src/platform/pointer.ts`                   |
| Router, outlet, and the two frames        | `src/app/Shell.tsx`, `src/app/routes.tsx`, `src/app/tabs.ts`                                 |
| Tab bar and the record dome               | `src/app/PhoneTabBar.tsx`, with the dome's styles in `src/app/theme/variables.css`           |
| Sidebar                                   | `src/app/Sidebar.tsx`                                                                        |
| Page, toolbar, landmark, content column   | `src/ui/Screen.tsx`                                                                          |
| Inset group, its header, help, and error  | `src/ui/Group.tsx`, `src/ui/SectionHeader.tsx`                                               |
| One shape for a labeled field row         | `src/ui/FieldRow.tsx`                                                                        |
| One shape for a closed choice             | `src/ui/ChoiceRow.tsx`                                                                       |
| Palette, type roles, layer order          | `src/app/theme/variables.css`, `src/app/theme/typography.css`, `src/app.css`                 |
| Appearance and text size setting          | `src/features/settings/appearance.ts`, the inline script in `index.html`                     |
| The mark and the lockup                   | `src/ui/Mark.tsx`, with the sources in `brand/` at the root                                  |
| List row, swipe and hover actions         | `src/ui/Row.tsx`                                                                             |
| Long press                                | `src/ui/longPress.ts`, with the haptic in `src/platform/haptics.ts`                          |
| Keyboard shortcuts and arrow keys         | `src/ui/useShortcut.ts`                                                                      |
| Song row                                  | `src/features/catalog/SongItem.tsx` (`SongItem`, `SongLines`, `StatusDot`)                   |
| List row for lists                        | `src/features/lists/ListItem.tsx`                                                            |
| Status labels                             | `src/features/catalog/status.ts`                                                             |
| Status chooser                            | `src/features/song/StatusChooser.tsx`                                                        |
| Facet row under a song's title            | `src/features/song/SongScreen.tsx`                                                           |
| Capsule, rail chip, and badge             | `src/ui/Capsule.tsx`                                                                         |
| Which tunings to show                     | `src/features/settings/instruments.ts`                                                       |
| Instrument checkboxes and their sheets    | `src/features/settings/InstrumentRows.tsx`, `InstrumentsGroup.tsx`, `FirstRunSheet.tsx`      |
| Suggestion vocabularies                   | `src/features/song/suggestions.ts`                                                           |
| Suggestion picker with `Other…`           | `src/features/song/SuggestSelect.tsx`                                                        |
| Key grid and the two key vocabularies     | `src/features/song/KeyChooser.tsx`, `src/features/song/suggestions.ts`                       |
| Key pill and its colors                   | `src/ui/KeyPill.tsx`, `src/ui/keyColor.ts`                                                   |
| Search field                              | `src/ui/SearchField.tsx`                                                                     |
| Search or create                          | `src/features/catalog/searchIntent.ts`, `src/features/catalog/SearchOffer.tsx`               |
| Song search picker                        | `src/features/catalog/SongSearch.tsx`                                                        |
| Catalog query for the session             | `src/features/catalog/searchSession.ts`                                                      |
| Filter rules and count wording            | `src/features/catalog/filters.ts`                                                            |
| Filter bar and filter sheet               | `src/features/catalog/CatalogFilters.tsx`, `src/features/catalog/CatalogFilterSheet.tsx`     |
| Reorder grip and move menu                | `src/features/lists/ListSongs.tsx`                                                           |
| Selection mode, focus, keys, back button  | `src/features/selection/useSelection.ts`, `src/features/selection/useSongSelection.ts`       |
| Selection toolbar and footer              | `src/features/selection/SelectionToolbar.tsx`, `src/features/selection/SelectionFooter.tsx`  |
| Hiding the tab bar while selecting        | `src/features/selection/SelectionProvider.tsx`                                               |
| Bulk actions, their toasts and undo       | `src/features/selection/useBulkActions.tsx`, `src/features/selection/copy.ts`                |
| Bulk edit sheet                           | `src/features/selection/BulkEditSheet.tsx`, `src/features/selection/batchEdit.ts`            |
| Song form and its limits                  | `src/features/song/SongFormSheet.tsx`, `src/features/song/limits.ts`                         |
| Song form detail fields                   | `src/features/song/detailFields.ts`                                                          |
| List picker and song picker               | `src/features/lists/ListPicker.tsx`, `src/features/lists/SongPickerSheet.tsx`                |
| Sheet and dialog                          | `src/ui/Sheet.tsx`                                                                           |
| Menu                                      | `src/ui/Menu.tsx`                                                                            |
| Confirmation                              | `src/ui/Confirm.tsx`, message wording in `src/features/song/deleteSongMessage.ts`            |
| Toast and Undo                            | `src/ui/Toast.tsx`                                                                           |
| Inline error and one wording for refusals | `src/ui/InlineError.tsx`, `src/ui/useAction.ts`                                              |
| Recording and link rows                   | `src/features/recordings/RecordingItem.tsx`, `src/features/links/LinkItem.tsx`               |
| Recording title, meta, and row control    | `src/features/recordings/recordingRow.ts`, `src/features/player/rowGlyphs.tsx`               |
| Recording status words and sizes          | `src/features/recording/format.ts`                                                           |
| Row actions on a recording                | `src/features/recordings/useRecordingActions.ts`                                             |
| Record screen and the one seam into it    | `src/features/recording/RecordModal.tsx`, `src/features/recording/useRecord.tsx`             |
| Player dock                               | `src/features/player/Dock.tsx`, `src/features/player/playerHeight.ts`                        |
| Empty state                               | `src/ui/EmptyState.tsx`                                                                      |
| Sync badge and the full state             | `src/ui/SyncBadge.tsx`, `src/sync/labels.ts`, `src/features/settings/SyncGroup.tsx`          |
| Relative date wording                     | `src/features/lists/editedLabel.ts`                                                          |
| Reduced motion                            | `src/platform/motion.ts`, `src/app/theme/variables.css`                                      |
