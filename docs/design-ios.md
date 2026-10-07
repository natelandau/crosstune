# Crosstune iOS design rules

Rules every iPhone screen and every compact iPad window follows, beside the
rules in `design.md`. Where the two pages disagree, this page holds on the
iPhone and in a compact iPad window. An iPad at regular width takes this
page, then `design-ipad.md`, which holds where the two disagree. The Mac
never takes a rule from this page. A view built only for iPhone lives in
`apple/CrosstuneKit/Sources/CrosstuneUI/Phone/`.

## Tokens

Three token sets hold every color and size. A view never types a color
value, a text size, or a row height of its own.

| Token set    | Holds                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `BrandStyle` | The colors every platform shares: slate, coral, the label on slate, the set-filter wash and label                                  |
| `PageStyle`  | What a shared view draws with, resolved per platform: text styles, touch sizes, and drawing choices                                |
| `PhoneStyle` | Values only iPhone and iPad draw with: the practice ground, waveform colors, control and touch sizes, gesture and highlight timing |

- A size, a font, or a drawing choice that differs by platform is a
  `PageStyle` value, never an `#if os` branch in a shared view's body.
- Beside the mark, coral marks only the practice playhead and every loop
  handle, whatever the loop's color.
- Status, key, loop, recording, and sync badge colors are the same as on
  every platform.
- Type is SF Pro text styles under Dynamic Type. A row title is regular
  weight. A page's title is large title bold, and its section headings
  are title 3 semibold.
- Glass is for controls only, never for content or behind a text field.

## Placement

Each kind of control has one zone, so the job of a control tells the
musician where it is.

| Zone             | Holds                                                                                                                                                    | Never holds                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Title            | What the screen shows. A top-level title can be a menu that changes the scope                                                                            | Actions                     |
| Top-trailing bar | The screen's verbs: its main verb first (Add, or Edit on a page about one thing), then, when the screen has more verbs, one More menu. At most two items | Filters, sort, view options |
| Under the title  | How to narrow: the search field, then one filter row                                                                                                     | Verbs                       |
| List header      | The count leading and the sort trailing, directly above the rows it sorts                                                                                | Anything else               |
| Bottom           | App-wide controls only: the tab bar, Record, the now-playing accessory, the selection toolbar                                                            | A screen's own actions      |

- A section's verb sits on that section's own heading, at the trailing
  edge.
- More is an explicit `Menu`. Loose overflow items lose a destructive
  item's separator and red role.
- Select is an item in More and in a row's context menu, never a toolbar
  button.

## Shell

- The tab bar holds Catalog, Lists, Recordings, and Settings, and never
  minimizes, so Record is always one tap away.
- Record is the bar's separated trailing slot: `TabRole.prominent` on iOS
  27, `.search` on iOS 26. The bar redraws a template glyph in its own
  colors, so the dot is drawn recording red in its original rendering.
- Choosing Record opens the record sheet and keeps the current tab.
  Recording is an action, so the slot never stays selected.
- A top-level title is large and shares a row with its toolbar buttons.
  A title that is a menu is inline and centered, because iOS shows a title
  menu only on an inline title.

## Rows

- A tune row is one line: status glyph, title, then the compact key pill
  at the trailing edge, so keys form a column. A second line in secondary
  shows only non-standard tunings, capos, and "Archived".
- At accessibility text sizes the key pill moves under the title, so
  nothing clips.
- A row has no separator.
- Status is a glyph whose shape carries the meaning: Known a filled check,
  Learning a half-filled circle, Unknown an empty ring, each in its status
  color. Its word is its accessible name.
- A list row leads with its position. The row a playing list is on shows
  an animated speaker and a light slate wash.

## Catalog

- The sync badge leads the catalog's bar, so the trailing edge keeps only
  Add and More. While selecting, Select All takes that edge and the badge
  stands aside.
- Search is the system search field, always shown under the title.
- The filter row is the list's first row and scrolls with it: Status, Key,
  Filters with its count, then each set sheet filter as a token that
  removes it. Status and key drive the list, so they get capsules, and
  every other filter is in the sheet. The row fits one line on a phone at
  the default text size, so it holds no more capsules.
- The Status menu is Any, then each status, with the count of non-archived
  tunes beside each. It writes the stored status filter that stats links
  and the sidebars write.
- The key popover stays a popover on a compact width.
- Status and key always show on the row, so the Filters count never
  includes them.
