# Crosstune web design rules

Rules every web screen follows, beside the rules in `design.md`. Where the
two pages disagree, this page holds in the web client. The Apple apps never
take a rule from this page. Each pattern is one primitive, in `web/src/ui/`
or its feature folder. A new screen composes it and never rebuilds it.

## Principles

1. One language, web form. The web shares the Apple apps' tokens, rows,
   zones, and words. It takes the shape a browser gives it, never Apple's
   materials.
2. One home per kind of control. The job of a control tells the musician
   where it is.
3. Quiet chrome, musical content. Color comes from the music and one slate
   accent. Boldness goes to two places only: the key hues and practice.
4. A tune is a page, not a form. The musician reads it as a document and
   edits it in a sheet.
5. The frame follows the size. The density follows the pointer.

## Tokens

`web/src/theme/tokens.css` holds every color for CSS and Tailwind.
`tokens.ts` holds the same values, so tests can measure contrast. A change
to one is a change to both. A screen never types a color value, a text
size, a radius, or a row height of its own.

### Color roles

| Role    | Marks                                                                                                       | Never marks                    |
| ------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Ground  | Every screen, sheet, and bar. Dark mode is a neutral near-black                                             | Practice                       |
| Ink     | Text. Secondary text is `ink-2`                                                                             | A chosen state                 |
| Slate   | The one accent: chosen state, selection wash, focus ring, primary button                                    | Status, danger                 |
| Coral   | The selected sidebar row's glyph, the playhead of anything that plays back, every loop handle, and the mark | Danger, any other chosen state |
| Jet     | Practice and trim, in every appearance                                                                      | The app ground                 |
| Record  | The Record dome and capsule, the live waveform, and Stop                                                    | A destructive action           |
| Danger  | A destructive action                                                                                        | Recording, a status            |
| Warning | A cautionary action                                                                                         | A destructive action           |

- A label on a slate fill takes `on-slate`, never white by default,
  because dark slate is a light color.
- A set filter takes the `set-fill` wash and the `set-label` color.
- A loop handle is coral whatever its loop's color. The loop's color stays
  on its band and its tab.
- Status, key, loop, and heatmap colors are the same as on every platform.
  A key pill takes its hue from the generated `--key-N` tokens, one rule
  for every pitch.

### Type

Geist is the one face, self-hosted from `@fontsource-variable/geist` so the
service worker caches it. `web/src/theme/type.css` defines each role
once for touch and once, a step smaller, for pointer.

| Role            | Class            | Use                                            |
| --------------- | ---------------- | ---------------------------------------------- |
| Page title      | `t-page-title`   | The title of a document page, such as a tune   |
| Screen title    | `t-screen-title` | The title of a list screen or a column         |
| Section heading | `t-heading`      | A section on a page, a group in a list         |
| Body            | `t-body`         | Row titles, prose, field values                |
| Secondary       | `t-secondary`    | Row details, facts lines, help                 |
| Caption         | `t-caption`      | Counts on a sidebar row, small labels          |
| Timer           | `t-timer`        | The recording timer                            |
| Lyrics          | `t-lyrics`       | The lyrics reader's words, under its size step |

- Sizes are in rem, so the text size setting scales every role.
- The lyrics reader sets its words on its own six-step px scale, chosen per
  device, which the text size setting does not scale.
- Every number that changes or lines up takes `t-num`. A counting figure
  keeps one weight, because Geist's tabular width changes with the weight.
- A signed value uses the true minus, U+2212, in a fixed slot, so `+3` and
  `−3` line up.
- A fixed box for a number is sized in em. Never size it in `ch` or pad it
  with figure spaces, because both measure Geist's proportional zero.
- On touch, a text field's text never drops below 16px, so iOS Safari does
  not zoom on focus.
- Geist has no sharp or flat sign. The font stack in `type.css` supplies
  them from a symbol face.

### Shape and depth

`web/src/theme/shape.css` holds radii, shadows, targets, and timing.

