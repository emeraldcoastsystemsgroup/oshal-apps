<!-- CHANGE LOG
SEQ | AUTHOR | DESCRIPTION
1 | maintainer@emeraldcoastsystemsgroup.com | Document complete package test registration and honest isolated execution boundaries (0.4.2).
2 | maintainer@emeraldcoastsystemsgroup.com | Point to the marketing suite spec, its market scan, and this package's BACKLOG.md (the end-to-end suite work with done-when criteria).
-->
# Marketing Engine (marketing-engine) — OSHAL app package

Takes a built oshal product to traffic, users, and revenue — without ever acting on
its own. A campaign board with stage-gated intake (no spend before validation), a
per-channel consent model that defaults OFF, UTM-tagged links, a deterministic
weekly scorecard that says **NO DATA** instead of inventing a number, an ICE-scored
experiment registry, budget proposals a human approves, and four inline concierge
bots that draft and propose but never publish or spend. Every outward write goes
through an explicit confirm (`confirm: true` or HTTP 428) and lands in a run
ledger — including the refusals.

Companion docs in the core repo (plain paths — open them in the oshal checkout):

- Operator runbook (morning setup + the approval loop): `docs/business/marketing-engine-runbook.md`
- Product spec: `docs/business/marketing-engine-spec.md`
- ADRs: `docs/adr/131-marketing-engine-package.md`,
  `docs/adr/132-public-site-analytics.md`,
  `docs/adr/133-outbound-marketing-connectors.md`
- Marketing suite (end to end — audience, compliant email, a finance-project budget,
  sequences, SMS, attribution, paid ads): `docs/apps/marketing-suite-spec.md`, with the
  priced, sourced market scan at `docs/business/marketing-suite-market-research.md`

Open work, with a done-when on every item: [BACKLOG.md](BACKLOG.md).

## In this package

- The app manifest (`oshal-app.yaml`): ticketType `marketing-campaign` (backlog-gated
  weekly review workflow), two deterministic schedules (daily metrics ingest,
  Monday weekly review), and the cockpit surfaces.
- The `/api/marketing` routes: campaign CRUD + import, channel consent rows,
  bot-backed research/draft/launch-checklist, the confirm-gated publish chain,
  scorecard reads/rebuild, experiments, budget-proposal decisions, UTM builder.
- The `/api/marketing-ops` service routes: the schedule handlers behind the daily
  ingest and weekly review.
- The Bluesky fixed server operation (credential stays server-side; the model and
  the page never see it).
- The pure model module (`routes/marketing-model.js`): consent gates, cap
  semantics, import sanitizer, UTM builder, reallocation proposals, scorecard
  rollup — covered by the dependency-free `tests/*.test.mjs` suite.
- The surface (`tools/marketing-engine.html`) and package copies of the four bot
  personas (`personas/*.yaml`).
- Migrations `001-marketing-core.sql` + `002-marketing-metrics.sql` — all tables
  owner FORCE-RLS on `user_sub`, mirrored at the route factories' lazy-DDL
  chokepoints.

## Stays in the OSHAL kernel

- The connector framework and the connector specs this app publishes through:
  LinkedIn, Mastodon (`create-status`), Resend (`send-email`), Google Search
  Console (reads), PostHog (reads) — plus the Connectors surface (`/utilities`)
  where you connect accounts and paste tokens (Bluesky app password, Resend key).
- The inline-bot execution rail (`executeBotOrInline`) and your hosted/BYO AI
  provider settings — the four bots reason on YOUR brain; a missing provider is
  an honest `no_hosted_brain` error, never a silent fallback.
- The ticket queue, cockpit, scheduler, notifications, and the
  explicit-write-confirmation (428) gate.
- Public-site analytics injection (config-driven, default none) — see
  `docs/adr/132-public-site-analytics.md` in the core repo.
- X/Facebook/Instagram publishing — that stays in the Switchboard package.

## The bots (inline concierges — they draft, you decide)

| Bot | agentId | Does |
|---|---|---|
| campaign-director | `cadf0000-…-0001` | Weekly review markdown + a `PROPOSALS` JSON fence; channel copy from your briefs |
| market-analyst | `cadf0000-…-0002` | ICP card as one JSON object; unknowns land in `noData`, never invented |
| growth-analyst | `cadf0000-…-0003` | Scorecard narrative + anomalies, every claim carrying its number |
| launch-coordinator | `cadf0000-…-0004` | Launch checklists + plain drafts for HUMAN posting (HN/Reddit/Product Hunt are never bot-posted) |

All four personas embed the honesty doctrine (cite provided data only, no invented
metrics or quotes, no competitive absolutes, say NO DATA), the brand rule
(lowercase "oshal"), and the consent rule (never publish, never spend).

## The surface — `/cockpit/?app=marketing-engine`

