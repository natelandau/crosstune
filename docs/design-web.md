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
- Type: `web/src/theme/type.css`, one `t-*` class per role, defined once
  for touch and a step smaller for pointer.
- Radii, shadows, targets, timing: `web/src/theme/shape.css`.
- A screen never types a color, text size, radius, or row height.
- Jet: practice and trim ground only, in every appearance. Never the app
  ground. Dark mode app ground is a neutral near-black.
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

| Frame | Structure                                                           |
| ----- | ------------------------------------------------------------------- |
| Phone | One pane, bottom tab bar with the Record dome, now playing above it |
| Split | Sidebar, one pane where list and page take turns                    |
| Wide  | Sidebar, resizable content column, detail column                    |

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
- Phone: Catalog's title is the status scope menu.
- Pointer selection: bulk actions take the pane bar's trailing place.
  Select all is an icon, so the count keeps its word at the default column
  width. Phone: they replace the tab bar.
- Filter row: touch, one line that scrolls sideways and fades at its end.
  Pointer, wraps.
- Catalog filter row: Status, Key, Filters.

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
- Sidebar: the Mac sidebar's slate tint, inset 8px from the window with
  `--radius-surface` corners, no hairline and no shadow. Record
  capsule (red dot, "Record", centered) runs the sidebar's inner width at
  its foot, 12px below Settings.
  Selected row takes the slate wash. Sync badge leads the header.
- Phone tab bar: Catalog, Lists, Record dome, Recordings, Settings. Solid,
  on the ground, top hairline, no glass. Dome: solid disc, recording-red
  dot, raised over the bar's middle. Sync badge beside the screen title.

### Now playing

- Phone: solid bar above the tab bar. A tap opens practice. No list
  transport on the bar.
- Split and wide: 48px bar docked across the foot of the detail pane, top
  hairline, shown over an empty detail column too. Pointer frames add list
  transport.
- Embed: at most 40% of the pane.

## Rows

- `web/src/ui/Row.tsx` is the one row, `RowList.tsx` the one list.
- Touch: a second secondary line holds only non-standard tunings, capos,
  and "Archived". Pointer: one line.
- Touch: left swipe shows actions, long press opens the menu. A swipe
  starts only for a touch pointer, never a mouse drag.
- Pointer: hover and focus show actions trailing.
- Reorder: drag the whole row, after a long press on touch. Move is a drag
  button named "Move" plus the title, hidden until focused.
- Long press vibrates where supported once the hold takes. Release without
  movement opens the menu. Movement after the hold drags.

## Pages

- Charts are styled elements, never SVG.
- Only the row highlight reaches into the gutter.
- Settings page: phone and split push it, wide shows it in the detail
  column. The root holds only the account block, the catalog block that
  opens stats, the categories, and About.

## Overlays

`Sheet.tsx`, `Menu.tsx`, `Confirm.tsx`, `Toast.tsx` in `web/src/ui/`.
`PointerOverlay` is the one centered pointer surface.

| Overlay    | Touch                                      | Pointer                                       |
| ---------- | ------------------------------------------ | --------------------------------------------- |
| Sheet      | Bottom sheet, grabber, part or full height | Centered dialog, 480px                        |
| Menu       | Bottom action sheet                        | Popover at its control, or at the right-click |
| Confirm    | Action sheet                               | Alert dialog                                  |
| Quick Find | Full-height sheet                          | Centered field, window's upper third          |

- Touch sheet follows the finger and settles with release velocity.
  `sheetGeometry.ts` holds detents and the release rule. The page behind
  recedes slightly.
- Lyrics reader and scan viewer cover the whole window.
- A sheet that can lose typed work sets `locked`.
- A long list behind a sheet is virtualized or short: opening a sheet costs
  time in proportion to the page under it.
- Toast: `TOAST_MS`, held while hovered or focused. Phone: above the
  now-playing bar. Pointer: bottom center of the detail pane.
- Sheets, dialogs, menus, and Quick Find share one modal layer, and the
  page behind is inert. The toast sits above it and outside the inert page,
  so Undo stays in reach behind a sheet.
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

## Forms

- Closed choice opens an action sheet on touch, a popover list box on
  pointer. Never a segmented control: it announces as a tab list and spends
  width on unchosen values.
- Status is a rail of capsules, one per word.

## Practice

- Jet ground in every appearance, drawn in the dark scheme.
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
- A status filter change slides the title or sidebar wash. Counts roll.
- Practice and Record grow from the control that opened them and shrink
  back into it.
- A new take's row slides in with a brief slate highlight.
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

| Keys                      | Action                                        |
| ------------------------- | --------------------------------------------- |
| Cmd-K or Ctrl-K           | Quick Find, at every density                  |
| `N`                       | New tune                                      |
| `R`                       | Record                                        |
| `?`                       | Shortcut sheet                                |
| `/`                       | Focus the screen's search                     |
| `G`, then `C` `L` `R` `S` | Go to Catalog, Lists, Recordings, or Settings |
| Space                     | Play or pause                                 |
| Escape                    | Step out, at every density                    |

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

- Focus ring: slate, 2px outside, on `:focus-visible`, from
  `web/src/ui/focus.css` only. A container that only passes focus on
  (dialog, menu, grid) shows no ring.
- Hover-revealed controls hide with opacity 0, never `visibility` or
  `display`.
- Contrast also holds on jet.
- Forced colors: a glyph whose meaning is a fill paints in system colors.
