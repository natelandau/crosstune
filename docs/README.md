# Crosstune documentation

Each page answers one kind of question. Read the page that matches the task.
Local development, from prerequisites to the first sign-in, is in the README
at the repository root.

| Page                            | Read it when you                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [Product brief](product.md)     | need to know what Crosstune is, who it is for, what the first release contains, and the constraints every release obeys.     |
| [Decisions](decisions.md)       | want the reason behind a choice of stack, host, or design before you reopen it.                                              |
| [Architecture](architecture.md) | change the API, the web client, sync, sign-in, or link resolution, or need to know what a musician sees when a host is down. |
| [Design patterns](design.md)    | build or change a screen, a row, a form, a gesture, or a label in the web client.                                            |
| [Hosting reference](hosting.md) | are at a dashboard and need the setting, variable, or secret that a host holds.                                              |
| [Operations](operations.md)     | deploy, cut a release, run the smoke check, or rebuild the hosts from nothing.                                               |

## Design records

The system architecture, the data model, the API and sync protocol, the client
structure, the tooling, and the testing approach are defined in the first
release architecture spec. Design records live in the project vault under
`specs/`, not in this repository. Run `sessionmemory project --json` to find
the vault paths. The first release spec is
`specs/2026-09-11-crosstune-v1-architecture.md`.
