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
| `BrandStyle` | Colors every platform shares                                                              |
| `PageStyle`  | What a shared view draws with, resolved per platform: text styles, sizes, drawing choices |
| `PhoneStyle` | iPhone and iPad only: practice ground, waveform colors, touch sizes, gesture timing       |

- A view never types a color, text size, or row height.
- A value that differs by platform is a `PageStyle` value, never an
  `#if os` branch in a shared view's body.
- Window or scene root carries `.tint(BrandStyle.accent)`. UIKit-drawn
  pieces (list selection, focus rings, default buttons, alerts, menus)
  ignore tint and take the `AccentColor` asset.
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
- Top-level title: large, sharing a row with toolbar buttons. A title menu
  is inline and centered, because iOS shows a title menu only on an inline
  title.
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

- Search: system search field, always shown under the title.
- The filter row is the list's first row and scrolls with it: Status, Key,
  Filters, then set sheet filters as tokens. It fits one line on a phone at
  the default text size, so it never gains another capsule.
- Status menu: Any, then each status with its non-archived count.
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
- Play is a prominent slate capsule, Shuffle a glass capsule.

## Forms and Settings

- A form keeps the native inset grouped style, because iOS readers expect
  cards in a form. A screen that only reads is a document page.
- Short closed choice can be segmented. Status is one, a segment per word.
  A system segment shows an image or a word, never both. Tunes disagree:
  no segment chosen.
- Settings: root led by account identity and sync state. Each category is
  a pushed page.
- Category row: slate SF Symbol, name, value summary where one exists. No
  colored tiles.
- A set answered once (instruments, music services) is chosen in place on
  its category's page, not in a sheet.
- A page clears its failure footers on open, so an old failure never reads
  as new.
- Labels match the Mac's Settings window. Only grouping differs.

## Player and practice

- The now-playing accessory shows in the tab bar only while something is
  loaded. Play and pause lead, Close trails. Speed and pitch show only off
  their defaults.
- While a list plays, a sideways swipe on the accessory skips. A mostly
  vertical drag does not.
- Tap the accessory: practice, a full-screen cover that zooms out of the
  accessory and back into it.
- Practice and trim: jet ground in every appearance, drawn in the dark
  scheme.
- Swipe down or the chevron closes practice, under Reduce Motion too.
- Transport keeps its size at every text size. A practice value (speed
  preset, loop action) keeps its label on one line. A row of them wraps
  rather than squeezing a capsule.

## Recording

- The record sheet's status dot pulses while recording.
- A Stop that cannot run dims as a whole disc, never only its label.
- Started from a tune page, the sheet names the tune the take files under.
- A new take's row takes the slate wash for 1.5 seconds once shown. Not
  shown within 5 seconds: no highlight.

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
