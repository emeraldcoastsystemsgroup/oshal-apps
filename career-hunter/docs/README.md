# Career Hunter — package documentation

**Career Hunter** is the job-hunting application carved out of the oshal kernel under ADR-085. Its
routes, Node CLI wrapper, Python `jobhunter` engine, persona, migrations, and browser surfaces all
ship inside this package.

Start with the package [README](../README.md) for the shape of the package and how it is built.
This folder holds the longer-form notes that do not belong in the README.

| Note | What it covers |
|---|---|
| [Ribbon groups — ADR-085 addendum](ribbon-groups-adr-085-addendum.md) | The optional `group:` key on `ui.static[]` (labelled ribbon sections), why it is an addendum rather than a new ADR, the `section: bottom` limitation, degradation on an older core, and the two rules a cross-app ribbon tile must follow. |

Package-level history and cutover records live at the package root:
[BACKEND-CUTOVER.md](../BACKEND-CUTOVER.md), [JOBHUNTER-CONFUSION.md](../JOBHUNTER-CONFUSION.md),
[SESSION-RECORD-2026-07-30.md](../SESSION-RECORD-2026-07-30.md).
