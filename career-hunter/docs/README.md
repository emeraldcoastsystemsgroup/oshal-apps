# Career Hunter — package documentation

**Career Hunter** is the job-hunting application carved out of the oshal kernel under ADR-085. Its
routes, Node CLI wrapper, Python `jobhunter` engine, persona, migrations, and browser surfaces all
ship inside this package.

Start with the package [README](../README.md) for the shape of the package and how it is built.
This folder holds the longer-form notes that do not belong in the README.

| Note | What it covers |
|---|---|
| [Operations guide — batch processes from the admin's chair](operations.md) | What runs on its own and when (18:00 CT evening chain, boot catch-up, 07:00 CT digest), for whom (automation opt-in), where it executes (runner → launcher → Python → codex/Anthropic), how to check it (the log lines and what each means, `GET /run/refresh`, the completion marker and leases, the SQLite and Postgres queries), how to trigger it by hand, which AI credential the batch uses per deployment posture (ADR-137 amendment A), failure signatures, every environment knob, and how scrape targets are configured — the portal admin's shared companies table and each user's own pattern-gated target list. |
| [Ribbon groups — ADR-085 addendum](ribbon-groups-adr-085-addendum.md) | The optional `group:` key on `ui.static[]` (labelled ribbon sections), why it is an addendum rather than a new ADR, the `section: bottom` limitation, degradation on an older core, and the two rules a cross-app ribbon tile must follow. |

Package-level history and cutover records live at the package root:
[BACKEND-CUTOVER.md](../BACKEND-CUTOVER.md), [JOBHUNTER-CONFUSION.md](../JOBHUNTER-CONFUSION.md),
[SESSION-RECORD-2026-07-30.md](../SESSION-RECORD-2026-07-30.md).
