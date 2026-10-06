# Crosstune documentation

Each page answers one kind of question. Read the one that matches the task,
and put new knowledge only in the page whose contract it fits.

| Page                            | Read it when you                                                                        | It holds                                                                                                            | It never holds                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Product](product.md)           | need to know what Crosstune is, who it is for, or why a constraint exists               | What, why, who, the use cases, key features at a glance, constraints, the glossary                                  | Per-feature behavior, release plans                                                      |
| [Decisions](decisions.md)       | want to change the stack, a host, or a design approach                                  | The choice, the reason, and what was rejected                                                                       | Anything the code says, sequencing history                                               |
| [Architecture](architecture.md) | touch the API, the client's data layers, sync, sign-in, links, recordings, environments | Boundaries, sources of truth, data flows, failure modes                                                             | Route tables, file layouts, endpoint shapes                                              |
| [Design](design.md)             | build or change a screen, row, form, gesture, or label                                  | Rules that bind screens that do not exist yet, with a reason only when it adds information                          | An inventory of a screen, where a component lives, a rule for one screen                 |
| [Mac design](design-macos.md)   | build or change a Mac screen, row, control, or window                                   | Mac rules that bind Mac screens that do not exist yet: tokens, chrome, motion, accessibility                        | iPhone and iPad rules, the global rule a Mac rule differs from, an inventory of a screen |
| [iOS design](design-ios.md)     | build or change an iPhone screen, or an iPad screen in a compact window                 | iOS rules that bind iPhone and compact iPad screens that do not exist yet: tokens, placement, motion, accessibility | Mac rules, the global rule an iOS rule differs from, an inventory of a screen            |
| [iPad design](design-ipad.md)   | build or change an iPad screen, column, or the Stand at regular width                   | iPad rules at regular width: tokens, shell, the foot, the Stand, motion, accessibility                              | iPhone and Mac rules, the rule an iPad rule differs from, an inventory of a screen       |
| [Hosting](hosting.md)           | are at a host's dashboard, or need a variable or secret                                 | Every dashboard-held setting and how the app reads it                                                               | Defaults the code holds                                                                  |
| [Operations](operations.md)     | set up, run, test, commit, release, deploy, roll back, smoke check, or rebuild          | Steps and commands                                                                                                  | Host settings                                                                            |

## Keeping the pages small

- The code is the source of truth for everything except architecture and
  hosting. A page never copies what the code says.
- One test for every line: does someone working on a different screen,
  endpoint, or deploy have to know it? If not, it stays out.
- A decision that binds one feature belongs in that feature's spec in the
  vault, not here.
- Write short sentences, bullets, steps, and tables. Never a paragraph that
  has to be parsed to find the fact.
- No history. State what holds now. The commit message holds why it changed.
- Nothing about one release. A note for a single release goes in its pull
  request description.

## Design records

Feature specs live in the project vault under `specs/`, not in this
repository. `sessionmemory project --json` prints the paths. The system
spec is `specs/2026-09-11-crosstune-v1-architecture.md`.
