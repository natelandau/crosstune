# Crosstune iOS design rules

iPhone and compact iPad windows. Read `design.md` first. This page wins
there where they differ. Regular-width iPad reads this page, then
`design-ipad.md`. The Mac never takes a rule from here.

- Apple's Human Interface Guidelines: native SwiftUI controls, SF Symbols,
  system materials and fonts, Dynamic Type.
- iPhone-only views: `apple/CrosstuneKit/Sources/CrosstuneUI/Phone/`.

## Tokens

| Token set    | Holds                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| `Palette`    | Harbor and paper colors every Apple platform shares                                       |
| `BrandStyle` | Coral, its ink, and the washes, read from `Palette`                                       |
| `PageStyle`  | What a shared view draws with, resolved per platform: text styles, sizes, drawing choices |
| `PhoneStyle` | Practice ground, tuner colors (Mac too); iPhone and iPad waveform, touch sizes, timing    |

- A view never types a color, text size, or row height.
- A value that differs by platform is a `PageStyle` value, never an
  `#if os` branch in a shared view's body.
- A list or vertical scroll root draws `paperGround()`, never the system's
  white or black. System bars, the tab bar, and the iPad sidebar keep
  their system materials.
- A grouped form is a `PaperForm`, never a raw grouped `Form` or a system
  grouped fill. Light draws a `surface` page with `ground` cards, dark the
  reverse, so a card always stands off the page. A test enforces both.
- A switch outside a `PaperForm`, which sets it, takes
  `.toggleStyle(.harborSwitch)`.
- A chip with no color of its own fills with `.neutralFill`, which reads
  its container. `PaperForm` marks its cards, and a sheet's root clears
  the mark.
- SF Pro text styles under Dynamic Type. Page title: large title bold.
  Section heading: title 3 semibold. Row title: regular.
- Glass for controls only. Never content, never behind a text field.
- Touch density always.

## Shell

- The tab bar never minimizes, so Record stays one tap away.
- Record is the bar's separated trailing slot, and never stays selected.
- The account button is `AccountToolbarItem`, the last item in each root
  screen's toolbar, so it is outermost trailing. About 32pt in a 44pt
  target, no glass, masked because it shows the user's name.
- Filters is an icon-only toolbar item, its glyph filled once any filter
  is set.
- A control that cannot sit in a navigation subtitle goes in the toolbar,
  named for its action.
- System undo (shake or Cmd-Z) plus a short banner with Undo replaces the
  toast.

## Rows and lists

- Accessibility text sizes: the key pill moves under the title, controls
  wrap instead of clipping, and token labels wrap instead of truncating.
- A row on a page takes a context menu, not swipe actions, and reorders
  through a move menu.
- List reorder: long press and drag.
- Search: the system search field, pinned under the title. Escape follows
  the system field, not the empty-first order in `design.md`.
- The filter row is the list's first row and scrolls with it.
- A row on the paper ground clears its row background
  (`unselectedRowGround`). A selected row keeps the system fill.
- Grouped lists take plain headings, never cards. A section header has no
  top padding; the space between sections separates groups.

## Pages and forms

- A verb row is `VerbRow`: the main verb an accent-filled capsule, the
  others glass capsules, in equal shares.
- A form keeps the native inset grouped style. A screen that only reads is
  a document page.
- Open vocabulary: matching suggestions show as rows under the field while
  it has focus, at most six. A pick ends editing.
- Settings category row: SF Symbol in secondary ink, name, value summary
  where one exists. No colored tiles.
- A page clears its failure footers on open, so an old failure never reads
  as new.

## Sheets

- A sheet's actions pin to its bottom edge: a full-width prominent primary
  over centered borderless secondaries.
- Close is the system close button, the glass xmark.
- A compact width or a compact height takes a sheet where a regular window
  takes a popover, so an iPhone in landscape does too.

## Player and recording

- Transport keeps its size at every text size. A practice value keeps its
  label on one line. A row of them wraps rather than squeezing a capsule.
- A Stop that cannot run dims as a whole disc, never only its label.

## Motion

- A presentation opened from a visible item zooms out of it and back.
- One gate, `phoneAnimation` and `phoneTransition`, reading
  `PageStyle.animatesPhoneMotion`. The Mac gets none of it.
- Reduce Motion: a zoom becomes the plain presentation.

## Haptics

- Light impact in two moments only: a waveform handle snaps, or the
  player skips a tune.
- Every other haptic is the system's own. `HapticsPolicyTests` fails on
  any other.

## Accessibility

- Contrast also holds for silver, white, and coral on the practice ground.
- Spacing scales with Dynamic Type. A control out of room wraps, never
  clips.
- System alerts and confirmation dialogs follow the system size.

## Framework limits

SwiftUI and UIKit behavior that a new screen runs into.

- Window or scene root carries `.tint(Palette.accent)`. UIKit-drawn
  pieces (list selection, focus rings, default buttons, alerts, menus)
  ignore tint and take the `AccentColor` asset, which carries Harbor.
- An accent-filled button takes `.accentProminent` or
  `.accentGlassProminent`, never a system prominent style, which fills
  with the tint instead of `accentFill`.
- The system fills a confirm toolbar button and a focused list selection
  with the tint behind white, and the dark accent leaves white under
  4.5:1. So a confirm item is a `ConfirmToolbarItem`, and a list that
  takes a selection carries `.listSelectionTint()`. A test enforces both.
- More is an explicit `Menu`. Loose overflow items lose a destructive
  item's separator and red role.
- SwiftUI runs swipe actions only on a `List`'s rows. Rows that swipe
  inside a page's scroll view sit in `SwipeRows`, a `List` that never
  scrolls and takes its rows' height.
- A system picker shows the chosen value inline, so its options carry no
  counts, which would read as part of the value.
- Section heading control: plain tinted glyph or word in a 44pt frame, no
  glass. A menu draws glass at its label's full frame, so glass cannot
  stay smaller than its tap frame.
- A system segment shows an image or a word, never both.
- A tab item cannot be a zoom source, so a sheet opened from the tab bar
  is a standard sheet.
