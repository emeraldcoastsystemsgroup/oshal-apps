# Daily Trade Recap (daily-trade-recap) — OSHAL app package

1.3.3 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

After the closing bell: render the day's charted trade-recap video (real Alpaca
data → PowerPoint deck → narrated MP4) on the swarm render node, then email it to
the operator with the day's numbers and the video attached as a preview
(ADR-074). One bot, one tool, one call: a `daily-trade-recap` ticket instructs
the **vids-operator** to call `trade_recap_pipeline`, which hands the goal + the
day's authoritative data to the video PC's local agent and monitors it; an
approval gate holds the result before posting.

**NOTE: despite the name this is a VIDS-family media pipeline** — its only real
dependency is the shared vids-operator desktop worker — which is why it carves
with the media cluster and NOT the trading wave.

Initially carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a
surface"); package-owned review routes and integrations were added afterward:

- **In this package:** the app manifest (ticketType `daily-trade-recap` + the
  approval-gated graph workflow), the three `trade_recap_*` CLI tools, a
  package copy of the vids-operator persona, the Recap Review surface, Home
  summary, integration offers and the recorded-report briefing consumer.
- **Stays in the OSHAL kernel:** the SHARED **vids-operator remote-client desktop
  worker** (`packages/oshal-vids-operator`) with its registry entries in BOTH
  `swarm-bot-registry` blocks; ALL trading engines, schedule pins, and the
  deck-data pipeline — the recap stage scripts (`scripts/oshal-recap-agent-remote.js`,
  `oshal-recap-render-remote.js`, `oshal-recap-email.js`, `oshal-trade-data.js`,
  `oshal-trade-recap.js`, `oshal-deck-data.js`) that the tools shell to; the
  5PM CT recap cron (a HOST scheduled task driving `scripts/run-daily-recap.ps1`);
  and the generic `workflow:<ticketType>` schedule-dispatch engine.

## Surfaces

Open **Recap Review** from the installed application's navigation. Its route is
`/api/daily-trade-recap/review`; the application also supplies its Home summary
and document/video preparation integrations. These are separate from the
existing report generation and approval-gated delivery workflow.

## Install

```bash
node scripts/oshal-app.js install daily-trade-recap
```

Generation needs the render node online (the `@oshal/chat` worker on the video
PC), and the existing email step needs the operator's Google connection. The
recorded-report consumer needs an updated core with `saveCompletedBriefing`
and the registered Jarvis briefing service; it reports unavailable when that
runtime is missing. It does not create a second report or delivery pipeline.

## Schedule it

The production path is the kernel's 5PM CT host task. A swarm-side alternative:
create a Redis-backed schedule whose `taskType` is `workflow:daily-trade-recap` —
every fire creates an auto-started `daily-trade-recap` ticket.

## Recorded reports in Jarvis

The package's separate fifteen-minute service schedule examines at most the
newest 50 recorded `daily-report` journal entries from within 72 hours.
It stops admitting further rows after a ten-second budget; an in-flight
operation keeps the core service's own authority and timeout boundaries.
Older reports are not backfilled.

Each recipient comes from the recorded owner subject and must resolve to an
unambiguous current identity through the existing briefing service. Current
source authorization and briefing preferences still apply. A deterministic
owner/day identifier prevents overlapping runs and journal rewrites from
creating repeated briefings. The core stores the completed result atomically;
a failed transaction leaves no pending task behind, so a later run can retry.

The message says **report recorded**. Recording the journal does not prove email
or site delivery. Collection neither generates reports nor trades or sends
outward messages. It returns aggregate counts: only committed admissions count
as queued; suppressed, duplicate or failed admissions are reported as deferred
or already queued. Jarvis retains its normal delivery/claim lifecycle.

## Tests

Installation registers metadata readiness and the recorded-report regression in
AI Test Lab through `tests/test-lab.yaml`. The regression requires a framework
checkout and uses the actual compiled collector, core task helper and briefing
service with isolated SQL and HTTP fixtures. It does not call providers or use
live trading records. Registration is distinct from executing the suite.

```powershell
$env:OSHAL_CORE_DIR = 'C:/Projects/oshal'
node --test tests/completed-report-briefings.core.test.js
```

The audience view contract is also registered (`audience-view` in `tests/test-lab.yaml`):

- `node --test tests/audience-view.test.cjs` — the contract and behaviour of the company view
  (stub kit, stub fetch, stub DOM; no browser).
- `OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs daily-trade-recap` from
  the store root drives `tests/audience-view.fixture.cjs` over the real page and the real kit in
  headless Chromium.

## Audience view (ADR-164 D6)

Daily Trade Recap 1.3.2 answers `?audience=company` on Recap Review, which is how the Business
shell and the all-inclusive Studio, Orbit and Commons shells open the application's first surface.
The view is the owner's recap record for the closed Eastern trading days in the last 7 days, today
excluded, painted by the shared kit: the four counts (sessions with no recap, recaps recorded,
trading sessions, recaps awaiting review), a table of the closed sessions with whether and when each
recap was recorded, and the recap tickets parked at their approval gate. On open it reads only
`GET /home-summary` under the caller's session — never the framework plan that lists
connected-actions offers, never a write; nothing here renders, emails or re-runs a recap. Every
session recapped, no closed session (a market holiday records none), a partly unreadable record,
401, 403 and a failed read are each named. The one action opens Recap Review; the escape opens the
application in the cockpit. Any other request runs the full page unchanged, and its start (the
handoff listener, the connected-actions mount, the record read) is gated on the kit's decision.

Daily Trade Recap 1.3.1 loads the shared theme bootstrap (`/shared/ui/css/surface-themes.css` + `/shared/ui/js/surface-theme.js`) in `tools/review.html` and derives its palette from the framework tokens with the previous colors as fallbacks, so the surface follows the operator's chosen cockpit or experience skin whether embedded or opened standalone. No route, data or permission change.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| daily-recap-production | daily recap production | T4 | hosted | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