- Radius follows hierarchy. Capsules and pills are fully round. Sheets,
  dialogs, popovers, the toast, and Quick Find take `--radius-surface`.
  Row highlights and inputs take `--radius-row`.
- Only a surface that floats casts a shadow, through `--shadow-float`. No
  row, section, or page casts one.
- In dark mode a floating surface also takes a faint light edge, because a
  black shadow does not show on the near-black ground.
- Spacing is on one 4px grid.
- A document page is at most 680px wide and centered. The width is in
  pixels, so the text size setting scales the type and not the column.

## Frames and density

The layout answers two separate questions. `web/src/platform/`
answers both, and no screen asks which device it is on.

| Frame | Structure                                                                    |
| ----- | ---------------------------------------------------------------------------- |
| Phone | One pane, the bottom tab bar with the Record dome, now playing above the bar |
| Split | The sidebar, and one pane where the list and the page take turns             |
| Wide  | The sidebar, a resizable content column, and the detail column               |

- `frame.ts` decides the frame from width and height together. A short
  window keeps the phone frame, so a landscape phone has no panes.
- Density follows the pointer, `(hover: hover) and (pointer: fine)`, never
  the frame. A touch tablet on the wide frame keeps touch density.
- Touch density: 44px targets and rows, swipe actions, no hover reveals.
- Pointer density: 32px rows, 28px pane controls, 24px filter controls,
  hover reveals, and keyboard shortcuts.
- Only the app root calls `useDensity`, which stamps `html[data-density]`.
  Every other component reads `useStampedDensity`.
- A resize, a rotation, or a frame change keeps the selection, the scroll
  position, the open destination, and the playing item.

## Placement

Each kind of control has one zone.

| Zone                                         | Holds                                                                         | Never holds                 |
| -------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------- |
| Title                                        | What the screen shows. On the phone, Catalog's title is the status scope menu | Actions                     |
| Top-trailing (phone), pane bar (split, wide) | The screen's verbs: Add or Edit first, then one More menu. At most two        | Filters, sort, view options |
| Under the title                              | How to narrow: the search field, then one filter row                          | Verbs                       |
| List header                                  | The count leading and the sort trailing, directly above the rows              | Anything else               |
| Bottom (phone), sidebar foot (split, wide)   | App-wide controls only: tabs, Record, now playing, the selection bar          | A screen's own actions      |

- A section's verb sits on that section's own heading, at the trailing
  edge.
- A list page is the one exception under the title: its play row sits
  there, with Play, Shuffle, and the line that says how many tunes play.
- Select is never a toolbar button.
- A control sits over the pane it acts on. On wide, the detail column has
  its own pane bar for Edit and More.
- A column's title is the first line of its content and scrolls with it.
  The pane bar shows the title small only after that line scrolls away.
- The detail column shows only a page, never a list. A list opens in the
  content column, and its tunes open in the detail column.
- An empty detail column is never blank. It names what it waits for: a
  list at the lists root, a setting in Settings, else a tune with how to
  reach one.
- On pointer frames, a selection's bulk actions take the pane bar's
  trailing place and Select all is an icon, so the count keeps its word at
  the default column width. Only where the word cannot fit does the bar
  show the digit alone. On the phone, they replace the tab bar.
- On touch the filter row is one line that scrolls sideways and fades at
  its end. On pointer it wraps, because a mouse scrolls up and down.
- The catalog's filter row is Status, Key, then Filters with its count.
  Type is a row in the filter sheet. Status and Key show on their own
  controls, so the Filters count and the tokens never include them.
- The catalog's Filters stays in place, disabled, while the list loads or
  holds no tunes, where the empty state already says why.
- Recordings shows Filters only once loaded, and only while an import gives
  the sources something to tell apart or a source is set. The control is
  never disabled.

## Shell

### Routes and history

- Each thing has one URL, presented per frame. A tune's URL opens it in the
  detail column on wide and pushes it on phone and split. A refresh or a
  shared link lands in the same place on every frame.
- Navigation is browser history. Back is the browser's back, and Android's
  back gesture and button do the same.
