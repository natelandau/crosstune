# Crosstune web design rules

Web only. Read `design.md` first. This page wins on the web where they
differ. Each pattern is one primitive in `web/src/ui/` or its feature
folder. Compose it, never rebuild it.

## Principles

- Apple's tokens, rows, zones, and words in the shape a browser gives them.
  Never Apple's materials.
- The frame follows the window size. The density follows the pointer.

## Tokens

- Colors: `web/src/theme/tokens.css`, mirrored in `tokens.ts` so tests
  measure contrast. Change both together.
- Color tokens take the roles of Apple's `Palette`, under its names where
  one exists (`--accent`, `--accent-fill`, `--ground`, `--surface`,
  `--field`, `--mark-ink`). `--ink-2` is `inkSecondary`.
- Layers: cards and blocks (form groups, the account and stats blocks),
  the sidebar, and the tab bar on `--surface`. Search fields, chips, and
  capsules on `--field`. A form row has no fill of its own and sits on
  its group's card.
- `bg-surface` is the one way to paint a surface, and a test holds every
  view to it. Inside it, `--field` becomes `--raised` and a `bg-field`
  control takes the `--control-edge` hairline.
- The unknown ring takes `--unknown-on-surface` inside `.bg-surface` and
  under any row or filter wash (`data-selected`, `data-hovered`,
  `data-current`, `data-pressed`, `data-playing`, `data-set`, or
  `aria-current="page"`).
- A plain `Button` with words takes `--accent`, and so does a plain glyph
  button in a `PageSection` heading. A plain glyph button elsewhere stays
  `--ink`.
- Type: `web/src/theme/type.css`, one `t-*` class per role, defined once
  for touch and a step smaller for pointer.
- Radii, shadows, targets, timing: `web/src/theme/shape.css`.
- A screen never types a color, text size, radius, or row height.
- Jet: the practice and trim ground and tooltips only. Never the app
  ground.
- Set filter: `set-fill` wash, `set-label` color.
- Key pill hue: generated `--key-N` tokens, one rule for every pitch.
- Geist is the one face, self-hosted from `@fontsource-variable/geist` so
  the service worker caches it. The `type.css` stack adds sharp and flat
  signs from a symbol face.
- Sizes in rem, so the text size setting scales every role. Exception: the
  lyrics reader's own six-step px scale, per device.
- Counting figure keeps one weight: Geist's tabular width changes with
  weight. Numbers that change or line up take `t-num`.
- Signed value: true minus (U+2212) in a fixed slot.
- Fixed box for a number: size in em. Never `ch` or figure spaces, which
  measure Geist's proportional zero.
- Touch text fields never below 16px, so iOS Safari does not zoom.
- Radius follows hierarchy: capsules and pills fully round. Sheets,
  dialogs, popovers, toast, and Quick Find `--radius-surface`. Row
  highlights and inputs `--radius-row`.
- Only floating surfaces cast `--shadow-float`. In dark mode they also take
  a faint light edge, since a black shadow vanishes on near-black.
- 4px spacing grid.
- Page width cap in px, so the text size setting scales type, not the
  column.

## Frames

| Frame | Structure                                                          |
| ----- | ------------------------------------------------------------------ |
| Phone | One pane, floating tab bar and Record disc, now playing above them |
| Split | Sidebar, one pane where list and page take turns                   |
| Wide  | Sidebar, resizable content column, detail column                   |

- `web/src/platform/` decides frame and density. No screen asks which
  device it is on.
- `frame.ts` uses width and height together. A short window keeps the
  phone frame, so a landscape phone has no panes.
- Density: `(hover: hover) and (pointer: fine)`. A touch tablet on wide
  keeps touch density.
- Only the app root calls `useDensity`, which stamps `html[data-density]`.
  Everything else reads `useStampedDensity`.

## Placement

- Verbs bar: top-trailing on phone, pane bar on split and wide. On wide,
  the detail column has its own pane bar for Edit and More.
- App-wide zone: bottom on phone, sidebar foot on split and wide.
- Catalog's title is always Catalog. Status is a filter, never the title.
- Pointer selection: bulk actions take the pane bar's trailing place.
  Select all is an icon, so the count keeps its word at the default column
  width. Phone: they replace the tab bar.
- Filter row: touch, one line that scrolls sideways and fades at its end.
  Pointer, wraps.
- Catalog filter row: Status, Key, Filters. Split and wide drop Status:
  the sidebar's status rows set it.

## Shell

- Each thing has one URL, presented per frame. A tune's URL opens in the
  detail column on wide and pushes on phone and split. A refresh or shared
  link lands in the same place on every frame.
- Navigation is browser history. Back is the browser's back.
- Each destination remembers its last location. Choosing the current
  destination again returns to its root.
- Android back: closes the top overlay (a locked one stays or asks to
  discard), then ends a screen state such as selection, then goes back in
  history, or exits at the root.
- No overlay is a route. The URL never changes for a sheet or dialog.
- Sidebar: inset 8px from the window with `--radius-surface` corners, no
  hairline and no shadow. Record capsule (red dot, "Record", centered)
  runs the sidebar's inner width at its foot, 12px below Settings.
  Selected row takes the accent wash. Sync badge leads the header.
