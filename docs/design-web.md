# Crosstune web design rules

Web only. Read `design.md` first. This page wins on the web where they
differ.

## Shared components

- The library is `web/src/ui`, reviewed on `/gallery`. A new kind of
  control goes into both. A lint exception needs the owner's approval.
- A button gets its working and done states by receiving its work: the
  press returns the promise, or hands it to `track` once the musician
  confirms. Never fire work and forget it.

## Principles

- Apple's tokens, rows, zones, and words in the shape a browser gives them.
  Never Apple's materials.
- The frame follows the window size. The density follows the pointer.

## Tokens

- A screen never types a color, text size, radius, or height.
- Text quieter than secondary is `t-caption` in `text-secondary`, never
  `text-secondary` faded or `text-tertiary`, which fall under 4.5:1.
- Sizes in rem, so the text size setting scales every role. Page width
  caps in px, so it scales type, not the column.
- Signed value: true minus (U+2212) in a fixed slot.
- 4px spacing grid.

## Frames

- `web/src/platform/` decides frame and density. No screen asks which
  device it is on.
- Only the app root calls `useDensity`, which stamps `html[data-density]`.
  Everything else reads `useStampedDensity`.

## Shell and placement

- Each thing has one URL, presented per frame: it opens in the detail
  column on wide and pushes on phone and split. A refresh or shared link
  lands in the same place on every frame.
- No overlay is a route. The URL never changes for a sheet or dialog.
- A phone root screen's title never truncates. Where it would, the screen
  moves a bar button into More (`useCrowdedRootTitle`).
- A scroll container under pinned or floating chrome is a `PaneScroller`,
  so focus never lands under the chrome.

## Pages

- Tabs that switch a panel are the header of that panel's card. Tabs that
  switch a whole page or sheet sit at its top, with no card.

## Overlays

- A sheet, popover, or editor stays mounted and closes through `isOpen`,
  never `{open && <Sheet />}`: unmounting skips its exit. State that must
  start fresh each open remounts by key as it opens, or unmounts on
  `onClosed`.
- A sheet that leads to a second page swaps its own body and passes
  `onBack`, never opens a second sheet.

## Forms

- An action in a group is a button in a row that names what it acts on
  (`ButtonRow`), never a row of action-colored text.

## Motion

- One spring and one ease, from `web/src/theme/motion.ts` and `shape.css`.
- No entrance animation on load.

## Keyboard

- Single-key shortcuts only on pointer frames. A focused control or row
  keeps Space.
- Never take a combination the browser owns (Cmd-N, Cmd-R).
- Tab crosses panes in DOM order.

## Accessibility

- The focus ring comes from `web/src/ui/focus.css` only. A screen never
  draws its own.
- Headings never skip a level. A page's title is h1, a sheet's or section's
  h2. A heading under one takes `useSubheadingLevel` from
  `web/src/ui/headingLevel.ts`.
- Forced colors: a glyph whose meaning is a fill paints in system colors.

## Framework limits

Browser and library behavior that a new screen runs into.

- A role that mixes another (a tint, a hover) is computed where it is
  declared. A scope that redeclares the base redeclares the mix too, or
  the mix keeps the root's value.
- Inside `bg-surface`, `--field` becomes `--surface-raised`, so a
  `bg-field` fill there is lighter than the card in light mode.
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
- MapKit JS answers a search through a callback, not the promise its
  online documentation shows. Check a MapKit call against the shipped
  version.