- Each tab or sidebar destination remembers its last location. Choosing
  the current destination again returns to its root.
- On Android, back closes the top overlay first. A locked overlay stays
  open or asks to discard. Then a screen state such as selection ends.
  Then history goes back, or the app exits at its root.
- No overlay is a route. A sheet or dialog opens over the current screen
  and the URL does not change.

### Sidebar

The split and wide frames carry a sidebar.

- Catalog leads, with Known, Learning, and Unknown indented under it. The
  sidebar selection and the catalog's status filter are one stored value,
  the same one the phone's title menu and a stats link write.
- Recordings follows, then a Lists section whose heading carries the add
  control.
- Settings, then the Record capsule, sit at the sidebar's foot. The capsule
  is a red dot and "Record".
- A count beside a row is absolute: non-archived tunes, whatever the
  filters. A zero count is hidden. The column's list header gives the
  narrowed count.
- The selected row takes the slate wash and its glyph turns coral. A status
  glyph keeps its status color, because the color is its meaning.
- The sync badge leads the sidebar's header.

### Phone tab bar

- The tab bar holds Catalog, Lists, the Record dome, Recordings, and
  Settings.
- The bar is solid, on the ground, with a top hairline. It has no glass.
- The dome is a solid disc with the recording-red dot, raised over the
  middle of the bar.
- The dome stands down behind every presentation and while a screen is
  selecting.
- The sync badge sits beside the screen title.

### Now playing

- Phone: a solid bar directly above the tab bar. A tap on the bar opens
  practice.
- Split and wide: a 48px bar docked edge to edge across the foot of the
  detail pane, with a hairline on top. It shows over the empty detail
  column too.
- The bar's scrubber is a thin line with the coral playhead.
- An embed grows up out of the bar, at most 40% of the pane.
- While a list plays, previous, next, shuffle, and repeat join the bar on
  pointer frames. On the phone, the bar carries none of them. Full-screen
  practice carries all four in its transport row.
- Every column clears the bar, so its last row scrolls above it.

## Rows

`web/src/ui/Row.tsx` is the one row, and `RowList.tsx` is the one list
of rows.

- A tune row: status glyph, title in regular weight, tunings in secondary,
  then the compact key pill trailing, so the keys form a column.
- On touch, a second line in secondary shows only non-standard tunings,
  capos, and "Archived". On pointer the row is one line. Tunings truncate,
  then drop out, before the title shrinks.
- A row has no separator.
- A status glyph's word is also its tooltip.
- A list row leads with a tabular position number. The row of the playing
  item shows an animated speaker and a light slate wash.
- A recording or link row is two lines. An idle play glyph is secondary,
  and the loaded item's glyph takes slate.
- A selected row takes the inset slate highlight and keeps every glyph's
  own color.
- A row shows at most three actions. The rest wait in the row menu.
- On touch, a left swipe shows the row's actions, and a long press opens
  the row menu. On pointer, hover and keyboard focus show the actions at
  the trailing edge, and a right-click opens the same menu.
- A swipe starts only for a touch pointer. A mouse drag never starts one.
- A list reorders by a drag on the whole row, after a long press on touch.
  A row has no grip.
- A reorderable row's Move control is a drag button named "Move" plus the
  title, hidden until it has keyboard focus.
- A long press vibrates the phone where it can once the hold takes.
  Released without movement, it opens the row menu. Movement after the
  hold becomes the drag.

## Pages

A page is a view that reads as a document, such as the tune page or stats.

- A page stands on the plain ground, with no cards.
- Its title is in the page title role and is selectable.
- A section opens with a heading in the section heading role, with its add
  control trailing. Space separates sections, never a hairline.
- An empty section shows only its heading and its add control.
- A chart is styled elements, never SVG.
- Row text starts on the section headings' leading edge. A row's glyph starts
  on that edge in a fixed slot, so titles line up whether or not a row shows
  a glyph. Only the row highlight reaches into the gutter.
- On wide, a move to another tune cross-fades. The page on screen stays
  until the next one has read, so the column never goes blank.
