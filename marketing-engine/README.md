<!-- CHANGE LOG
SEQ | AUTHOR | DESCRIPTION
1 | maintainer@emeraldcoastsystemsgroup.com | Document complete package test registration and honest isolated execution boundaries (0.4.2).
2 | maintainer@emeraldcoastsystemsgroup.com | Point to the marketing suite spec, its market scan, and this package's BACKLOG.md (the end-to-end suite work with done-when criteria).
3 | maintainer@emeraldcoastsystemsgroup.com | 0.5.9: person-facing product references and brand rule name Open Swarm.
4 | maintainer@emeraldcoastsystemsgroup.com | 0.6.0: document P1 audience store (migration 003, /api/marketing/audience/* routes, and RLS tests).
5 | maintainer@emeraldcoastsystemsgroup.com | 0.6.1: document P1 CSV import with consent attestation (`POST /api/marketing/audience/contacts/import-csv`).
6 | maintainer@emeraldcoastsystemsgroup.com | 0.6.2: document P1 HTML email templates (with plain-text alternative and postal footer), Compliance pane, migration 004, and compliance/template endpoints.
7 | maintainer@emeraldcoastsystemsgroup.com | 0.6.3: document P1 double opt-in sign-up forms, migration 005, `/audience/signup-forms*` and `/audience/opt-in/confirm` routes, embeddable snippet, and Compliance pane sign-up form controls.
8 | maintainer@emeraldcoastsystemsgroup.com | 0.6.4 (NAV-02): single-row horizontal scrollable phone navigation and filter strips (.tabs, .chips, .stages) with 44px+/48px+ nowrap touch targets and `tests/marketing-nav-phone.test.mjs`.
9 | maintainer@emeraldcoastsystemsgroup.com | 0.6.5: document P1 one-click unsubscribe (RFC 8058 headers + signed tokens + immediate suppression/revocation), recipient preferences, broadcast pipeline (`006-marketing-broadcasts.sql`, `/broadcasts*`, `/audience/unsubscribe`, `/audience/preferences/:contactId`), and Broadcasts card in Compliance pane.
10 | maintainer@emeraldcoastsystemsgroup.com | 0.6.6: document P3 sequences with per-recipient state, strict per-sequence standing authorization (default OFF, daily-cap bounded, one-click disarm), welcome-sequence auto-enrollment (`007-marketing-sequences.sql`, `/sequences*`), and Sequences card in Compliance pane.
11 | maintainer@emeraldcoastsystemsgroup.com | 0.6.7: document P3 launch plans with dated milestones, launch-coordinator asset checklist, strictly recorded-numbers-only campaign retros, and one unified deduplicated marketing calendar (`008-marketing-launch-plans.sql`, `/launch-plans*`, `/calendar`) plus Launch Plans & Unified Calendar cards in the Experiments pane.
12 | maintainer@emeraldcoastsystemsgroup.com | 0.6.8: document P2 campaign-to-finance-project link (`009-marketing-finance-link.sql`, `create-budget-project` offer, `/campaigns/:id/finance-project`, `/campaigns/:id/budget-summary`, Create budget in Finance hand-off) and atomic `channel_allocation` reallocation proposals on the weekly review (`/campaigns/:id/reallocation-proposals` + single-transaction apply in `/budget/proposals/:id/decide`).
13 | maintainer@emeraldcoastsystemsgroup.com | 0.6.9: document P5 attribution columns on ingest (`campaign_slug`, `medium`), first-touch UTM capture on sign-up and conversions (`010-marketing-attribution.sql`, `oshal_marketing_conversions`, `/attribution/funnel`, `/attribution/conversions`), per-campaign email/SMS engagement counts (`/deliveries/:deliveryId/event`, explicit `NO DATA` on quiet campaigns, opens omitted as unreliable), and Campaign Attribution & Engagement Funnel card on `#pane-scorecard`.
14 | maintainer@emeraldcoastsystemsgroup.com | 0.6.10: document P4 SMS TCPA/CTIA consent evidence, E.164 phone normalization, explicit/inferred recipient time zones, DST-aware clock-controlled 8 a.m.–9 p.m. recipient-local quiet-hours holding (`011-marketing-sms-consent.sql`, `oshal_marketing_sms_queue`, `/audience/sms-opt-in`, `/audience/sms/schedule`, `/audience/sms/queue`, `/audience/sms/keyword`), and SMS Consent & Quiet Hours card in `#pane-compliance`.
-->
# Marketing Engine (marketing-engine) — Open Swarm app package

0.5.3 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

Takes a built Open Swarm product to traffic, users, and revenue — without ever acting on
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
- Migrations `001-marketing-core.sql`, `002-marketing-metrics.sql`,
  `003-marketing-audience.sql`, `004-marketing-compliance.sql`,
  `005-marketing-double-optin.sql`, `006-marketing-broadcasts.sql`,
  `007-marketing-sequences.sql`, `008-marketing-launch-plans.sql`,
  `009-marketing-finance-link.sql`, `010-marketing-attribution.sql`, and
  `011-marketing-sms-consent.sql` — all tables
  owner FORCE-RLS (`user_sub` on core/metrics, exact-owner `owner_sub` on the five
  audience tables, `oshal_marketing_compliance_settings`,
  `oshal_marketing_signup_forms`, `oshal_marketing_optin_tokens`,
  `oshal_marketing_messages`, `oshal_marketing_deliveries`,
  `oshal_marketing_sequences`, `oshal_marketing_sequence_steps`,
  `oshal_marketing_enrollments`, `oshal_marketing_launch_plans`,
  `oshal_marketing_conversions`, and `oshal_marketing_sms_queue`), mirrored at the
  route factories' lazy-DDL chokepoints.

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
("Open Swarm"), and the consent rule (never publish, never spend).

## The surface — `/cockpit/?app=marketing-engine`

| Pane | What it does |
|---|---|
| **Board** | Campaigns: create / import (content only — import can never enable a channel, set a budget, or advance a stage), stage-gate chips (0 validate → 1 organic → 2 monetize → 3 paid scale), status, Research / Draft / Launch-checklist bot actions, per-draft **Publish…** (confirm dialog showing the exact text), UTM link builder |
| **Scorecard** | Weekly rollup table; each source shows its numbers or a **NO DATA** badge — never a number for an unconfigured/broken source; Rebuild current week; **Campaign Attribution & Engagement Funnel** showing per-campaign attributed visits, first-touch sign-ups, purchases, revenue, and delivered/clicked/unsubscribed/bounced/complained counts (explicit **NO DATA** where nothing sent; opens omitted as unreliable) plus an inline **Record conversion** form |
| **Channels** | The four consent rows (LinkedIn / Mastodon / Bluesky / Email): Enabled toggle (manual, per-item publishes only), Standing-authorization toggle (**requires confirm** + a daily cap ≥ 1), daily cap, paused reason; the run ledger tail below |
| **Experiments** | ICE-scored registry; legal transitions proposed → running → extended \| killed \| scaled, verdict recorded on kill/scale; Launch Plans & Grounded Retros (dated milestones, interactive launch-coordinator asset checklist, recorded-numbers-only retro with NO DATA badges); Unified Marketing Calendar combining scheduled engine content, launch milestones, broadcasts, and optional Switchboard posts chronologically with zero duplicates |
| **Approvals** | Budget/allocation proposals from the weekly review — Approve & apply (confirm dialog) or Reject; link to the review tickets in the cockpit |
| **Compliance** | Sender identity, physical postal address, unsubscribe URL, and SMS quiet hours; HTML + plain-text email template studio (`announcement`, `newsletter`, `launch`) with sandboxed preview and compliance checklist; double opt-in sign-up forms with embeddable static-site snippet and in-page test/confirm flow; Broadcasts & One-Click Unsubscribe card with draft creation, dry-run send gate audit ledger, and one-click unsubscribe test; Sequences & Standing Authorization card with sequence/step authoring, Armed vs OFF badges, confirmed arming, one-click Disarm, and dry-run tick preview; SMS Consent & Quiet Hours card with TCPA/CTIA opt-in capture, explicit vs inferred timezone badge, clock-controlled quiet-hours send checker, STOP/HELP keyword tester, and SMS queue list; suppression management; per-contact consent JSON export and export-first contact deletion |

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
| `GET /audience/contacts` · `POST /audience/contacts` | List/segment contacts (`list`, `tag`, `consentState`, `channel`, `purpose`, `suppressed`, `q`) and upsert contacts with sign-up consent evidence (refuses re-confirming suppressed addresses) |
| `POST /audience/contacts/import-csv` | RFC-4180 CSV import with mandatory consent source attestation (atomic 400 refusal if any row lacks a source), `pending` by default unless documented prior consent (`confirmed` + evidence + ISO-8601 timestamp) is present, never re-subscribes suppressed addresses, and stores full consent evidence per contact |
| `GET /audience/contacts/:id/consent-export` · `DELETE /audience/contacts/:id` | Export recorded consent evidence JSON (`formText`, `recordedAt`, `ip`, `userAgent`, `utm`, `tokenHash`), lists, and suppressions; delete exports evidence first and removes contact, consents, and memberships (plus matching suppression with `?purgeSuppression=true`) |
| `GET /audience/lists` · `POST /audience/lists` · `POST /audience/lists/:id/members` · `DELETE /audience/lists/:id/members/:contactId` | Manage owner-scoped audience lists and memberships |
| `GET /audience/suppressions` · `POST /audience/suppressions` · `DELETE /audience/suppressions/:id` | Manage normalized SHA-256 hash suppressions; adding a suppression revokes active consents for that contact and channel |
| `GET /compliance` · `PUT /compliance` | Read and update owner-scoped sender identity, physical postal address, unsubscribe URL, and SMS quiet hours, with readiness flags and live audience compliance counts |
| `GET /templates` · `POST /templates/render` | List built-in email templates (`announcement`, `newsletter`, `launch`) and render escaped HTML + plain-text alternative with mandatory postal footer and unsubscribe link (read-only) |
| `POST /content/:id/approve` | Owner-scoped draft approval (`draft -> approved`); email drafts must pass compliance settings and template HTML/plain-text/footer/unsubscribe lint or are refused `422` |
| `GET /audience/signup-forms` · `POST /audience/signup-forms` · `PATCH /audience/signup-forms/:slug` · `DELETE /audience/signup-forms/:slug` | Manage owner-scoped double opt-in sign-up forms (consent disclosure, optional target list, honeypot field, per-IP and per-form hourly caps, token TTL; `signing_secret` is never returned) |
| `GET /audience/signup-forms/:slug/snippet` | Return a self-contained, HTML-escaped static-site HTML + vanilla JS embed snippet with honeypot field, consent checkbox, and UTM query capture (read-only) |
| `POST /audience/signup-forms/:slug/submit` · `POST /audience/opt-in/confirm` | Execute rate-limited, honeypot-screened, suppression-immune double opt-in submission (`pending` consent evidence + HMAC-SHA256 signed single-use token + acknowledgement-only response) and atomic single-use confirmation (`pending -> confirmed`) |
| `GET /broadcasts` · `POST /broadcasts` · `GET /broadcasts/:id` | List owner-scoped broadcast messages (omitting `signing_secret`), create broadcast drafts targeting an owned list and built-in template, and inspect per-recipient delivery ledger rows |
| `POST /broadcasts/:id/send` | Run the full broadcast send gate chain (email channel consent -> daily cap -> compliance & template lint -> explicit `confirm: true` -> per-recipient suppression, confirmed consent, and cap checks) in dry-run audit mode (`{ dryRun: true }`) or confirmed live send (`{ confirm: true }`) |
| `POST /audience/unsubscribe` | RFC 8058 one-click unsubscribe handler: constant-time verifies signed per-recipient/per-list HMAC-SHA256 token (refuses forged tokens `400`), atomically suppresses `email_hash`, revokes email consents with evidence, and marks contact `unsubscribed` |
| `GET /audience/preferences/:contactId` · `PUT /audience/preferences/:contactId` | Read and update owner-scoped contact list memberships and channel opt-outs (email/SMS suppression + consent revocation) |
| `GET /sequences` · `POST /sequences` · `GET /sequences/:id` · `POST /sequences/:id/steps` | Manage owner-scoped sequences (always created with `standing_authorization = false` and `signing_secret` omitted), optional welcome `triggerFormSlug`, and ordered compliant email steps |
| `PUT /sequences/:id/authorization` · `POST /sequences/:id/disarm` | Arm per-sequence standing authorization (strict boolean `true` + `confirm: true` + `dailyCap >= 1`; garbage values refused `400`) or one-click Disarm (`standing_authorization = false`, no confirm required) |
| `POST /sequences/:id/enroll` · `POST /sequences/:id/tick` | Enroll a confirmed unsuppressed contact and run due sequence steps (refuses `403 sequence_disarmed` when disarmed outside `dryRun: true`; re-checks suppression and confirmed consent before every single step, respects `dailyCap`, and advances or stops per-recipient enrollment state) |
| `GET /launch-plans` · `POST /launch-plans` · `GET /launch-plans/:id` · `PATCH /launch-plans/:id` | List, create/replace, inspect, and update owner-scoped campaign launch plans with dated milestones and starter `launch-coordinator` asset checklists |
| `POST /launch-plans/:id/retro` | Compute and persist a strictly grounded campaign launch retrospective from ONLY the caller's recorded DB rows (`oshal_marketing_events`, `oshal_marketing_run_ledger`, `oshal_marketing_deliveries`, `oshal_marketing_experiments`, and plan completion counts), emitting `NO DATA` wherever a metric source has zero rows |
| `GET /calendar` | Unified read-only chronological marketing calendar (`?from=YYYY-MM-DD&to=YYYY-MM-DD`) merging scheduled engine content, launch plan milestones, broadcasts, and optional Switchboard scheduled posts with strict `(source, sourceId)` deduplication and clean degradation when Switchboard is absent |
| `POST /campaigns/:id/finance-project` · `GET /campaigns/:id/budget-summary` | Link a Finance project UUID onto a caller-owned campaign and read its budget, channel allocations, Finance project hand-off payload, and live Finance summary (`Budget`, `Committed`, `Actual`, `Variance`, degrading cleanly when Finance is absent) |
| `POST /campaigns/:id/reallocation-proposals` | Run `reallocationProposals()` over recorded channel spend and conversions (or validated supplied channel metrics) and write `status = 'proposed'` `channel_allocation` rows to `oshal_marketing_budget_ledger` (applied atomically with linked Finance lines via confirmed `POST /budget/proposals/:id/decide`) |
| `GET /attribution/funnel` · `POST /attribution/conversions` | Read per-campaign attribution funnel (attributed visits by `campaign_slug` & `medium`, first-touch sign-ups/purchases/activations/revenue, and email/SMS delivery engagement with explicit `NO DATA` where nothing was sent; opens omitted as unreliable) and record conversions inheriting immutable first-touch consent UTM evidence when not explicitly supplied |
| `POST /deliveries/:deliveryId/event` | Record an owner-scoped delivery engagement event (`clicked`, `bounced`, `complained`, `unsubscribed`) on an owned `oshal_marketing_deliveries` row; `bounced`, `complained`, and `unsubscribed` automatically suppress the recipient and revoke email consent (foreign owner `404`) |
| `POST /audience/sms-opt-in` | Record a contact's E.164 phone, explicit or area-code-inferred recipient timezone (`timezoneInferred`), and complete 7-field TCPA/CTIA `channel = 'sms'` consent row (refuses `400` if any field is missing, `409` if phone is SMS-suppressed), returning the deterministic opt-in confirmation message |
| `POST /audience/sms/schedule` · `GET /audience/sms/queue` | Evaluate the SMS send gate (suppression -> valid TCPA/CTIA consent -> DST-aware 8 a.m.–9 p.m. recipient-local quiet hours at optional `nowIso`), refusing `403` without consent or when suppressed, holding `202 held_quiet_hours` with exact next `08:00` local `releaseAt`, or marking `200 ready` inside permitted hours; list owner's SMS queue read-only |
| `POST /audience/sms/keyword` | Owner-scoped CTIA STOP/HELP keyword processor: STOP family keywords (any case) suppress `phone_hash` in `oshal_marketing_suppressions` (`channel = 'sms'`), revoke SMS consent, cancel `held_quiet_hours` queue items, and return the final confirmation text; HELP returns program help text without suppressing |

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

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| channel-post-draft | channel post draft | T2 | none | disable | not yet measured | none recorded |
| icp-research | ideal customer profile refinement | T2 | none | disable | not yet measured | none recorded |
| launch-kit | launch kit | T3 | none | disable | not yet measured | none recorded |
| weekly-campaign-review | weekly review ticket | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