- At accessibility text sizes the controls wrap instead of clipping, and a
  token's label wraps instead of truncating.

## Tune page

- A tune reads as a document on the plain background: headings over their
  content, no inset grouped cards. A form edits it in a sheet.
- A section heading's control is a plain tinted glyph or word in a 44pt
  frame, with no glass. A menu draws glass at its label's full frame, so
  glass cannot stay smaller than the frame that takes the taps.
- An empty section shows only its heading and its add control.
- A row on a page takes a context menu, never swipe actions, because a
  page is not a list. Items on a page reorder through a move menu.

## Lists

- A list's name is its title. Play, a prominent slate capsule, and
  Shuffle, a glass capsule, are the list's first row, over the line that
  says what will play.
- A list reorders by a long press and drag on the whole row, with no grip.
  Move stays in the context menu, the swipe actions, and the accessibility
  actions.

## Recordings

- Groups take plain headings, never cards.
- Search is the system search field. The Filters capsule and its set
  tokens are the list's first row, as on the catalog, while there is a
  source to choose.
- A section header has no top padding. The space between sections sets
  the groups apart, so the first header sits right under the search field.

## Forms and sheets

- A form keeps the native inset grouped style, because a form is where an
  iOS reader expects cards. A screen that only reads is a document page.

## Settings

- Settings is a root of categories, led by the account's identity and
  sync state. Each category is its own pushed page. A new setting joins
  the page of its category, never the root.
- A category row is a slate SF Symbol, the name, and a value summary where
  one exists. No colored tiles.
- A set answered once, such as instruments or music services, is chosen
  in place on its category's page, not in a sheet behind a row.
- A page clears its failure footers when it opens, so an old failure never
  reads as new.
- Every label inside a page matches the Mac's Settings window. Only the
  grouping differs.

## Stats

- A grid too wide for the column, such as the key grid, scrolls sideways.

## Player and practice

- The now-playing accessory shows in the tab bar only while something is
  loaded. Play and pause lead, Close trails, and speed and pitch show only
  when either is away from its default.
- While a list plays, a sideways swipe on the accessory skips to the next
  or previous tune. A mostly vertical drag does not skip.
- A tap on the accessory opens the practice screen, a full-screen cover
  that zooms out of the accessory and closes back into it.
- The practice screen stands on the jet practice ground in every
  appearance, and draws everything on it in the dark scheme.
- The practice playhead stays fixed and the wave moves under it. Loop
  regions take their loop colors.
- Trim stands on the same ground with white handles, so editing reads
  apart from practice.
- A swipe down or the chevron closes the practice screen, under Reduce
  Motion too.
- The transport keeps its size at every text size.
- A practice value, such as a speed preset or a loop action, keeps its
  label on one line at every text size. A row of them wraps rather than
  squeeze a capsule.

## Recording

- The record sheet's status dot pulses while it records.
- Started from a tune page, the sheet names the tune that the take files
  under.
- A new take's row takes the slate wash for 1.5 seconds once the row
  shows. A take that no row shows within 5 seconds gets no highlight.

## Motion

- Motion shows where a thing came from and where it went, never
  decoration.
- A presentation opened from a visible item zooms out of that item and
  back into it: a tune from its row, a reader from its row or thumbnail,
  the practice screen from the accessory.
- A tab item cannot be a zoom source, so the record sheet opens as a
  standard sheet.
- A filter control fills, a token slides in, and a count rolls its digits.
  A loop handle settles into a snap with a spring.
- iPhone motion goes through one gate, `phoneAnimation` and
  `phoneTransition`, which read `PageStyle.animatesPhoneMotion`. The Mac
  gets none of it.
- Under Reduce Motion a zoom gives way to the plain presentation.

## Haptics

- The app makes a light impact in two moments only: a waveform handle
  snaps into place, or the accessory skips a tune.
- Every other haptic is the system's own, on a system control.
  `HapticsPolicyTests` fails on a haptic anywhere else.

## Accessibility

- Slate passes 4.5:1 on the window in both appearances. Silver, white,
  and coral pass their roles on the practice ground. Tests check each.
- Text follows Dynamic Type, and spacing scales with it. A control that
  runs out of room wraps, never clips.
- A Text size stepper in Settings shifts the text in whole Dynamic Type
  steps from the system's size. It reads "System", or body text's size as
  a percentage of the system's.
- System alerts and confirmation dialogs follow the system's size.