- Settings is a root of categories, each its own page. A new setting joins
  the page of its category, never the root. Phone and split push the page.
  Wide shows it in the detail column.
- Above the categories, the Settings root holds two blocks: the account,
  with the sync state as its second line, and the catalog in one line over
  its status bar, which opens stats. An About line with the version closes
  the root. These are the only things on the root that are not a category.

## Overlays

Each overlay follows the density and is built once, in `web/src/ui/`:
`Sheet.tsx`, `Menu.tsx`, `Confirm.tsx`, and `Toast.tsx`. `PointerOverlay`
is the one centered surface for pointer.

| Overlay    | Touch                                                   | Pointer                                                     |
| ---------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| Sheet      | Bottom sheet with a grabber, part height or full height | Centered dialog 480px wide                                  |
| Menu       | Bottom action sheet                                     | Popover at its control, or at the pointer for a right-click |
| Confirm    | Action sheet                                            | Alert dialog                                                |
| Quick Find | Full-height sheet                                       | Centered field in the window's upper third                  |

- A touch sheet follows the finger and settles with its release velocity.
  `sheetGeometry.ts` holds the detents and the release rule.
- While a touch sheet shows, the page behind it recedes slightly.
- The lyrics reader covers the whole window. Its header holds the text
  size and Close, and Edit lyrics follows the words.
- The scan viewer covers the whole window. Its header holds the count,
  Invert, and Close. Zoom, with Previous scan and Next scan, sits in a bar
  under the scans.
- A sheet that can lose typed work sets `locked`, which also refuses
  Escape.
- A long list behind a sheet is virtualized or short, because opening a
  sheet costs time in proportion to the page under it.
- A menu puts its destructive items last.
- The toast shows one message at a time, for `TOAST_MS`. It stays while
  the pointer is over it or focus is inside it.
- On the phone the toast sits above the now-playing bar. On pointer it sits
  at the bottom center of the detail pane.
- Quick Find finds tunes, lists, and recordings, and runs commands the app
  already has. Each command shows its key.
- Only Cmd-K or Ctrl-K opens Quick Find.
- Sort by in Quick Find is a second step. Escape or back leaves the step,
  with the query it left, before Quick Find closes.
- A tap that opens a page whose address needs a network answer opens a
  blank tab during the tap and sends it on once the answer lands. A browser
  blocks a tab opened after the wait, and after a menu's dismissal, so such
  a menu item runs during the tap.
- A sheet never names a source the web cannot play, such as full Apple
  Music tracks. Where a list says what plays, it names recordings, and
  links play from each tune's play button.
- A capture surface offers no control the session cannot honor. A take
  resumes by itself after an interruption, so there is no Resume, and the
  interrupted message says so.

### Layering

- Sheets, dialogs, menus, and Quick Find share one modal layer. While one
  shows, the page behind it is inert.
- The toast sits above the modal layer and outside the inert page, so its
  Undo stays in reach while a sheet is open.

## Forms

A form is a `Sheet`: part height for a short form, full height for a long
one.

- A form groups its fields in sections, because a form is where a reader
  expects groups.
- A closed choice is a field row that opens the one picker: an action
  sheet on touch, a popover list box on pointer.

## Practice

- Practice stands on jet in every appearance and draws everything on it in
  the dark scheme.
- The playhead is fixed and coral, and the wave scrolls under it. Played
  bars are white over silver unplayed bars. Loop bands take their loop
  colors.
- Trim stands on the same jet ground with plain white handles and playhead,
  so editing reads apart from practice.
- Practice covers the whole window on every frame. On the phone it grows
  out of the now-playing bar and closes back into it. It takes the width,
  with its controls capped and centered.
- While a list plays, the header reads the list's name and the position,
  such as "Thursday jam, 3 of 18". On split and wide, previous and next sit
  beside it.
- While a list plays, practice follows the queue to the next recording. The
  list holds at the end of a recording that is open in trim, or under an
  Edit or Add to tune sheet.

## Motion

