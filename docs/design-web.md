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
- `bg-surface` is the one way to paint a surface, and a test holds every
  view to it. Inside it, `--field` becomes `--raised` and a `bg-field`
  control takes the `--control-edge` hairline.
- A plain `Button` with words takes `--accent`, and so does a plain glyph
  button in a `PageSection` heading. A plain glyph button elsewhere stays
  `--ink`.
- Type: `web/src/theme/type.css`, one `t-*` class per role, defined once
  for touch and a step smaller for pointer.
- Radii, shadows, targets, timing: `web/src/theme/shape.css`.
- A screen never types a color, text size, radius, or row height.
- Jet: tooltips only, in each appearance's own jet. Practice, trim, and
  the tuner draw on `--jet-dark` in either appearance. Never the app
  ground. Practice's colors come from `web/src/theme/practiceTheme.css`,
  and a shared control drawn on jet takes its tokens from there.
- No tertiary ink. Text quieter than secondary is `t-caption` in
  `--ink-2`, never `--ink-2` faded, which falls under 4.5:1.
- Geist is the one face, self-hosted so the service worker caches it.
- Sizes in rem, so the text size setting scales every role. Page width
  caps in px, so it scales type, not the column.
- Signed value: true minus (U+2212) in a fixed slot.
- Radius follows hierarchy: capsules, pills, toggle groups, and icon-only
  buttons fully round. A labeled button in content `--radius-control`, one
  in a bar round. Floating surfaces `--radius-surface`. Row highlights and
  inputs `--radius-row`.
- Only floating surfaces cast `--shadow-float`. In dark mode they also take
  a faint light edge, since a black shadow vanishes on near-black.
- 4px spacing grid.

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

## Shell and placement

- Each thing has one URL, presented per frame: it opens in the detail
  column on wide and pushes on phone and split. A refresh or shared link
  lands in the same place on every frame.
- No overlay is a route. The URL never changes for a sheet or dialog.
- Each destination remembers its last location. Choosing the current
  destination again returns to its root.
- Android back: closes the top overlay (a locked one stays or asks to
  discard), then ends a screen state such as selection, then goes back in
  history, or exits at the root.
- Verbs bar: on split and wide, the pane bar. Phone root screens use
  `RootBar`, one row that replaces the pane bar and the column title.
- App-wide zone: bottom on phone, sidebar foot on split and wide.
- The phone's tab bar and Record disc float over the content, solid, with
  a hairline edge and no glass. Panes pad their end by
  `--float-clearance`, so the last row scrolls clear.
- `PaneScroller` scroll-pads by its pinned bar and `--float-clearance`, so
  focus never lands under chrome. A new scroll container under pinned or
  floating chrome is a `PaneScroller`.
- Pointer selection: bulk actions take the pane bar's trailing place.
  Phone: they replace the tab bar.
- Filter row: touch, one line that scrolls sideways and fades at its end.
  Pointer, wraps.

## Rows

- `web/src/ui/Row.tsx` is the one row, `RowList.tsx` the one list.
- Touch: details on a second secondary line. Pointer: one line.
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

## Overlays

`Sheet.tsx`, `Menu.tsx`, `Confirm.tsx`, `Toast.tsx` in `web/src/ui/`.
`PointerOverlay` is the one centered pointer surface.

| Overlay | Touch                                      | Pointer                                       |
| ------- | ------------------------------------------ | --------------------------------------------- |
| Sheet   | Bottom sheet, grabber, part or full height | Centered dialog, 480px                        |
| Menu    | Bottom action sheet, fitted                | Popover at its control, or at the right-click |
| Confirm | Action sheet, fitted                       | Alert dialog                                  |

- Touch sheet follows the finger and settles with release velocity
  (`sheetGeometry.ts`). Fitted: the sheet's height is its content's, up to
  part height.
- A sheet that can lose typed work sets `locked`.
- Sheets, dialogs, and menus share one modal layer, and the page behind is
  inert. The toast stays in reach behind a sheet, and holds while hovered
  or focused.
- Never name a source the web cannot play (full Apple Music tracks).
- Capture offers no control the session cannot honor.

### Sheets

- A sheet that leads to a second page swaps its body for that page, with
  Back in the header. Escape goes back before it closes. The URL does not
  change.
- Header: the title, leading. A sheet with no closing action closes from
  an X trailing the title.
