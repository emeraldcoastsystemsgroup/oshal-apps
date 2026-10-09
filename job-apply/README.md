# Job Apply (job-apply) — OSHAL app package

1.1.3 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

A workflow-only app (ADR-085 Wave 3, "skill with a surface" — ADR-093). It adds the
`job-apply` ticket type + queue and nothing else — no surface route, no html, no
queue-classification literal in the kernel. Push a `job-apply` ticket (with a clear
description: job URL, ATS, posting id) and the QueueManager routes it to the
already-carved **career-hunter** worker bot (manifest-worker, self-gating). The bot
gathers the job + the user's canonical apply values + the packet, hands the browser
submission to a desktop worker node (screen/mouse via `codex.exec`), and the ticket
PASSES or FAILS on the result. The operator just watches the queue.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3):

- **In this package:** the app manifest only — the `job-apply` ticketType + the Job
  Application Submission workflow bound to the career-hunter worker bot.
- **Stays in the OSHAL kernel:** the `career-hunter` worker bot (registered by the
  career-hunter app + `swarm-bot-registry`; declared here as a `dependencies.apps`
  entry so the installer resolves it), the apply-operator / apply-ingest **engine**
  (the OIDC-side `/api/apply-operator` dispatch, the service-secret `/api/apply/ingest`
  desktop callback, and the shared `apply-inflight` watchdog), and the apply CLIs +
  toolkits (`scripts/oshal-apply.js`, `applyOperatorTools`) the bots run.

## Dependencies

Requires the **career-hunter** app (its worker bot is this app's `workerBot`). The
installer resolves it npm-style, fail-closed.

## Install

```bash
node scripts/oshal-app.js install job-apply
```

No routes to build (workflow-only) and no migrations — the queue rides the kernel's
QueueManager and the career-hunter engine chain, both framework-resident.

Job Apply 1.1.1 loads the shared theme bootstrap (`/shared/ui/css/surface-themes.css` + `/shared/ui/js/surface-theme.js`) in `tools/review.html` and derives its palette from the framework tokens with the previous colors as fallbacks, so the surface follows the operator's chosen cockpit or experience skin whether embedded or opened standalone. No route, data or permission change.

## Company audience view (1.1.2)

The Business shells open the review page as `/api/job-apply/review?audience=company` (ADR-164 D6).
The shared kit (`/shared/ui/js/app-view.js`, loaded right after the theme bootstrap) paints the
signed-in account's submission runs: the route's five ledger counts as stats (runs active, failed or
unknown, manually marked, verified in 24 hours and in 5 days), a title that names the account's
state, a table of the newest three runs (application, company, state, last update) as the ledger
orders them, and the route's own ledger notes. On open it makes exactly one read,
`GET /home-summary`, under the caller's session: no connected-actions plan, no handoff listener,
no write. The one action opens the full page; retrying a submission stays Career's job. Signed
out, refused, a source the route could not check, and a failed read are each named. Any other
request runs the full Submission Review page unchanged; its module script is gated on the kit's
decision, so nothing but the view's own read runs behind a view.

## Testing

Registered in `tests/test-lab.yaml`.

- `node --test job-apply/tests/audience-view.test.cjs` from the store root: the audience view
  contract and behaviour (stub kit, stub fetch, stub DOM; no browser).
- `OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs job-apply` from the
  store root drives `tests/audience-view.fixture.cjs` over the real page and the real kit in
  headless Chromium.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| job-application-ticket | job application submission | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