| Pane | What it does |
|---|---|
| **Board** | Campaigns: create / import (content only — import can never enable a channel, set a budget, or advance a stage), stage-gate chips (0 validate → 1 organic → 2 monetize → 3 paid scale), status, Research / Draft / Launch-checklist bot actions, per-draft **Publish…** (confirm dialog showing the exact text), UTM link builder |
| **Scorecard** | Weekly rollup table; each source shows its numbers or a **NO DATA** badge — never a number for an unconfigured/broken source; Rebuild current week |
| **Channels** | The four consent rows (LinkedIn / Mastodon / Bluesky / Email): Enabled toggle (manual, per-item publishes only), Standing-authorization toggle (**requires confirm** + a daily cap ≥ 1), daily cap, paused reason; the run ledger tail below |
| **Experiments** | ICE-scored registry; legal transitions proposed → running → extended \| killed \| scaled, verdict recorded on kill/scale |
| **Approvals** | Budget/allocation proposals from the weekly review — Approve & apply (confirm dialog) or Reject; link to the review tickets in the cockpit |

The surface fetches same-origin with the session cookie; no tokens ever reach the
page. Errors render honestly: `not_connected` → "Connect *channel* in Connectors",
`no_hosted_brain` → "Add an AI provider in Settings", a 428 → the confirm dialog
(and only an explicit click re-sends with `confirm: true`).

## Endpoints (`/api/marketing`, OIDC session auth)

| Method + path | What |
|---|---|
| `GET /` | The surface (tools/marketing-engine.html) |
| `GET /overview` | Campaigns, channel rows, latest scorecard, pending proposals, open experiments, ledger tail |
| `POST /campaigns` · `PATCH /campaigns/:id` | Create / update (whitelisted fields; budget/stage changes also append a ledger row) |
| `POST /campaigns/import` | Sanitized import — consent/budget/cap/stage fields are stripped server-side, always |
| `GET /channels` · `PUT /channels/:channel` | Consent rows; enabling standing authorization requires `confirm: true` (428 otherwise) and `dailyCap ≥ 1`; disabling never needs confirm |
| `POST /research` · `POST /drafts` · `POST /launch-checklist` | Bot runs on your hosted/BYO brain (`503 no_hosted_brain` when absent) |
| `POST /content/:id/publish` | The gate chain: consent row → daily cap → `confirm: true` (else 428) → channel rail → ledger row. Launch items are never publishable |
| `GET /scorecard?weeks=8` · `POST /scorecard/rebuild` | Weekly rollups (per-source ok / no_data status) |
| `GET /experiments` · `POST /experiments` · `PATCH /experiments/:id` | ICE registry + legal status transitions |
| `GET /budget/proposals` · `POST /budget/proposals/:id/decide` | Approve (requires `confirm: true`, then applies) or reject |
| `GET /utm?url&source&medium&campaign&content` | UTM-tagged link |

Service routes (`/api/marketing-ops`, service auth): `POST /ingest`, `POST /weekly` —
the schedule handlers. `GET /api/marketing/_smoke` is the service-auth readiness probe.

## The consent model (read this before arming anything)

1. **Absent row = OFF.** Every channel starts with no authorization row; only an
   explicit opt-in enables it. The consent decision never falls back to any other
   setting.
2. **Enabled** permits *manual, per-item* publishes — and each one still shows
   you the exact text and demands `confirm: true`.
3. **Standing authorization** is the *future* gate for autonomous scheduled
   posting and is **inert in v0.1.0** — no autonomous posting path exists in
   this package, so arming it publishes nothing. It requires a daily cap ≥ 1
   and its own confirm, and records intent so switching an autonomous scheduler
   on later is a deliberate, pre-capped act (the daily cap already bounds manual
   publishes today via the run ledger).
4. **Imports never arm spend** — campaign/content import strips
   enabled/standing_authorization/daily_cap/budget/stage server-side.
5. **Bots never publish.** They draft and propose; the weekly review ticket sits
   in backlog until a human approves it; budget proposals wait in Approvals.
6. **Everything outward is ledgered** — published, skipped_consent, skipped_cap,
   skipped_confirm, error. If it isn't in the ledger, it didn't happen through
   the engine.

## Install

```bash
node scripts/oshal-app.js install marketing-engine
```

Then work through "Morning checklist A/B" in the core repo's
`docs/business/marketing-engine-runbook.md` — analytics token, Google reconnect
for Search Console, Bluesky app password, Resend domain + key, `MARKETING_EMAIL_FROM`,
GitHub traffic token. Everything is independently skippable; unconfigured sources
show NO DATA and unarmed channels refuse politely.

## AI Test Lab registration

Version 0.4.2 declares `test-catalog` and [tests/test-lab.yaml](tests/test-lab.yaml). Installation registers all 4 shipped Node test files as separate unit-suite cases, plus the existing `package-readiness` smoke case. Registration does not execute these suites.

The local Lab can run 3 suites in its sealed Node sandbox. They exercise the committed compiled modules with synthetic inputs; route/store suites use explicit router, database, logger, vault or bot stubs. They do not establish real HTTP, database/RLS, browser, provider, payment or deployment acceptance.

Open **AI Test Lab**, choose this application and select **Run**. Each declared suite has a 60-second limit and 256 MiB memory bound. The controller stages only eligible package code and starts a disposable, network-disabled container without host mounts or deployment credentials. Results bind the package version and staged source revision; an unavailable runner stays pending.

- `marketing-manifest` waits for `fixture:package-personas`; its persona or public example/dataset directory is deliberately outside the sealed execution inventory.

Existing test commands remain available for a source checkout:

```bash
node --test tests/*.test.mjs
```

Consent, cap and sanitized-import tests never publish content, contact providers or arm spending. Persona parity remains registered and pending until a confined persona fixture is supported.
