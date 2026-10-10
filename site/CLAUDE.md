# Site

The marketing site at crosstune.app. These rules bind the site only; the app's
design rules in `docs/design*.md` do not apply here, except that the app screens
the demos draw look like the app.

## Design

- Light only. No dark sections, no dark device frames.
- Each section shows one visual, never one per bullet.
- The large views show the web app in browser chrome. The Mac app appears only
  in the platforms section, inside its own hardware so it never reads as the
  iPad.
- Devices are drawn to scale. Each device is built at its native size and one
  scale applies to a whole composition (`src/demos/camera.ts`), so a phone and
  a browser beside it keep true text sizes. Crop a device at the panel edge
  rather than shrinking it.
- A device never paints through another: every device on a stage is its own
  layer, and phones sit in front of browsers.
- Scrolling stays native: no scroll-jacking, no snap, no pinned runways, no
  scroll-linked transforms. A demo plays only while it is in view.
- Coral is the brand color and may be used freely; the app's color rules do not
  bind the page.
- The app calls them scans, never notation. A test fails on "notation".
- Every waitlist form carries "Already have an account? Sign in", and Sign in
  stays in the nav at every width.

## Demos

- The demos in `src/demos/` are HTML drawings of the app, not captures. A
  redesigned app screen the site shows needs its demo redrawn.
- A demo's markup is a pure function rendered at build time, so the page and
  its first frames read without a script. Its script only animates.
- Each demo is one `role="img"` with an `aria-label` and `data-nosnippet`; the
  drawn screens inside are `aria-hidden`.
- Icons come from the `lucide` package's icon nodes, built into one sprite by
  `src/demos/sprite.ts`. The status bar's signal and battery are drawn device
  chrome, not icons.

## Build

- Fonts are subsets of the fontsource files, committed in `src/assets/fonts/`.
  A character outside `FONT_CHARS` (`src/styles/fontChars.ts`) fails a test:
  add it there and run `just site::fonts`.
- Clerk loads as its browser build from the instance's own host, pinned to the
  installed `@clerk/clerk-js` version, only when a visitor focuses a waitlist
  field. Local builds need `PUBLIC_CLERK_PUBLISHABLE_KEY` in `site/.env` to
  join the waitlist.
- `/llms.txt` is built from the same copy constants as the page. Add new copy
  as a constant so both stay in step.
- A change to the hero needs `just site::og` to redraw the link preview.
