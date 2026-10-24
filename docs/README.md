# Crosstune documentation

What each page holds. New knowledge goes only in the page whose contract
it fits. The rules for every page are in the Documentation section of
`CLAUDE.md`.

| Page                            | Holds                                                                                                   | Never holds                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Product](product.md)           | What Crosstune is, who it is for, what the plans gate, constraints on every release, the glossary       | Per-feature behavior, release plans                                                      |
| [Architecture](architecture.md) | The stack and what it rules out, boundaries, sources of truth, cross-system invariants, failure modes   | Route tables, file layouts, endpoint shapes, values a constant or a test already holds   |
| [Design](design.md)             | Rules two or more platforms share that bind screens not built yet, and which design page a rule goes in | An inventory of a screen, where a component lives, a rule for one screen or one platform |
| [Mac design](design-macos.md)   | Mac rules and gotchas: tokens, chrome, motion, accessibility                                            | iPhone and iPad rules, a restated global rule, an inventory of a screen                  |
| [iOS design](design-ios.md)     | iPhone and compact iPad rules and gotchas: tokens, placement, motion, accessibility                     | Mac rules, a restated global rule, an inventory of a screen                              |
| [iPad design](design-ipad.md)   | iPad rules at regular width: tokens, shell, the foot, the Stand, motion, accessibility                  | iPhone and Mac rules, a restated global or iOS rule, an inventory of a screen            |
| [Web design](design-web.md)     | Web rules and gotchas: tokens, frames, placement, overlays, motion, keyboard, accessibility             | Apple app rules, a restated global rule, an inventory of a screen                        |
| [Analytics](analytics.md)       | The rules for events and properties, and the steps to add an event                                      | The event list, host settings                                                            |
| [Operations](operations.md)     | Setup, the procedures and gotchas of testing, releasing, deploying, and rolling back                    | Host settings, what `just --list` already says                                           |
