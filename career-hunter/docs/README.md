# Career documentation

For Career 1.58, start with the current guides:

| Guide | Audience and purpose |
|---|---|
| [Source reader recovery](source-readers.md) | Counted Oracle feeds, Workday restart progress and anonymous browser checks; limits, source migration and focused verification. |
| [User guide](user-guide.md) | A job seeker's day: replies, matches, saved jobs, preparation, sending, manual interviews and outcomes, and the optional past-seven-days goal |
| [Deployment guide](deployment.md) | Prospective outplacement, workforce and coaching buyers: current individual roles, connections, installation checks and the unbuilt coach/consent model |

These are repository guides. This change does not add them to the kernel's
in-app Help menu. Share the relevant guide through your installation's normal
documentation or support channel.

## Engineering and operations references

**Career Hunter** is the job-hunting application carved out of the oshal kernel under ADR-085. Its
routes, Node CLI wrapper, Python `jobhunter` engine, persona, migrations, and browser surfaces all
ship inside this package.

The package [README](../README.md) links the current guides and retains versioned
engineering and release history. Older UI names and deployment descriptions in
that history are not current user instructions.

| Note | What it covers |
|---|---|
| [Operations guide — batch processes from the admin's chair](operations.md) | What runs on its own and when (18:00 CT evening chain, boot catch-up, 07:00 CT digest), for whom (automation opt-in), where it executes (runner → launcher → Python → the worker rail → the career-bot node), how to check it (the log lines and what each means, `GET /run/refresh`, the completion marker and leases, the SQLite and Postgres queries), how to trigger it by hand, which AI credential the batch uses (none in the engine since the 1.24.0 worker rail; the rail's token, limits and cancellation), failure signatures, every environment knob, and how scrape targets are configured — the portal admin's shared companies table and each user's own pattern-gated target list. |
| [How Career and AI Office work together](career-and-office.md) | Resume Studio's master resume as a Word document in AI Office's editor: who owns what, the document's heading contract that Save to master resume reads back, the rules for AI Office's Concierge, the Career bot and Jarvis, and what the Career bot cannot do yet. |
| [Ribbon groups — ADR-085 addendum](ribbon-groups-adr-085-addendum.md) | The optional `group:` key on `ui.static[]` (labelled ribbon sections), why it is an addendum rather than a new ADR, the `section: bottom` limitation, degradation on an older core, and the two rules a cross-app ribbon tile must follow. |

Package-level history and cutover records live at the package root:
[BACKEND-CUTOVER.md](../BACKEND-CUTOVER.md), [JOBHUNTER-CONFUSION.md](../JOBHUNTER-CONFUSION.md),
[SESSION-RECORD-2026-07-30.md](../SESSION-RECORD-2026-07-30.md).