- Phone tab bar: a capsule of Catalog, Lists, Tuner, Recordings, then
  the Record disc on its own at the trailing end, recording-red dot. Both
  float over the content, which runs to the bottom of the screen and
  scrolls beneath them. Sizes match the iPhone tab bar: 62px capsule and
  disc, 21px from the edges. Solid, hairline edge, no shadow, no fade, no
  glass. The current tab takes an accent-wash pill that slides between
  tabs. Panes pad their end by `--float-clearance` so the last row
  scrolls clear. Sync badge beside the screen title. Settings opens from
  the account button at the top-trailing edge of the title row, and
  reopens at its remembered place.

### Now playing

- Phone: a card floating just above the tab bar, styled like it. A tap
  opens practice. No list transport on the bar.
- Split and wide: 48px bar docked across the foot of the detail pane, top
  hairline, shown over an empty detail column too. Pointer frames add list
  transport.
- Embed: at most 40% of the pane. A floating card measures the pane it
  floats over.

## Rows

- `web/src/ui/Row.tsx` is the one row, `RowList.tsx` the one list.
- Touch: a second secondary line holds only non-standard tunings, capos,
  and "Archived". Pointer: one line.
- Touch: left swipe shows actions, long press opens the menu. A swipe
  starts only for a touch pointer, never a mouse drag.
- Pointer: hover and focus show actions trailing.
- Reorder: drag the whole row, after a long press on touch. Move is a drag
  button named "Move" plus the title, hidden until focused.
- A mouse or pen drag runs on pointer events, never the browser's drag
  and drop, whose drag image and drop line cannot lift a row or slide the
  others. On a touch layout a pen holds and drags as a finger does.
- Long press vibrates where supported once the hold takes. Release without
  movement opens the menu. Movement after the hold drags.

## Pages

- Charts are styled elements, never SVG.
- Only the row highlight reaches into the gutter.
- A Settings detail has its own URL under its page.
- A link to a Settings group adds `#group` to its page's address. The
  page jumps the group to the top once it renders and holds it there
  until every group has arrived or the musician acts, focus moving into
  the page included. A group still loading renders a `PendingGroup`.
- Settings page: phone and split push it, wide shows it in the detail
  column. The root holds only the account block, the catalog block that
  opens stats, the categories, and About.

## Overlays

`Sheet.tsx`, `Menu.tsx`, `Confirm.tsx`, `Toast.tsx` in `web/src/ui/`.
`PointerOverlay` is the one centered pointer surface.

| Overlay    | Touch                                      | Pointer                                       |
| ---------- | ------------------------------------------ | --------------------------------------------- |
| Sheet      | Bottom sheet, grabber, part or full height | Centered dialog, 480px                        |
| Menu       | Bottom action sheet, fitted                | Popover at its control, or at the right-click |
| Confirm    | Action sheet, fitted                       | Alert dialog                                  |
| Quick Find | Full-height sheet                          | Centered field, window's upper third          |

- Touch sheet follows the finger and settles with release velocity.
  `sheetGeometry.ts` holds detents and the release rule. The page behind
  recedes slightly.
- Fitted: the sheet's height is its content's, up to part height, for a
  short question or a menu.
- Lyrics reader and scan viewer cover the whole window.
- A sheet that can lose typed work sets `locked`.
- A long list behind a sheet is virtualized or short: opening a sheet costs
  time in proportion to the page under it.
- Toast: `TOAST_MS`, held while hovered or focused. Phone: above the
  now-playing bar. Pointer: bottom center of the detail pane.
- Sheets, dialogs, menus, and Quick Find share one modal layer, and the
  page behind is inert. The toast sits above it and outside the inert page,
  so Undo stays in reach behind a sheet.
- The store's checkout opens only after the sheet that asked for it (the
  Plan sheet or a trial notice) has left, and no notice opens over it: its
  window would sit under the sheet's inert page.
- Quick Find finds tunes, lists, recordings, and runs existing commands,
  each showing its key. Sort by is a second step. Escape or back leaves the
  step, keeping the query, before closing.
- A page whose address needs a network answer: open a blank tab during the
  tap, then send it on. Browsers block a tab opened after the wait or after
  a menu dismisses, so such a menu item runs during the tap.
- Never name a source the web cannot play (full Apple Music tracks). Where
  a list says what plays, it names recordings.
- Capture offers no control the session cannot honor. A take resumes by
  itself after an interruption, so no Resume, and the message says so.

### Sheet pages

- A sheet that leads to a second page swaps its body for that page, with
  Back in the header. Escape goes back before it closes the sheet. The URL
  does not change.

### Sheet actions

Web form of the toolbar rule in `design.md`: actions sit at the foot.

- Header: the title, leading. A sheet with no actions closes from an X
  trailing the title, as does one whose actions all lead on and none
  closes (a trial notice, the Plan sheet). A sheet that opens on its own
  headline (the Plan sheet) shows no title, and the X keeps its place.
- Footer: a tertiary action (Reset, Back) leading, then Cancel and the
  primary trailing, Cancel first.
