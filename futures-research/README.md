# Futures Research

Futures Research (`1.2.0`) provides its own Light Blue research screen (`/api/futures-research/app`),
an inline front-desk concierge (`futures-research-concierge`), and a dedicated tool-less workflow
worker (`futures-research-worker`) for walk-forward CME and Micro futures study reviews (`/MES`,
`/MNQ`, `/ES`, `/NQ`, `/CL`, `/GC`) and frozen forward-call grading. Intelligent Trades owns study
schedule controls and execution gates; the kernel owns study admission, exact owner/run/ticket
binding, strict output validation, and durable review state. Neither `futures-research-worker` nor
`futures-research-concierge` can place, modify, or route live or paper orders.

## Surfaces and Routes

- `GET /api/futures-research/app` (`futures-research-home`, `ribbon.defaultView`): responsive
  research-only surface displaying the zero-order-placement posture banner, walk-forward Studies &
  Proposals, the Review Queue (thesis, sample/source-lag risks, confidence posture, and exact
  `evidenceCitations`), and separately frozen Forward Calls. When `intelligent-trades` is admitted
  in the signed-in person's session, the surface reads `GET /api/trading/autopilot/futures` and
  `GET /api/trading/autopilot/futures/predictions` alongside `GET /api/futures-research/overview`
  and `GET /api/tickets`; otherwise it renders honest empty or disconnected states without
  fabricating figures.
- `GET /api/futures-research/overview`: caller-authenticated (`Cache-Control: no-store`) queue
  overview read backing the `futures_research_overview` concierge tool.
- `GET /api/futures-research/home-summary`: caller-authenticated Today Home summary (`<= 4`
  string-valued tiles, `<= 5` items, `partial: false`).
- `GET /api/futures-research/_smoke`: service-authenticated package readiness probe.

## Workflow and Adoption Boundary

Install the matching framework and this package, then enable `futures-research-worker` in the
Bots console when running queued study reviews. No CLI login or connector secret is mounted on the
worker. In Intelligent Trades → Strategies → Tuning, opt into **Queue research-bot review after new
evidence** and save. Installation alone does not enroll anyone or create a schedule. Loading a
next-study proposal changes only the form; explicit Save in Intelligent Trades is the human approval
that selects future studies.

Version `1.1.0+` interprets frozen forward context separately from historical out-of-sample runs and
cites the exact context fingerprint. Unscored and flat cases are never counted as wins; overlapping
horizons are not independent, and signed ticks are not trade P&L or probabilities.

Tests are registered in `tests/test-lab.yaml` (`package-readiness`, `package-contract`,
`persona-direct-question`, and `futures-research-surface`).

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| futures-study-review | study review | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
