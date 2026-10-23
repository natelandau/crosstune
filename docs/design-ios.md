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
- Window or scene root carries `.tint(Palette.accent)`. UIKit-drawn
  pieces (list selection, focus rings, default buttons, alerts, menus)
  ignore tint and take the `AccentColor` asset, which carries Harbor.
- A list or vertical scroll root draws `paperGround()`, never the system's
  white or black. System bars, the tab bar, and the iPad sidebar keep
  their system materials.
- A grouped form is a `PaperForm`, never a raw grouped `Form` or a system
  grouped fill: page `groupedPage`, cards `groupedCard`. Light draws a
  `surface` page with `ground` cards, dark the reverse, so a card always
  stands off the page. A test enforces both.
- An accent-filled button takes `.accentProminent` or
  `.accentGlassProminent`, never a system prominent style, which fills
  with the tint instead of `accentFill`.
- The system fills a confirm toolbar button and a focused list selection
  with the tint behind white, and the dark accent leaves white under
  4.5:1. So a confirm item is a `ConfirmToolbarItem`, which draws
  `.accentGlassProminent`, and a list that takes a selection takes its own
  tint (below). A test enforces both.
- A switch outside a `PaperForm`, which sets it, takes
  `.toggleStyle(.harborSwitch)`.
- A chip with no color of its own fills with `.neutralFill`, which reads
  its container. `PaperForm` marks its cards, and a sheet's root
  clears the mark.
- A list that takes a selection carries `.listSelectionTint()`, not the
  accent fill: the edit-mode checkmarks take the tint too and must hold
  3:1 on the ground.
- SF Pro text styles under Dynamic Type. Page title: large title bold.
  Section heading: title 3 semibold. Row title: regular.
- Glass for controls only. Never content, never behind a text field.
- Touch density always.

## Shell

- Tab bar never minimizes, so Record stays one tap away.
- Record is the bar's separated trailing slot: `TabRole.prominent` on iOS
  27, `.search` on iOS 26. The bar redraws template glyphs in its own
  colors, so the dot uses original rendering to stay recording red.
- Record opens the record sheet and keeps the current tab. The slot never
  stays selected.
- Top-level title: large, sharing a row with the toolbar buttons, which
  stay pinned as it shrinks.
- The account button is `AccountToolbarItem`, the last item in each root
  screen's toolbar, so it is outermost trailing with the verbs' glass
  group inboard of it. A set-wash disc with initials or `person.fill`,
  about 32pt in a 44pt target, no glass, masked because it shows the
  user's name. Hidden while selecting.
- Filters is an icon-only toolbar item, filled glyph once any filter is
  set. On Catalog it sits between Add and More, on Recordings after
  Upload. It shows only when the list has something to filter or a filter
  is set, and not while selecting (Catalog: `showsBarFilters`).
- A pushed list follows the tune page: the name is the page's heading,
  and `barTitle` shows it small in the bar once the heading is under it.
  While selecting the heading stays in place, invisible, so it keeps
  reporting its position, and the bar shows the selection count.
- Settings has no tab here, so the tab bar holds Catalog, Lists, Tuner,
  Recordings, then Record.
- A control that cannot sit in a navigation subtitle goes in the toolbar,
  named for its action.
- More is an explicit `Menu`. Loose overflow items lose a destructive
  item's separator and red role.
- System undo (shake or Cmd-Z) plus a short banner with Undo replaces the
  toast.
- Sync badge leads the catalog's bar. While selecting, Select All takes the
  trailing edge and the badge stands aside.
- Pull to refresh runs a sync.

## Rows

- Tune row is one line, plus a second secondary line for non-standard
  tunings, capos, and "Archived" only.
- Accessibility text sizes: the key pill moves under the title.
- A row on a page takes a context menu, never swipe actions. Page items
  reorder through a move menu.
- List reorder: long press and drag.

## Lists and filters

- Search: system search field, always shown under the title, pinned. Escape
  follows the system field, not the empty-first order in `design.md`.
- The filter row is the list's first row and scrolls with it. Catalog: Status,
  Key, then set sheet filters as tokens. Recordings: the set source as a
  token, and no row while none is set. The row holds no Filters control,
  since the bar's Filters item opens the sheet.
