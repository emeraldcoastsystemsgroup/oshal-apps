# Finance (the entry in the experiences list)

`finance-experience` puts **Finance** in the experiences list, beside Home, Jarvis and Intelligent Career. Choosing it
opens the Finance application page (`/api/finance/app`), which the `finance` package owns and serves: your money, trades,
markets and world events in one window, and the work running on them.

This package owns no data and no bot, and one page: a hand-off that sends the browser to the Finance application page. It exists because of two kernel rules:

- An application is listed as an experience only when it has an access catalog (`uses: application-authorization` and
  `experience`).
- Finance itself must not gain a catalog. Six experience packages (Home, Business, Commons, Jarvis, Orbit, Studio) give
  people Finance through the `@app-admin` mapping, which the kernel accepts only for an application without a catalog.
  The day Finance has one, those mappings stop resolving and everyone's access through them waits for re-approval.

So the entry lives here, with a catalog of its own that grants one thing: opening the entry.

## What's inside

| Path | What |
|---|---|
| `oshal-app.yaml` | The manifest: the `experience` block (label Finance, entry `/api/finance-experience/app`), the `member` role template, the two routes. |
| `authorization.yaml` | One permission, `app.open` (read), one role, `member`. |
| `src-routes/experience.ts`, `routes/experience.js` | `GET /app` answers 302 to `/api/finance/app`. |
| `src-routes/package-smoke.ts`, `routes/package-smoke.js` | Install readiness: the package's name and version, for the service only. |
| `tests/package-contract.test.cjs` | The contract described below. |

## The member role

Giving a person **Finance member** gives them this entry and Finance. Intelligent Trades, World Intelligence and Kalshi
Edge are choices on the same role; each is given only when chosen. The Daily recap is not part of the role: it requires
Vids Studio, whose role a person is given separately.

What a person may do inside each application stays with that application. This role never grants more than opening.

## Tests

`node --test tests/package-contract.test.cjs` from this folder (needs `scripts/toolchain` installed for Express). It
checks the manifest against what the kernel requires of an experience, that every mapped application exists, is active
and has no catalog, that whatever a mapped application requires is mapped as well, that the catalog grants reading only,
and that the compiled route answers the hand-off page, on a local listener and with a response that has only the kernel's methods. It does not prove the entry on a
running kernel; that is checked on the test slot before a delivery.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **16 / 64 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