- Footer: actions sit at the foot. A tertiary action (Reset, Back)
  leading, then Cancel and the primary trailing, Cancel first.
- A sheet that leads to one action has no Cancel and runs the primary
  full width.
- Weight: primary filled. Destructive primary filled red, cautionary
  filled warning. Cancel bordered, so it never reads as a primary that is
  off. Tertiary plain.
- Touch: Cancel and the primary split the width. The footer stays at the
  window's foot and above the on-screen keyboard.
- A hairline sets the header or footer apart only while content scrolls
  under it.
- Alert: Cancel and the action in equal shares, focus on Cancel.

## Forms

- Closed choice opens an action sheet on touch, a popover list box on
  pointer. Never a segmented control: it announces as a tab list and spends
  width on unchosen values.
- A settings group's action is a button in the row that states what it
  acts on (`StatusRow`): trailing on pointer, full width under the text on
  touch. Never a row of action-colored text, which reads as a label.

## Motion

- One spring and one ease, from `web/src/theme/motion.ts` and `shape.css`.
  150 to 350ms. Pointer runs faster than touch.
- No entrance animation on load, no hover lift on rows.
- Opening an item: phone and split push from the trailing edge, the row
  title morphing into the page title. Wide cross-fades. A keyboard pick
  swaps with no motion.
- An overlay opened from a control grows from it and shrinks back into
  it. A menu or popover scales from the point it hangs from. A closing one
  takes no presses.
- A list's rows move when a change adds, removes, or reorders them. First
  paint and a resize move nothing. A list and the empty state that
  replaces it fade into each other, never on load.
- A touch row's press wash waits a beat, so a finger that scrolls never
  flashes it.

## Keyboard

- Single-key shortcuts only on pointer frames. A focused control or row
  keeps Space.
- Never take a combination the browser owns (Cmd-N, Cmd-R).
- Cmd-K works from a text field too, and stands down while another overlay
  is open.
- Cmd-Z or Ctrl-Z presses the showing toast's Undo, never from a text
  field, whose own undo keeps it.
- Escape closes an open tooltip in the same press.
- Tab crosses panes in DOM order.

## Accessibility

- Focus ring: the accent, 2px outside, on `:focus-visible`, from
  `web/src/ui/focus.css` only. A container that only passes focus on
  (dialog, menu, grid) shows no ring.
- Focus returns to the opener when an overlay closes.
- Headings never skip a level. A page's title is h1, a sheet's or section's
  h2. A heading under one takes `useSubheadingLevel` from
  `web/src/ui/headingLevel.ts`.
- Contrast also holds on jet.
- Forced colors: a glyph whose meaning is a fill paints in system colors.

## Framework limits

Browser and library behavior that a new screen runs into.

- Geist's tabular width changes with weight, so a counting figure keeps
  one weight. Numbers that change or line up take `t-num`.
- A fixed box for a number is sized in em. Never `ch` or figure spaces,
  which measure Geist's proportional zero.
- iOS Safari zooms into a text field under 16px, so touch fields never go
  below it.
- A drag runs on pointer events, never the browser's drag and drop, whose
  drag image and drop line cannot lift a row or slide the others.
- The playback engine reports its position at every tick. A view reads the
  engine's discrete facts with `useEngineState`, and draws position from a
  `PlayheadClock` (`features/player/playheadClock.ts`): DOM writes each
  frame, a render only when its text changes. Never subscribe to the whole
  engine state.
- Opening a sheet costs time in proportion to the page under it, so a long
  list behind a sheet is virtualized or short.
- A virtualized `RowList` hands a row's element to another row as it
  scrolls. State inside a row's content sits under a `key` of the row's id,
  or it carries over to the next row.
- A window opened by a third party (a store checkout) opens only after the
  sheet that asked for it has left, and no notice opens over it: it would
  sit under the sheet's inert page.
- Browsers block a tab opened after a network wait or after a menu
  dismisses. A page whose address needs a network answer opens a blank tab
  during the tap, then sends it on.
- Page motion is React's `<ViewTransition>`. Never React Router's
  `viewTransition` prop, which ignores React's transition names. A shared
  transition name is unique on the page, so it goes only where the list is
  hidden (phone and split).
- Back is a plain swap. A push to the parent route breaks history.
- Neither React nor the browser honors reduced motion, so motion goes
  through Motion (turned off by `AppMotion`) or `shape.css` (which turns
  off view transitions).
