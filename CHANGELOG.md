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