- A sheet that leads to one action has no Cancel and runs the primary
  full width and taller. A secondary sits beneath it as centered plain
  text, and any footnote lines follow, centered (a trial notice).
- The Plan sheet pins nothing: its period choice, Subscribe, and terms
  end its scrolling page on every layout, so the comparison is never
  covered.
- Weight: primary filled. Destructive primary filled red, cautionary
  filled warning. Cancel bordered, so it never reads as a primary that is
  off. Tertiary plain.
- Touch: Cancel and the primary split the width. A lone action runs full
  width. The footer stays at the window's foot at part height and above
  the on-screen keyboard.
- A hairline sets the header or footer apart only while content scrolls
  under it.
- Alert: Cancel and the action in equal shares, focus on Cancel.

## Forms

- Closed choice opens an action sheet on touch, a popover list box on
  pointer. Never a segmented control: it announces as a tab list and spends
  width on unchosen values.
- Status is a rail of capsules, one per word.
- A settings group's action is a button in the row that states what it
  acts on (`StatusRow`): trailing on pointer, full width under the text on
  touch. Bordered, or filled for the one action the group exists to offer.
  Never a row of action-colored text, which reads as a label. Exception:
  Sign out and Delete account stay red rows.

## Practice

- Practice's colors come from `web/src/theme/practiceTheme.css`. A shared
  control drawn on jet (the loops panel's chips) takes its tokens from
  there, never the app's.
- Played bars white over silver unplayed bars.
- Covers the whole window on every frame. Phone: grows out of the
  now-playing bar and closes back into it. Controls capped and centered.
- List playing: header reads list name and position ("Thursday jam, 3 of
  18"). Split and wide put previous and next beside it.
- Follows the queue to the next recording, except while the recording is
  open in trim or under an Edit or Add to tune sheet.

## Motion

- One spring and one ease, from `web/src/theme/motion.ts` and `shape.css`.
- 150 to 350ms. Pointer runs faster than touch.
- No entrance animation on load, no hover lift on rows.
- Open a tune: phone and split push from the trailing edge, the row title
  morphs into the page title. Wide cross-fades, title lifts 6px. A keyboard
  pick swaps with no motion.
- A status filter change slides the sidebar wash. Counts roll.
- Practice and Record grow from the control that opened them and shrink
  back into it.
- A new take's row slides in with a brief accent highlight.
- A list's rows move when a change adds, removes, or reorders them: a new
  row fades in, a removed one fades where it stood while the rows below
  slide over it, and the rest glide to their places. First paint and a
  resize move nothing.
- A list and the empty state that replaces it fade in for each other,
  never on load.
- A menu or popover scales up from 0.96 out of the point it hangs from and
  back into it. A closing one takes no presses.
- Selecting on phone sinks the tab bar and raises the action bar.
- Now playing leaves the way it came. A track change moves only its title.
- A touch row's press wash waits a beat, so a finger that scrolls never
  flashes it.
- Practice: a scrub or pinch past an end or a zoom limit pulls on with
  resistance and springs back, never settling past it.
- Page motion: React's `<ViewTransition>`. Never React Router's
  `viewTransition` prop, which ignores React's transition names.
- Shared title transition name only on phone and split, where the list is
  hidden. A name must be unique on the page.
- Back is a plain swap. Never fake it with a push to the parent route,
  which breaks history.
- Reduced motion: `AppMotion` turns off Motion's transforms and
  `shape.css` turns off view transitions, since neither React nor the
  browser does.

## Keyboard

Single-key shortcuts only on pointer frames. A focused control or row keeps
Space.

| Keys                          | Action                                               |
| ----------------------------- | ---------------------------------------------------- |
| Cmd-K or Ctrl-K               | Quick Find, at every density                         |
| `N`                           | New tune                                             |
| `R`                           | Record                                               |
| `?`                           | Shortcut sheet                                       |
| `/`                           | Focus the screen's search                            |
| `G`, then `C` `L` `R` `T` `S` | Go to Catalog, Lists, Recordings, Tuner, or Settings |
| Space                         | Play or pause                                        |
| Escape                        | Step out, at every density                           |

- Never take a combination the browser owns (Cmd-N, Cmd-R).
- Cmd-K works from a text field too, and stands down while another overlay
  is open.
- Escape closes an open tooltip in the same press.
- Arrows on rows that open in the detail column: the detail follows. On
  Recordings it does not.
- Tab crosses panes in DOM order.
- Practice: arrows move the playhead or nudge a focused loop handle, `1` to
  `9` pick a loop in lane order, `L` or `N` adds a loop. Escape ends a
  rename, then clears loop selection, then closes. In trim, Escape returns
  to practice.

## Accessibility

- Focus ring: the accent, 2px outside, on `:focus-visible`, from
  `web/src/ui/focus.css` only. A container that only passes focus on
  (dialog, menu, grid) shows no ring.
- Hover-revealed controls hide with opacity 0, never `visibility` or
  `display`.
- Contrast also holds on jet.
- Forced colors: a glyph whose meaning is a fill paints in system colors.