- A row on the paper ground clears its row background, so the ground shows
  through (`unselectedRowGround`). A selected row keeps the system fill.
  The Mac keeps the system row background.
- Status menu: Any, then each status with its non-archived count.
- The filter sheet's Status picker names each status with no count: a
  system picker shows the chosen value inline, where a number reads as part
  of the value. The Mac pop-up shares the picker and drops the count too.
- The key popover stays a popover at compact width.
- Accessibility text sizes: controls wrap instead of clipping, token labels
  wrap instead of truncating.
- Grouped lists take plain headings, never cards. A section header has no
  top padding; the space between sections separates groups.

## Pages

- Section heading control: plain tinted glyph or word in a 44pt frame, no
  glass. A menu draws glass at its label's full frame, so glass cannot stay
  smaller than its tap frame.
- A grid too wide for the column (stats key grid) scrolls sideways.
- Play is an accent-filled capsule, Shuffle a glass capsule.

## Forms and Settings

- A form keeps the native inset grouped style, because iOS readers expect
  cards in a form. A screen that only reads is a document page.
- Short closed choice can be segmented. Status is one, a segment per word.
  A system segment shows an image or a word, never both. Tunes disagree:
  no segment chosen.
- Open vocabulary: matching suggestions show as rows under the field
  while it has focus, at most six, since SwiftUI offers no suggestion list
  on iOS. A pick ends editing.
- Settings: root led by account identity and sync state. Each category is
  a pushed page.
- On iPhone and compact iPad, Settings is a sheet opened from the account
  button. It reopens where it was left, because the path is kept.
- A link to a Settings group (the first-recording notice's See your
  plan) opens Settings on the group's page over the root, so Back returns
  to the root. On a tab-based layout it switches to the Settings tab.
- Category row: SF Symbol in secondary ink, name, value summary where one
  exists. No colored tiles.
- A page clears its failure footers on open, so an old failure never reads
  as new.

## Sheets

- A sheet's actions pin to its bottom edge: a full-width prominent
  primary over centered borderless secondaries.
- Close is the system close button, the glass xmark.
- The Plan sheet pins nothing: its period choice, Subscribe, and
  disclosures close its scrolling page, so the comparison is never
  covered.

## Player and practice

- The now-playing accessory shows in the tab bar only while something is
  loaded. Play and pause lead, Close trails. Speed and pitch show only off
  their defaults.
- While a list plays, a sideways swipe on the accessory skips. A mostly
  vertical drag does not.
- Tap the accessory: practice, a full-screen cover that zooms out of the
  accessory and back into it.
- Swipe down or the chevron closes practice, under Reduce Motion too.
- Transport keeps its size at every text size. A practice value (speed
  preset, loop action) keeps its label on one line. A row of them wraps
  rather than squeezing a capsule.

## Recording

- The record sheet's status dot pulses while recording.
- A Stop that cannot run dims as a whole disc, never only its label.
- Started from a tune page, the sheet names the tune the take files under.
- A new take's row takes the set filter's accent wash for 1.5 seconds
  once shown. Not shown within 5 seconds: no highlight.

## Motion

- A presentation opened from a visible item zooms out of it and back: a
  tune from its row, a reader from its row or thumbnail, practice from the
  accessory.
- A tab item cannot be a zoom source, so the record sheet is a standard
  sheet.
- Filter control fills, a token slides in, a count rolls. A loop handle
  settles into a snap with a spring.
- One gate, `phoneAnimation` and `phoneTransition`, reading
  `PageStyle.animatesPhoneMotion`. The Mac gets none of it.
- Reduce Motion: a zoom becomes the plain presentation.

## Haptics

- Light impact in two moments only: a waveform handle snaps, or the
  accessory skips a tune.
- Every other haptic is the system's own. `HapticsPolicyTests` fails on
  any other.

## Accessibility

- Contrast also holds for silver, white, and coral on the practice ground.
- Spacing scales with Dynamic Type. A control out of room wraps, never
  clips.
- Settings Text size stepper shifts text in whole Dynamic Type steps from
  the system size. Reads "System", or body size as a percentage of the
  system's.
- System alerts and confirmation dialogs follow the system size.
