## v1.2.0 (2026-10-27)

### Feat

- **apple**: move a Mac list's Play and Shuffle under its name
- **tune**: offer Play whenever any recording or link can play (#240)
- **web**: keep action buttons at natural width with a pointer
- **tune**: redesign the attributes column on web and Apple (#239)
- **design**: replace color tokens with a shared role system (#236)
- **site**: rewrite the home page's problem and feature copy
- **lists**: make the list page's play button pause and resume (#232)
- **welcome**: explain why an account is needed before sign-up (#231)
- **apple**: color the status filter menu's glyphs as the rows do

### Fix

- **apple**: report only app hangs that fully block the main thread
- **tune**: open the lyrics reader from the Lyrics button (#230)
- **web**: match the Apple app's colors
- **web**: meet the design rules for contrast, focus, type, and speed (#228)
- **apple**: close text size, contrast, and VoiceOver gaps
- **apple**: correct sheet sizing, dates, scan paging, and locale

### Refactor

- **apple**: clean up module layering and platform values (#238)
- **apple**: extract styles and controls into a design module (#237)
- replace take and the last coined names with standard terms (#235)
- replace coined logic names with standard terms (#234)
- replace metaphor names with standard terms (#233)
- **apple**: replace soft-deprecated SwiftUI and URL calls

### Perf

- **apple**: cut per-redraw work in lists, rows, tuner, and forms
- **apple**: compare shell actions by the host that supplied them

## v1.1.1 (2026-10-25)

### Fix

- **apple**: stop waveform bars merging into darker blocks (#226)
- **apple**: keep a glyphless link row at its own height
- **tune**: keep the empty key tile's label on one line

## v1.1.0 (2026-10-24)

### Feat

- **tune**: rebuild the tune page around in-place facts (#224)
- **shell**: rebuild the phone top bar and filter sheet (#223)
- **apple**: support iPhone Duo (#222)
- **tuner**: add a chromatic tuner to every platform (#220)
- **design**: bring the new color palette to iPhone, iPad, and web (#218)
- **apple**: redesign the Mac app on its own design system (#217)
- **recordings**: add saved locations and street-address names (#216)
- **recordings**: polish location capture and editing (#215)

### Fix

- **web**: refit the verb row once the page's fonts load
- **practice**: stop the waveform shimmering as it scrolls (#219)
- **web**: raise danger and warning text contrast

## v1.0.0 (2026-10-19)

### Feat

- turn off Apple builds below a minimum supported version (#212)
- **apple**: report crashes, freezes, and errors to Sentry (#211)
- **apple**: ask for an App Store review once a device has earned it (#210)
- **apple**: capture and frame the App Store screenshots and preview (#208)

### Fix

- **export**: keep spreadsheets from reading CSV cells as dates (#209)

## v0.24.0 (2026-10-18)

### Feat

- add notes, players, and place to recordings (#207)
- ship the launch privacy, billing, and legal changes (#203)

### Perf

- **apple**: speed up the package tests and their CI runs (#206)
- **api**: run the test suite on a memory-backed Postgres (#204)

## v0.23.0 (2026-10-17)

### Feat

- **auth**: revoke Sign in with Apple on web account deletion (#202)

### Refactor

- **web**: keep the catalog title fixed as Catalog (#201)

## v0.22.0 (2026-10-16)

### Feat

- **auth**: revoke Sign in with Apple on account deletion (#199)

### Fix

- **apple**: name the export zip so the Mac save panel can write it (#200)

## v0.21.0 (2026-10-15)

### Feat

- **site**: replace the waitlist with account creation (#198)
- **auth**: replace the waitlist with account creation in the apps (#197)
- **billing**: make scans Premium-only and round plan storage sizes (#196)
- **billing**: sync every store still billing an account
- **billing**: sell Premium from a Plan sheet and the trial notices (#188)
- **api**: clear inactive accounts' files after two email warnings (#187)
- **apple**: use native controls on the paywall and plan notices (#186)
- **apple**: sell Premium through in-app purchase (#183)
- **web**: redesign sheet and settings actions (#182)
- **billing**: sell Premium on the web through RevenueCat (#179)
- **api**: add the testdata command (#178)
- **web**: gate recordings and scans by plan (#176)
- **apple**: gate playback, scans, and additions by plan (#175)
- **billing**: add the trial-end notice flag (#174)

### Fix

- **api**: sign each upload slot to its own key, count kept originals
- **apple**: let the Mac app save exports where the user chooses
- **site**: describe what a Free account keeps
- **api**: delete a pending comp only with an explicit flag
- **web**: show borders on the sign-in form fields
- **billing**: cancel the subscriptions RevenueCat reports on deletion (#181)
- **billing**: cancel the Stripe subscription behind an item ID (#180)

### Refactor

- **web**: clean up dead code and duplication (#195)
- **apple**: remove dead code and add a dead-code check (#194)
- **tooling**: simplify the justfiles and dev scripts (#193)
- **api**: remove dead code and share repeated client logic (#192)
- **site**: clean up dead code and duplication, add a knip gate (#191)

## v0.20.0 (2026-10-10)

### Feat

- **billing**: add server-side entitlements and plan limits (#173)
- **web**: add motion across lists, menus, selection, and the player (#172)
- **web**: redesign buttons and form controls (#170)
- **site**: redesign the home page around drawn app demos (#169)
- **lists**: play a list from its row on the lists screen (#168)
- **tune**: add section empty states and inline lyrics field (#167)
- **import**: import tune lists in bulk (#166)
- **settings**: show help above settings and make status a picker (#165)

### Fix

- **web**: keep the dev app loading when a content blocker is on (#164)

## v0.19.0 (2026-10-09)

### Feat

- **analytics**: add product analytics to the web app (#162)
- **settings**: improve tune defaults (#161)
- **web**: align the web navigation with the Apple apps (#158)
- **web**: replace the web client with its own design system (#154)
- **analytics**: add a tracking plan and report usage against it (#152)

### Fix

- **tooling**: harden dev recipes, the smoke check, and build pinning (#159)
- **web**: hide the catalog filter row when there is nothing to filter
- **apple**: correct stand, reading, setting, and embed analytics (#153)

### Refactor

- **web**: consolidate shared helpers, layers, and live queries (#157)

## v0.18.0 (2026-10-07)

### Feat

- **analytics**: add PostHog product analytics (#151)

## v0.17.0 (2026-10-07)

### Feat

- **seo**: hide the app from search and add plans and FAQ to schema (#149)
- **apple**: rework the catalog and recordings filter rows (#148)

### Refactor

- **apple**: clean up post-redesign performance and security (#147)

### Perf

- **apple**: cut redraws, search, and sync work across the client (#150)

## v0.16.0 (2026-10-06)

### Feat

- **apple**: give the iPad its own design (#146)
- **apple**: open the Mac practice view in the detail column (#145)

## v0.15.0 (2026-10-05)

### Feat

- **apple**: redesign the iPhone app around native iOS patterns (#144)
- **site**: redesign the public facing web site (#143)

### Fix

- **api**: stop skipped sync rows, endless job retries, and sign-outs (#140)

## v0.14.0 (2026-10-05)

### Feat

- **apple**: give the Mac app its own native design (#136)
- **catalog**: sort lists from a header above them (#135)
- **catalog**: filter and suggest tunes by composer and learned from (#134)
- **catalog**: sort tunes by title, date added, modified, or played (#133)

## v0.13.0 (2026-10-04)

### Feat

- add a stats page and history, and call notation scans (#132)
- **recordings**: add new highest quality audio (#130)
- **recordings**: sort, filter, and date the recordings screen (#128)
- **dev**: isolate each worktree's database, bucket, and test runs (#129)
- **notation**: attach images of written music to tunes (#127)
- **links**: play, search, and save Slippery-Hill recordings (#126)
- **recordings**: add audio files by dropping them on the list (#125)

### Fix

- **apple**: move list play controls with a pull past the top (#124)

## v0.12.0 (2026-10-03)

### Feat

- **apple**: play a list as a playlist with repeat and shuffle (#123)
- **lists**: play each tune from its list row and pin its version (#122)
- **apple**: keep mac controls over the pane they act on (#121)
- **apple**: play, pause, and skip from the keyboard (#119)

### Fix

- **apple**: open the next tune after going back to a list (#120)
- **apple**: stop the mac app crashing when recording starts (#118)

## v0.11.0 (2026-10-03)

### Feat

- **apple**: play Apple Music links in full for subscribers (#117)
- **search**: find and link recordings from music services (#116)
- **recordings**: rename from the row, open practice from the player (#115)
- **practice**: make practice the recording screen (#113)
- **settings**: export tunes, lists, and recordings as one zip (#111)
- **web**: block scripts and frames from unlisted origins (#108)

### Fix

- **practice**: keep auto-pan going when a frame renders late (#112)
- **api**: fail fast when object storage stops responding (#110)
- **api**: keep a hostile recording from taking down the API (#109)
- **apple**: remove nonobvious status on tune screen
- **apple**: show the record button as soon as a sheet closes (#107)
- **api**: stop job file leaks and cut job memory and sync work (#102)
- **web**: report dropped and stalled API calls as offline (#101)
- **links**: drop the label from recording links (#99)
- **apple**: make the record dome a red dot on glass like the web
- **apple**: keep the catalog filter bar at the default text size
- **apple**: stop filter rails moving up and down while scrolling

### Perf

- **web**: halve the browser test suite's wall time (#105)
- **web**: cut idle re-renders and blob reads (#104)

## v0.10.0 (2026-10-01)

### Feat

- add a Practice view with repeating loops (#90)
- **site**: show a thanks page after joining the waitlist (#89)
- **site**: rebuild the home page around hands-on demos (#88)
- **apple**: add an in-app text size and scale the UI with it (#87)
- **apple**: put the catalog filter button in the iOS search field

### Fix

- **apple**: fix the app icon

## v0.9.0 (2026-09-30)

### Feat

- add the crosstune.app site and a signed-out welcome (#80)
- **catalog**: filter the tune list for tunes with no key (#79)
- record in stereo on Apple devices (#72)

### Fix

- **apple**: keep the record button in the tab bar when typing
- tidy recording rows, the lyrics view, and delete-account copy (#73)
- keep unsent edits and recordings across local database upgrades (#71)

## v0.8.0 (2026-09-28)

### Feat

- trim recordings and play them at any speed and pitch (#69)
- delete user accounts (#68)
- **apple**: add the native app for iPhone, iPad, and Mac (#57)
- **apple**: keep each user's catalog on the device (#56)
- **apple**: sign in to the Apple app with Clerk (#55)

### Perf

- let the API and database sleep when idle (#70)

## v0.7.0 (2026-09-25)

### Feat

- call songs tunes and add types, part modes, and tunings (#53)
- **api**: add tune type, part modes, composer, and 3/2 time (#52)
- **api**: store tune tunings per instrument for seven instruments (#51)

## v0.6.1 (2026-09-24)

### Fix

- **api**: refuse recording links with a non-web URL scheme
- **sync**: keep a write made in the same millisecond as the last
- **api**: harden uploads, request bodies, and link handling (#48)

### Refactor

- **api**: rename songs to tunes in the schema and sync API (#50)
- **config**: drop the guard against retired environment names

## v0.6.0 (2026-09-23)

### Feat

- **storage**: give each environment its own storage (#46)
- **api**: rate limit the link resolve route per user

### Fix

- **api**: free the database connection before resolving a link
- **api**: cap the JSON a link resolver reads from a provider
- **web**: keep the chip rail's end fade in step with its chips
- **web**: paint the recording Stop button in the record red
- **web**: stop re-taking a wake lock the browser keeps releasing

### Refactor

- **config**: rename environment variables (#47)

### Perf

- **api**: read an upserted row back from the push write itself
- **api**: drop indexes that the sync indexes already cover

## v0.5.0 (2026-09-22)

### Feat

- **web**: enlarge the phone record button and color it red (#44)
- **web**: remove the first-run instruments prompt (#43)
- **song**: accept modal, suggest High Bass, keep violin and banjo (#42)
- **lyrics**: store a song's words and read them full screen (#39)

### Fix

- **web**: keep place after a recording and sync as soon as Clerk loads (#41)
- **api**: survive bad links, bad keys, and partial deletes in sync (#40)

## v0.4.1 (2026-09-20)

### Fix

- **web**: keep the status filters on one line on a phone (#38)

## v0.4.0 (2026-09-20)

### Feat

- **web**: pick every setting from a row (#37)
- **web**: give every screen one background and one hierarchy (#33)
- **web**: rebuild every form (#32)
- **web**: color every musical key and move the filters control (#31)

### Fix

- **api**: refuse outbound requests to non-public addresses (#36)
- **preview**: keep long branches from sharing one preview alias (#35)

## v0.3.0 (2026-09-19)

### Feat

- **web**: delete selected songs and steady every row action (#30)
- **web**: rebuild the client on ionic react (#29)

## v0.2.1 (2026-09-16)

### Fix

- **release**: regenerate the OpenAPI contract in the bump commit

## v0.2.0 (2026-09-16)

### Feat

- **web**: first-run instruments, upload failures, and shared pickers (#26)
- **web**: rebuild the catalog filters, song form, and song page (#25)
- **web**: add the CT mark as app icon, favicon, and sign-in lockup (#24)
- **web**: add glyphs and a raised record button to the bottom nav (#22)
- **web**: apply the visual design with theme and text size settings (#21)
- **web**: group recordings by song and simplify the recording flow (#20)
- **web**: record, upload, and play back audio takes (#16)
- **api**: upload, transcode, and serve audio recordings (#15)
- **web**: select many songs and change them at once (#14)
- **lists**: share catalog song rows and drag songs to reorder (#11)
- **web**: show two-row song and list rows with swipe actions (#9)
- **player**: play streaming recordings in an app-wide docked player (#8)
- **catalog**: offer to add a song from the catalog search (#6)
- **hosting**: move the web client to a Worker with per-PR previews (#4)
- split song tuning per instrument and add an instruments setting (#3)
- **web**: add cloudflare pages header rules for caching
- **web**: tag sentry events with the environment
- **api**: accept neon urls, preview origins, and a sentry environment
- **web**: install as a pwa with an app-shell service worker
- **web**: add ordered lists with add, remove, reorder, and rename
- **web**: add song create, detail, link paste, and playback
- **web**: add the catalog screen with search and persisted filters
- **web**: add clerk sign-in, routes, layout, and settings
- **web**: add the sync engine with push, pull, and backoff
- **web**: add the local database, outbox, and write commands
- **web**: generate the typed api client from the openapi contract
- **api**: wire the app, logging, container image, ci, and contract
- **api**: resolve streaming link metadata on paste and on push
- **api**: add sync push and pull with last-write-wins
- **api**: add clerk auth, user provisioning, and the deletion webhook
- **api**: add row schemas and the sync table registry
- **api**: add the database layer, models, and migrations

### Fix

- **web**: upload recordings from the iOS home-screen app (#27)
- **api**: keep uploaded originals in R2 Standard storage (#23)
- **web**: explain the recordings download setting in plain words (#19)
- **web**: upload recordings from Safari (#18)
- **catalog**: offer to add a song whose title already exists (#13)
- **web**: keep catalog search only while the app is open (#10)
- **sync**: derive the per-user push lock from the id's random bytes (#7)
- **ci**: tear down previews from the PR head and allow a manual run (#5)