| Moment                     | Motion                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| Open a tune (phone, split) | The page pushes from the trailing edge. The row title morphs into the page title              |
| Pick a tune (wide)         | The detail cross-fades and the title lifts 6px. A pick from the keyboard swaps with no motion |
| Change status scope        | The title or the sidebar wash slides. The count rolls                                         |
| Set a filter               | The capsule fills slate, the token slides in, and the count rolls                             |
| Status changes             | The glyph fills or empties in place                                                           |
| Play                       | Now playing rises with a spring. Play and pause swap                                          |
| Open practice              | Practice grows out of the now-playing bar or dock and closes back into it                     |
| Record                     | The sheet grows from the dome or capsule. Stop shrinks it back                                |
| New take filed             | The row slides in with a brief slate highlight                                                |
| Loop handle snaps          | The handle settles with a spring                                                              |
| Open lyrics                | The reader cross-fades in and out                                                             |
| Open scans                 | The viewer cross-fades in and out                                                             |
| Sheet                      | The sheet follows the finger and settles with its release velocity                            |

- One spring and one ease, from `web/src/theme/motion.ts` and
  `shape.css`.
- Durations stay between 150 and 350ms. Pointer frames run faster than
  touch.
- No entrance animation on page load, and no hover lift on rows.
- Page motion uses React's `<ViewTransition>`. A link never takes React
  Router's `viewTransition` prop, because that path ignores React's
  transition names.
- The row title and the page title share a transition name only on phone
  and split, where the list is hidden. A name must be unique on the page.
- Back is a plain swap. Never fake a back animation with a push to the
  parent route, because that breaks browser history.
- Under reduced motion every moment becomes a cross-fade or nothing.
  `AppMotion` turns off Motion's transforms, and `shape.css` turns off
  view transitions, which neither React nor the browser does. A new take
  shows in place, and only its highlight fades.

## Keyboard

Single-key shortcuts exist on pointer frames only. Each stands down while
a text field or an overlay holds the keyboard. A focused control or row
keeps Space for itself.

| Keys                      | Action                                        |
| ------------------------- | --------------------------------------------- |
| Cmd-K or Ctrl-K           | Open Quick Find                               |
| `N`                       | New tune                                      |
| `R`                       | Record                                        |
| `?`                       | Open the shortcut sheet                       |
| `/`                       | Focus the screen's search                     |
| `G`, then `C` `L` `R` `S` | Go to Catalog, Lists, Recordings, or Settings |
| Space                     | Play or pause                                 |
| Escape                    | Step out: the top overlay, then the selection |

- A shortcut never takes a combination the browser owns, such as Cmd-N or
  Cmd-R.
- Quick Find opens with Cmd-K at every density; its presentation follows
  the density.
- Cmd-K or Ctrl-K opens Quick Find from a text field too, and stands down
  while another overlay is open.
- Escape works at every density. An open tooltip closes in the same press.
- When the arrows walk rows that open in the detail column, the detail
  column follows. On Recordings the arrows move between rows and leave
  the detail alone.
- Focus moves across the panes by Tab, in DOM order.
- In practice, the arrows move the playhead or nudge a focused loop handle,
  `1` to `9` pick a loop in lane order, and `L` or `N` adds a loop at the
  playhead.
- Escape in practice ends a rename, then clears the loop selection, then
  closes practice back into the now-playing bar or dock. Escape in trim
  steps back to practice.

## Accessibility

- Every focusable element shows a slate ring 2px outside it on
  `:focus-visible`. `web/src/ui/focus.css` is the one ring.
- A container that takes focus only to pass it on, such as a dialog, a
  menu, or a grid, shows no ring.
- A hover-revealed control hides with opacity 0, never `visibility` or
  `display`. It keeps its place, its tab stop, and its accessible name.
- Every glyph-only control carries its name as a pointer tooltip as well
  as its accessible name.
- Text passes 4.5:1 and glyphs pass 3:1, in both appearances and on jet.
  Tests measure each pair from `tokens.ts`.
- Under forced colors, a glyph whose meaning is a fill paints itself in the
  system colors, so its shape still reads.
