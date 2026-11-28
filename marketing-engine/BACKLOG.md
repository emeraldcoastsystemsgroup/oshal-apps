# marketing-engine — BACKLOG (marketing suite)

Open work to take the marketing suite end to end: position → plan → budget (a finance project) →
produce → publish (social, email, SMS) → capture → nurture → measure → reallocate → retro. The design,
the as-built table and the operator decisions are in the
[marketing suite spec](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/apps/marketing-suite-spec.md);
prices and compliance sources are in the
[market scan](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/business/marketing-suite-market-research.md).
Every entry has a done-when so scope does not have to be guessed later. Items owned by another package
or by core say so; core items need operator approval before they start.

**Posture (`marketing-engine` `0.6.10`, reviewed `2026-11-28`):** campaigns, owner consent gates,
manual publishing to LinkedIn/Mastodon/Bluesky, the scorecard, budget proposals (wired to
cross-application `/cockpit/?screen=approvals`), the owner-scoped P1 Audience store (`0.6.0`),
CSV import with mandatory consent attestation (`0.6.1`), built-in HTML/plain-text email
templates with unremovable postal footer + the Compliance pane (`0.6.2`), the double opt-in
sign-up engine with embeddable snippets (`0.6.3`), single-row phone navigation (`0.6.4`),
the one-click unsubscribe + broadcast pipeline with full send gate chain (`0.6.5`), P3
sequences with per-recipient state + strict per-sequence standing authorization (`0.6.6`), P3
launch plans with dated milestones, asset checklist, recorded-numbers-only retros, and one unified
marketing calendar (`0.6.7`), P2 campaign-to-finance-project link + reallocation proposals (`0.6.8`),
P5 attribution columns, UTM capture, and email/SMS engagement tracking (`0.6.9`), and P4 SMS
consent model + quiet hours/time zones (`0.6.10`) run today. Nothing texts a customer yet (US
10DLC carrier registration and inbound STOP/HELP webhook remain open), and manual/Plaid/messaging
actuals ingestion into Finance projects remains open. Every outward action stays opt-in,
confirm-gated, and default OFF.

**Progress through `0.6.10`:**
- **P0 (`0.5.0`):** merged in both repos (store `4b8984e5` through PR #185, merged 2026-09-14 as
  `4e15108`; core `477f3a0b` through PR #431, merged 2026-09-14 as `b8de2099` and deployed from that
  commit): `marketing-engine` carries three readiness probes (first campaign, an armed channel, a
  configured sender) behind `/api/marketing-engine/readiness`, and `marketing-routes.ts` is split
  into five modules with all 20 routes unchanged. `marketing-suite` (now `1.1.4`) is the ADR-141
  group front door. The store's write-class ledger follows a route's package-local import closure,
  which also corrected 19 routes across 14 packages that delegate their SQL to sibling modules.
- **Platform parity (`0.5.1`–`0.5.11`):** system-scoped schedules (`runsAs: system`), company
  audience view, routing keywords, design/mobile updates, and cross-app `approvals:` wiring.
- **P1 (`0.6.0`–`0.6.5`):** Audience store (`003-marketing-audience.sql` +
  `/api/marketing/audience/*` routes, `0.6.0`), CSV import with consent attestation
  (`POST /api/marketing/audience/contacts/import-csv`, `0.6.1`), HTML email templates with
  plain-text alternative, mandatory postal footer, and Compliance pane
  (`004-marketing-compliance.sql` + `/api/marketing/compliance`, `/templates`,
  `/templates/render`, `/content/:id/approve`, `0.6.2`), the double opt-in sign-up engine
  (`005-marketing-double-optin.sql` + `/api/marketing/audience/signup-forms*`,
  `/api/marketing/audience/opt-in/confirm`, embeddable static-site snippet, and Compliance pane
  controls, `0.6.3`), single-row phone navigation (`0.6.4`), and one-click unsubscribe + broadcast
  pipeline (`006-marketing-broadcasts.sql` + `/api/marketing/broadcasts*`,
  `/api/marketing/audience/unsubscribe`, `/api/marketing/audience/preferences/:contactId`, RFC 8058
  headers, and Broadcasts card in the Compliance pane, `0.6.5`) are DONE under the existing
  `/api/marketing` (`auth: oidc`) mount. Exposing unauthenticated public `POST` endpoints for sign-up
  and RFC 8058 one-click unsubscribe awaits `oshald` anonymous-POST rail support (`anonymousRoutes`
  currently dispatches `GET`/`HEAD` only). Remaining P1 work covers the core Resend connector
  `headers`/batch schema update and inbound delivery-event webhooks.
- **P2 (`0.6.8`, plus `finance` `1.8.5`):** Finance projects (`007-finance-projects.sql`),
  campaign-to-project linking (`009-marketing-finance-link.sql`), the "Create budget" hand-off, and
  reallocation proposals on the weekly review are DONE; manual/Plaid/messaging actuals ingestion
  remains open.
- **P3 (`0.6.6`–`0.6.7`):** sequences with per-recipient state and strict per-sequence standing
  authorization (`007-marketing-sequences.sql`, `0.6.6`), launch plans with dated milestones,
  grounded retros, and unified marketing calendar (`008-marketing-launch-plans.sql`, `0.6.7`) are
  DONE; Switchboard opt-in scheduled publishing and social media attachments remain open.
- **P4 (`0.6.10`):** SMS consent model/sign-up and quiet hours with recipient time zones
  (`011-marketing-sms-consent.sql`) are DONE; US 10DLC carrier registration and inbound STOP/HELP
  webhook remain open.
- **P5 (`0.6.9`):** attribution columns on ingest, UTM capture (`010-marketing-attribution.sql`),
  and email/SMS engagement per campaign are DONE; PostHog bounded stats connector resource (core)
  remains open.

**Open operator decisions** (cost/benefit tables in spec §10): where the audience lives, how sign-ups
are captured, how sequences are authorized, and when SMS registration happens. The items below assume
the recommended option for each and say where a different choice would change them.

---

## How to continue (pickup order)

Read this first; it is the resume point, not a summary. Steps run in order — each one's proof is the
next one's precondition. Commands assume the two checkouts at `C:/Projects/oshal` (core) and
`C:/Projects/oshal-apps` (store).

**Already decided by the operator — do not re-ask** (cost/benefit tables are in spec §10): the
audience lives in oshal's own tables; sign-up is our own public form route with double opt-in; SMS
waits for the business-account move and then Low-Volume Standard 10DLC; sequences run under
per-sequence standing authorization, default OFF.

**State of the work (checked `2026-11-28` against store `main`):** `marketing-engine` is at
`0.6.10` (P0 readiness probes `0.5.0`, P1 audience/CSV/templates/compliance/double opt-in/
unsubscribe/broadcast engines `0.6.0`–`0.6.5`, P3 sequences/standing auth/unified calendar/launch
plans `0.6.6`–`0.6.7`, P2 finance-project link and reallocation proposals `0.6.8`, P5 attribution/
UTM/engagement `0.6.9`, and P4 SMS consent and quiet hours `0.6.10` have all landed).
`marketing-suite` is at `1.1.4` (`active`), while member `brand-graphics` (`1.4.3`) still declares
`status: inactive`. Steps 1 and 2 below are done; resume at verifying `0.6.10` + the group on the
running box (step 3), operator account setup (step 4), and the remaining open P1–P6 items (step 5).

### 1. ~~Land the two open PRs~~ — DONE 2026-09-14
- **Done:** store PR #185 merged as `4e15108`; core PR #431 merged as `b8de2099`.
  `git merge-base --is-ancestor <sha> origin/main` confirms all four SHAs above on their repo's `main`.

### 2. ~~Recreate the api so the marketing env names reach it~~ — DONE 2026-09-14
- **Recreate: done 2026-09-14.** `scripts/oshal-deploy.sh` deployed `b8de2099` (which carries
  `477f3a0b`) and recreated the api; the compose config that run resolved declares all four names on
  the api service.
- **Done-when met 2026-09-14 23:15Z:** `printenv` in `oshal-local-api` lists all four names
  (`GITHUB_TRAFFIC_TOKEN`, `GOOGLE_CONNECT_SCOPES`, `MARKETING_EMAIL_FROM`, `SWITCHBOARD_PUBLISH_EXECUTOR`).
  Compose forwards variables only at RECREATE — a
  `docker restart` will not do it — so a value for `MARKETING_EMAIL_FROM`, `GITHUB_TRAFFIC_TOKEN`,
  `GOOGLE_CONNECT_SCOPES` or `SWITCHBOARD_PUBLISH_EXECUTOR` added to `.env` after that deploy reaches
  the api only at its next recreate.
- **Done when:** `docker exec oshal-local-api printenv | cut -d= -f1 | grep -E 'MARKETING_EMAIL_FROM|GITHUB_TRAFFIC_TOKEN|GOOGLE_CONNECT_SCOPES|SWITCHBOARD_PUBLISH_EXECUTOR'`
  lists every name (names only — never print the values).

### 3. Put marketing-engine 0.6.10 and the group on the box
**State (`2026-11-28`):** store `main` carries `marketing-engine` `0.6.10` (`active`, with
migrations `003`–`011` covering P0 readiness probes through P5 attribution and P4 SMS consent/quiet
hours) and `marketing-suite` `1.1.4` (`active`). Member `brand-graphics` (`1.4.3`) still declares
`status: inactive`, and the group refuses activation unless all six members are active — so the
group cannot activate until that package is released as active (a product decision, not an install
step).

- **Remaining:** ensure `marketing-engine` `0.6.10` is installed on the running stack (applying
  migrations `003`–`011` and mounting the readiness and `/api/marketing/*` routes), and
  install/activate `marketing-suite` (`1.1.4`) once all six members (`marketing-engine`,
  `switchboard`, `social`, `brand-graphics`, `presentations`, `video`) are active.
- **Done when:** `marketing-engine` `0.6.10` is active with migrations `003`–`011` applied,
  `/api/marketing-engine/readiness` answers 200 for a signed-in user,
  `/cockpit/?app=marketing-suite` lands on Setup, and each of the five setup steps reports from its
  member's probe.

### 4. The two steps only the operator can take
- **Remaining:** create one campaign on the board — that alone gives the daily ingest an owner and
  starts the Monday review — then work Checklist A in `docs/business/marketing-engine-runbook.md`
  (Resend account and DNS, sender address, Bluesky app password, GitHub traffic token, the Search
  Console scope plus a Google reconnect, the site analytics provider).
- **Done when:** one Monday review ticket has appeared in the cockpit backlog from a real campaign,
  and the scorecard shows a real row for every source that is connected.

### 5. Then remaining open P1–P6 items
- **Already delivered:** P1 Audience store (`0.6.0`), CSV import with consent attestation (`0.6.1`),
  HTML templates & Compliance pane (`0.6.2`), double opt-in engine (`0.6.3`), one-click unsubscribe
  and broadcast pipeline (`0.6.5`, under `/api/marketing` `auth: oidc`), P3 sequences/standing auth
  (`0.6.6`) and unified calendar/launch plans (`0.6.7`), P2 finance-project link and reallocation
  proposals (`0.6.8`), P5 attribution/UTM/engagement (`0.6.9`), and P4 SMS consent and quiet hours
  (`0.6.10`).
- **Remaining:**
  - **P1 core & public-rail gaps:** extend the Resend connector (`swarm-apps/connectors/resend.yaml`)
    to accept the `List-Unsubscribe` header pair and a batch send (today's action is a single
    recipient with `additionalProperties: false`), mount the existing double opt-in and RFC 8058
    one-click unsubscribe handlers on an `oshald` anonymous-POST rail once available, and add
    signed inbound email delivery-event webhooks (bounces, complaints, deliveries).
  - **P2–P6 open items below:** manual/Plaid/messaging Finance actuals ingestion, Switchboard
    opt-in scheduled publishing and social media attachments, US 10DLC SMS registration and inbound
    STOP/HELP webhook, PostHog bounded stats resource (core), and P6 paid ads connectors/actuals/
    approved budget changes.
- **Done when:** the remaining P1–P6 done-when criteria below are met, starting with a real public
  sign-up completing double opt-in and a confirmed broadcast that reaches only confirmed,
  unsuppressed contacts with DKIM-covered RFC 8058 headers.

**Techniques this work relies on** (re-create them — the scratch copies are gone):
- **Route-table parity** — before touching a route module, capture its table by loading the COMPILED
  module with a `require` stub that returns a Router recording `method + path`, and compare after.
  That is what proved the 974-line split changed no route.
- **Compile canonically** — `scripts/security/rebuild-store-routes.mjs --store <isolated copy> --framework
  <core export>`; whole-store WRITE mode currently stops at `dnd`, so compile one package in an
  isolated copy and copy only that package's emitted `routes/*.js` back.
- **Mutation-check every guard** — re-introduce the exact defect (cap of zero counts as armed, the
  session gate removed, a query-string identity) and confirm the test goes red before trusting it.
- **Commit from a private index** onto the branch tip and push by SHA; the shared checkout is behind
  and dirty with other sessions' work.

---

## P0 — Foundation: visible, configured, safe to extend

### Operator accounts and sending identity
- **Blocked on the operator:** these are account steps only a person can take (runbook Checklist A):
  create the Resend account and verify the sending domain's SPF/DKIM records; choose the From address;
  create a Bluesky app password; optionally create a Mastodon account; set a GitHub traffic token; add
  `webmasters.readonly` to `GOOGLE_CONNECT_SCOPES` and reconnect Google; pick the site analytics
  provider and token; after two weeks of clean DMARC reports, move the business domain from
  `p=none` to `p=quarantine`.
- **Remaining:** the accounts above, then connect each in the hub and set `MARKETING_EMAIL_FROM`.
- **Done when:** each account shows connected in the hub, the Resend domains read reports the sending
  domain verified, and the scorecard shows a real (not NO DATA) row for every connected source.

### Marketing env passthrough has to reach the running container
- **Remaining:** the four names (`GOOGLE_CONNECT_SCOPES`, `MARKETING_EMAIL_FROM`,
  `GITHUB_TRAFFIC_TOKEN`, `SWITCHBOARD_PUBLISH_EXECUTOR`) are declared on the api service in core
  `477f3a0b`, merged to `main` through PR #431 (`b8de2099`) and deployed with it on 2026-09-14; that
  deploy recreated the api from a compose config declaring all four. What is left is the proof
  below, with a real key set.
- **Done when:** `printenv` inside the api lists each name (values never logged), and with a key set
  the daily ingest reports that source `ok` instead of NO DATA.

### Install the Marketing Suite group and marketing-engine 0.6.10 on the box
- **Remaining:** install current store `main` onto the running stack: `marketing-engine` `0.6.10`
  (carries P0 readiness probes from `0.5.0` through P1–P5 migrations `003`–`011`) and the
  `marketing-suite` group (`1.1.4`), whose install resolves its six members fail-closed. The group
  is a front door over apps that are already installed; `brand-graphics` (`1.4.3`, currently
  `status: inactive`), `presentations` and `video` must be active or the install refuses. Then point
  the cockpit at it (`/cockpit/?app=marketing-suite`) and decide whether the default framework
  ribbon's Marketing band stays or gives way to the group.
- **Done when:** the cockpit shows one Marketing front door landing on Setup, each of the five setup
  steps reports from its member's probe for a real signed-in user, the readiness route answers 200,
  and `deployed-apps/marketing-suite/.oshal-install.json` records the installed sha.

### Confirm the 19 route write-classes the closure rule corrected
- **Remaining:** `check-store-security` now classifies a route over its package-local import
  closure, so 19 routes across 14 packages (animatronics, bake-off, cad-studio, career-hunter x2,
  circuit-lab, create, drone-relay, embodied x2, little-monsters x3, pumpkin, scan-to-print,
  sports-edge, trading, venture-plan x2) moved from `no-sql-write` to `machine-write` in the
  reviewed inventory. The classification is now accurate; what is unreviewed is whether each of
  those routes is *meant* to write at the auth mode it declares.
- **Done when:** each of the 19 rows has been read by its package owner and either left as
  machine-write deliberately or tightened, with anything surprising raised as its own item.

### First real campaign and the weekly review ticket
- **Blocked on the operator:** create one campaign on the Board; that alone gives the daily ingest an
  owner and starts the Monday review.
- **Remaining:** the campaign, then one full review cycle.
- **Done when:** one Monday review ticket has appeared in the cockpit backlog from a real campaign and
  was worked only after a human approved it.

## P1 — Audience and compliant email

### ~~Audience store: contacts, recipient consent, lists, suppression~~ — DONE in `0.6.0`
- **Delivered (`0.6.0`):** migration `003-marketing-audience.sql` with `oshal_marketing_contacts`,
  `oshal_marketing_consents` (channel, purpose, status, evidence JSON: `formText`, `recordedAt`,
  `ip`, `userAgent`, `utm`, `tokenHash`), `oshal_marketing_lists`, `oshal_marketing_list_members`,
  and `oshal_marketing_suppressions` (normalized lowercase SHA-256 hash + reason), all exact-owner
  FORCE RLS (`oshal.current_sub`, no operator bypass); session-authenticated `/api/marketing/audience/*`
  routes to list, segment by list/tag/consent state/channel/purpose/suppression/search, manage lists
  and suppressions, export sign-up consent evidence, and delete a contact with its evidence exported
  first.
- **Proven by:** `tests/marketing-audience.test.mjs` (unit, route-table parity, and route handlers)
  and `tests/marketing-audience-rls.test.mjs` (disposable PostgreSQL 16 enforcing-role RLS proof
  across all five tables, sign-up evidence export, and zero-row delete verification).

### ~~CSV import with consent attestation~~ — DONE in `0.6.1`
- **Delivered (`0.6.1`):** pure RFC-4180 CSV parser and consent-attestation normalizer
  (`routes/marketing-audience-csv.js`, bounded to `1 MiB` and `5,000` rows) behind
  `POST /api/marketing/audience/contacts/import-csv`; requires a non-empty consent source (import-level
  `consentSource` or per-row `consent_source`) with atomic `400 consent_source_required` refusal and
  zero writes if any row omits it; stores per-contact consent source and attestation evidence in
  `oshal_marketing_consents.evidence` (surfaced verbatim by `GET /audience/contacts/:id/consent-export`);
  imports every row as `pending` unless it carries documented prior consent (`confirmed` + non-empty
  evidence text + valid ISO-8601 timestamp, downgrading undocumented `confirmed` claims to `pending`);
  and never re-subscribes a suppressed address.
- **Proven by:** `tests/marketing-audience-csv.test.mjs` (RFC-4180 parser, consent-source refusal,
  pending downgrade, documented prior consent, suppression protection, dedupe, invalid rows, list
  ownership, and session auth) and `tests/marketing-audience-rls.test.mjs` (enforcing-role disposable
  PostgreSQL 16 FORCE RLS end-to-end CSV import and cross-owner suppression/list isolation).

### Public sign-up form with double opt-in — engine DONE in `0.6.3` (public anonymous-POST mount awaits kernel rail)
- **Delivered (`0.6.3`):** migration `005-marketing-double-optin.sql` adding
  `oshal_marketing_signup_forms` (per-form 32-byte random `signing_secret` never returned by API,
  consent disclosure text, optional target list, configurable honeypot field, per-IP and per-form
  hourly rate caps, token TTL) and `oshal_marketing_optin_tokens` (SHA-256 hashed single-use
  expirable confirmation tokens, never storing raw tokens), both with exact-owner FORCE RLS
  (`oshal.current_sub`, no operator bypass); pure `marketing-optin-model` (deterministic bounded
  `SlidingWindowRateLimiter`, constant-time HMAC-SHA256 token signer/verifier, honeypot screening,
  UTM capture, generic acknowledgement response, and self-contained HTML-escaped static-site embed
  snippet); owner-scoped `/api/marketing/audience/signup-forms*` and `/api/marketing/audience/opt-in/confirm`
  routes implementing rate limits (`429`), silent honeypot short-circuit (zero DB writes),
  suppression immunity (never re-subscribes or leaks status), `pending -> confirmed` state machine
  with atomic single-use replay protection (`409 token_already_used`), forged (`400`) and expired
  (`410`) refusals, and the Sign-up forms & double opt-in card in the Compliance pane.
- **Proven by:** `tests/marketing-double-optin.test.mjs`, `tests/marketing-double-optin-browser.test.mjs`
  (desktop `1440x900` + phone `412x915`), `tests/marketing-audience-rls.test.mjs` (enforcing-role
  PG 16 FORCE RLS on `005-marketing-double-optin.sql`), and live Blue proof (`0.6.3`).
- **Remaining (kernel boundary):** `oshald`'s `anonymousRoutes` currently dispatches `GET`/`HEAD`
  only, so `0.6.3` keeps all double opt-in routes under the existing `/api/marketing` (`auth: oidc`)
  mount (zero `policy_pending` drift). Once `oshald` adds an anonymous-POST rail (and reviewed
  `store-route-inventory.json` entry), mount the existing submit/confirm pipeline on the public
  POST rail and send confirmation links through the transactional email path.

### One-click unsubscribe and preference page — engine DONE in `0.6.5` (public anonymous-POST mount awaits kernel rail)
- **Delivered (`0.6.5`):** pure signed per-recipient, per-list HMAC-SHA256 unsubscribe tokens
  (`mintUnsubscribeToken` / `verifyUnsubscribeToken` with constant-time `timingSafeEqual`, failing
  closed `unsubscribe_token_forged` on tampered/wrong-owner/wrong-secret tokens) and strict RFC 8058
  header builder (`buildRfc8058Headers` emitting only `List-Unsubscribe` and `List-Unsubscribe-Post`
  and refusing CRLF / non-http(s) URLs) in `marketing-broadcast-model`; owner-scoped
  `POST /api/marketing/audience/unsubscribe` atomically writing normalized `email_hash` to
  `oshal_marketing_suppressions` (`reason: 'one_click_unsubscribe'`, `source: 'rfc8058'`), revoking
  active email consents with `revokedAt` & `revokedVia` evidence, and marking the contact
  `unsubscribed`; plus `GET/PUT /api/marketing/audience/preferences/:contactId` for owner-scoped
  list memberships and channel opt-outs.
- **Proven by:** `tests/marketing-broadcast-unsub.test.mjs`, `tests/marketing-broadcast-browser.test.mjs`,
  `tests/marketing-audience-rls.test.mjs`, and live Blue proof (`0.6.5`).
- **Remaining (kernel boundary):** `oshald`'s `anonymousRoutes` currently dispatches `GET`/`HEAD`
  only, so `0.6.5` keeps `/api/marketing/audience/unsubscribe` under the existing `/api/marketing`
  (`auth: oidc`) mount (zero `policy_pending` drift). Once `oshald` supports unauthenticated public
  `POST` routes, mount the existing token-verified handler on the public RFC 8058 POST rail with no
  cookies and no redirects.

### Resend connector: headers and batch send (core)
- **Remaining:** extend `swarm-apps/connectors/resend.yaml` with a `headers` parameter limited to
  `List-Unsubscribe` and `List-Unsubscribe-Post`, and a batch action with a bounded recipient count;
  both stay confirm-gated and audited. `marketing-broadcast.ts` automatically forwards the validated
  RFC 8058 `headers` pair whenever the loaded Resend spec declares `headers` on `send-email`.
- **Done when:** a delivered test message shows both headers covered by the DKIM signature, and a
  schema test refuses any other header name.

### ~~Broadcast pipeline with the full send gate chain~~ — DONE in `0.6.5`
- **Delivered (`0.6.5`):** migration `006-marketing-broadcasts.sql` adding
  `oshal_marketing_messages` (per-message 32-byte random `signing_secret` never returned by API)
  and `oshal_marketing_deliveries` (one decision row per recipient), both with exact-owner FORCE RLS
  (`oshal.current_sub`, no operator bypass); pure deterministic `planBroadcastDeliveries` gate chain
  enforcing owner email channel consent (`enabled === true`, `daily_cap >= 1`), compliance settings
  & multipart template lint, explicit write confirmation (`confirm: true` -> `428` on live send),
  and per-recipient suppression -> confirmed consent -> daily cap checks with per-recipient signed
  unsubscribe links and RFC 8058 headers; owner-scoped `/api/marketing/broadcasts`,
  `/api/marketing/broadcasts/:id`, and `/api/marketing/broadcasts/:id/send` supporting both dry-run
  audit mode (`{ dryRun: true }`) and confirmed live Resend dispatch (`{ confirm: true }`); and the
  Broadcasts & One-Click Unsubscribe card in the Compliance pane.
- **Proven by:** `tests/marketing-broadcast-unsub.test.mjs` (every gate refusal, mixed-list
  eligibility, one-click suppression & next-run skip, two-owner isolation),
  `tests/marketing-audience-rls.test.mjs` (enforcing-role PG 16 FORCE RLS across migrations `001`–`006`),
  `tests/marketing-broadcast-browser.test.mjs` (`1440x900` & `412x915`), and live Blue proof (`0.6.5`).

### Email delivery events: bounces, complaints, deliveries
- **Remaining:** an `auth: public` webhook route verifying the provider signature; hard bounces and
  complaints create suppressions; deliveries and clicks update `…_deliveries`.
- **Done when:** a real hard bounce and a real complaint each create a suppression, and a forged
  webhook is refused.

### ~~HTML templates with plain-text alternative and postal footer~~ — DONE in `0.6.2`
- **Delivered (`0.6.2`):** pure HTML + plain-text template engine and compliance linter
  (`routes/marketing-templates.js`) with three built-in templates (`announcement`, `newsletter`,
  `launch`), strict HTML escaping, `http(s)`-only CTA and unsubscribe URLs, unremovable sender
  identity + physical postal address + unsubscribe link injected into both HTML and plain-text
  parts; idempotent `template_id`, `html_body`, and `text_body` columns on
  `oshal_marketing_content` (`004-marketing-compliance.sql`); `GET /api/marketing/templates`,
  `POST /api/marketing/templates/render`, and compliance-gated `POST /api/marketing/content/:id/approve`
  (refuses `422` when HTML/plain-text parts, postal footer, or unsubscribe link are missing);
  `POST /api/marketing/drafts` and `personas/campaign-director.yaml` draft email copy into the
  three built-in templates, never raw un-templated HTML.
- **Proven by:** `tests/marketing-templates-compliance.test.mjs` (template rendering, XSS/URL
  guards, compliance linter refusals, approval and publish enforcement) and
  `tests/marketing-audience-rls.test.mjs` (end-to-end PG 16 FORCE RLS approval proof).

### ~~Compliance pane~~ — DONE in `0.6.2`
- **Delivered (`0.6.2`):** migration `004-marketing-compliance.sql` adding
  `oshal_marketing_compliance_settings` with exact-owner FORCE RLS (`oshal.current_sub`, no
  operator bypass); `GET /api/marketing/compliance` and `PUT /api/marketing/compliance` for sender
  identity, reply-to, physical postal address, unsubscribe base URL, and SMS quiet hours; fail-closed
  `publishEmail` gate refusing `422` (`compliance_postal_address_required` /
  `compliance_identity_required` / `template_compliance_failed`) with a `skipped_compliance` ledger
  row and zero Resend calls until identity, postal address, and unsubscribe URL are configured;
  Compliance tab in `tools/marketing-engine.html` (in More menu on phone) with settings form,
  sandboxed HTML + plain-text template preview studio, suppression management, and per-contact
  consent JSON export / export-first deletion.
- **Proven by:** `tests/marketing-templates-compliance.test.mjs`,
  `tests/marketing-compliance-browser.test.mjs` (desktop `1440x900` + phone `412x915`),
  `tests/marketing-audience-rls.test.mjs` (enforcing-role PG 16 FORCE RLS isolation on
  `oshal_marketing_compliance_settings`), and live Blue proof (`0.6.2`).

## P2 — Budget as a finance project

### ~~Finance projects: budget, allocations, actuals (finance package)~~ — DONE in `finance 1.8.5`
- **Delivered (`finance 1.8.5`):** migration `007-finance-projects.sql` adding
  `oshal_finance_projects`, `oshal_finance_project_lines`, and `oshal_finance_project_actuals`
  (sources `manual`, `plaid`, `ads`, `sms`, `email`, `invoice`) with exact-owner FORCE RLS
  (`oshal.current_sub`, no operator bypass); owner-scoped `/api/finance/projects*` routes including
  `/api/finance/projects/:id/summary` (exact integer-cent budget, committed, actual, and variance by
  line and source); and the Projects pane on the Finance surface.
- **Proven by:** `finance/tests/finance-projects.test.mjs`, `finance/tests/finance-projects-rls.test.mjs`,
  and live Blue/Production delivery (`finance 1.8.5`).

### ~~Campaign-to-project link and the "Create budget" hand-off~~ — DONE in `marketing-engine 0.6.8`
- **Delivered (`marketing-engine 0.6.8`):** migration `009-marketing-finance-link.sql` (mirrored at
  lazy DDL) adding `finance_project_id UUID` and `channel_allocations JSONB` onto
  `oshal_marketing_campaigns`; `create-budget-project` offer targeting `finance` in `oshal-app.yaml`
  (`dependencies.optional.apps: [finance]`, zero change to `dependencies.required`); pure
  `buildBudgetProjectPayload` builder (`routes/marketing-budget-model.js`); owner-scoped
  `POST /api/marketing/campaigns/:id/finance-project` and
  `GET /api/marketing/campaigns/:id/budget-summary`; and the **Create budget in Finance** hand-off
  and live Finance summary (`Budget`, `Committed`, `Actual`, `Variance`, channel lines, and
  **Open in Finance** link) inside the expanded campaign detail card in `tools/marketing-engine.html`
  (degrading honestly if Finance is absent).
- **Proven by:** `tests/marketing-budget-p2.test.mjs`, `tests/marketing-budget-p2-browser.test.mjs`
  (`1440x900` & `412x915`), `tests/marketing-audience-rls.test.mjs` (enforcing-role PG 16 FORCE RLS
  across migrations `001`–`009`), and live Blue proof (`0.6.8`).

### Actuals from manual entry, tagged transactions and messaging usage
- **Remaining:** manual actuals; tagging a Plaid transaction to a project line; email and SMS usage
  cost recorded as actuals from the delivery ledger.
- **Done when:** each source adds an actual with its evidence, and a removed tag removes the actual.

### ~~Reallocation proposals on the weekly review~~ — DONE in `marketing-engine 0.6.8`
- **Delivered (`marketing-engine 0.6.8`):** `reallocationProposals()` wired into both
  `POST /api/marketing/campaigns/:id/reallocation-proposals` and the weekly review
  (`routes/marketing-ops-routes.js`) over recorded channel spend (`oshal_finance_project_actuals` +
  `oshal_marketing_events`) and conversions, persisting recommendations as `status = 'proposed'`
  rows in `oshal_marketing_budget_ledger` with `field = 'channel_allocation'` and surfacing them on
  the weekly review ticket and Approvals pane; pure `parseChannelAllocationProposal` and
  `applyChannelAllocationMap` (strict integer cents, refusing floats/negatives/malformed input); and
  atomic `channel_allocation` approval in `decideBudgetProposal` (`routes/marketing-measure.js`,
  428-gated via `confirm: true`) running inside one PostgreSQL transaction (`BEGIN` ... `COMMIT` /
  `ROLLBACK`) that updates `oshal_marketing_campaigns.channel_allocations`, linked
  `oshal_finance_project_lines` / `oshal_finance_projects`, and `oshal_marketing_budget_ledger`
  together so any mid-transaction failure rolls back BOTH ledgers completely.
- **Proven by:** `tests/marketing-budget-p2.test.mjs` (including mid-transaction failure rollback proof),
  `tests/marketing-audience-rls.test.mjs` (real PG 16 atomic commit & rollback proof),
  `tests/marketing-budget-p2-browser.test.mjs`, and live Blue proof (`0.6.8`).

## P3 — Automation and social calendar

### ~~Sequences with per-recipient state~~ — DONE in `0.6.6`
- **Delivered (`0.6.6`):** migration `007-marketing-sequences.sql` adding
  `oshal_marketing_sequences` (per-sequence 32-byte random `signing_secret` never returned by API,
  optional `trigger_form_slug`), `oshal_marketing_sequence_steps` (ordered steps 1..50 with
  `delay_hours` and built-in compliant templates), and `oshal_marketing_enrollments` (per-recipient
  `current_step_order`, `status`, `next_run_at`, and `history` audit trail), all with exact-owner
  FORCE RLS (`oshal.current_sub`, no operator bypass); owner-scoped `/api/marketing/sequences*`
  routes; deterministic `evaluateSequenceStepRun` re-checking recipient suppression and confirmed
  email consent BEFORE EVERY SINGLE STEP (stopping suppressed contacts as `stopped_unsubscribed`
  and unconsented contacts as `stopped_unconsented`); welcome-sequence auto-enrollment hook in
  `POST /api/marketing/audience/opt-in/confirm` (`enrolledSequenceIds`); and the Sequences &
  Standing Authorization card in the Compliance pane.
- **Proven by:** `tests/marketing-sequences.test.mjs`, `tests/marketing-sequences-browser.test.mjs`
  (`1440x900` & `412x915`), `tests/marketing-audience-rls.test.mjs` (enforcing-role PG 16 FORCE RLS
  across migrations `001`–`007`), and live Blue proof (`0.6.6`).

### ~~Standing authorization per sequence~~ — DONE in `0.6.6`
- **Delivered (`0.6.6`):** strict per-sequence `standing_authorization` guard (`isSequenceArmed` &
  `parseStandingAuthInput`): strict boolean `true` only, default OFF on creation, absent row = OFF,
  garbage values (`"true"`, `1`, `"yes"`, `{}`, `null`) rejected `400 invalid_standing_authorization`
  and never arm, arming requires `confirm: true` (`428`) + integer `dailyCap >= 1` (`400` on `0`),
  bounded by `min(seq.daily_cap - seqSentToday, channelRemainingCap)` per day, and instant one-click
  `POST /api/marketing/sequences/:id/disarm` (no confirm dialog) immediately stops all further live
  ticks (`403 sequence_disarmed`).
- **Proven by:** `tests/marketing-sequences.test.mjs`, `tests/marketing-sequences-browser.test.mjs`,
  `tests/marketing-audience-rls.test.mjs`, and live Blue proof (`0.6.6`).

### ~~One calendar for engine and Switchboard items~~ — DONE in `0.6.7`
- **Delivered (`0.6.7`):** idempotent `scheduled_for TIMESTAMPTZ` column on `oshal_marketing_content`
  (`008-marketing-launch-plans.sql` + lazy DDL), pure deterministic `buildUnifiedCalendar` merger
  (`routes/marketing-launch-model.js`) with strict `(source, sourceId)` deduplication and optional
  `from`/`to` date window filtering, read-only `GET /api/marketing/calendar` combining engine
  scheduled content, launch plan dated milestones, broadcasts, and optional owner-scoped
  `oshal_switchboard_scheduled_posts` (degrading cleanly with `switchboardAvailable: false` when
  Switchboard is absent or isolated), and the Unified Marketing Calendar card in `#pane-experiments`.
- **Proven by:** `tests/marketing-launch-calendar.test.mjs`, `tests/marketing-launch-browser.test.mjs`
  (`1440x900` & `412x915`), `tests/marketing-audience-rls.test.mjs` (enforcing-role PG 16 FORCE RLS
  across migrations `001`–`008`), and live Blue proof (`0.6.7`).

### Scheduled publishing under explicit opt-in (switchboard)
- **Remaining:** keep `SWITCHBOARD_PUBLISH_EXECUTOR` as the deployment switch and add a per-owner
  opt-in row; publish only pre-approved items.
- **Done when:** a scheduled post publishes at its time only when both the deployment switch and the
  owner's opt-in are on, and a test proves either one off blocks it.

### Media attachments on social publish (switchboard)
- **Remaining:** replace the 501 `media_attach_unsupported` path with X media upload and LinkedIn
  asset registration; artifacts from video, brand graphics and portrait studio arrive through the
  artifact exchange.
- **Done when:** an image and a short video publish with a post on X and LinkedIn from a real account.

### ~~Launch plan with milestones and a retro~~ — DONE in `0.6.7`
- **Delivered (`0.6.7`):** migration `008-marketing-launch-plans.sql` adding
  `oshal_marketing_launch_plans` (`plan_id`, `owner_sub`, `campaign_id`, `title`, `launch_date`,
  `status`, `milestones`, `checklist`, `retro_markdown`, `retro_facts`, `retro_generated_at`,
  exact-owner FORCE RLS on `oshal.current_sub` with no operator bypass); pure launch plan,
  milestone, and starter `launch-coordinator` asset checklist normalizer plus strictly grounded
  `buildCampaignRetro` citing ONLY recorded DB rows (`oshal_marketing_events`,
  `oshal_marketing_run_ledger`, `oshal_marketing_deliveries`, `oshal_marketing_experiments`, and
  plan completion counts, emitting explicit `NO DATA` where unrecorded — never inventing figures);
  owner-scoped `GET/POST /api/marketing/launch-plans`, `GET/PATCH /api/marketing/launch-plans/:id`,
  and `POST /api/marketing/launch-plans/:id/retro`; and the Launch Plans & Grounded Retros card in
  `#pane-experiments`.
- **Proven by:** `tests/marketing-launch-calendar.test.mjs`, `tests/marketing-launch-browser.test.mjs`
  (`1440x900` & `412x915`), `tests/marketing-audience-rls.test.mjs` (enforcing-role PG 16 FORCE RLS
  across migrations `001`–`008`), and live Blue proof (`0.6.7`).

## P4 — SMS

### US carrier registration on the business account
- **Blocked on the operator:** SMS waits on the business-account move (core BACKLOG "Platform SaaS
  account migration"); then register a Low-Volume Standard 10DLC brand and one marketing campaign in
  Twilio describing opt-in, opt-out and HELP.
- **Remaining:** the registration and a number attached to the campaign.
- **Done when:** the campaign shows approved in Twilio and a test text to the operator's phone is
  delivered without error 30034.

### ~~SMS in the consent model and sign-up~~ — DONE in `0.6.10`
- **Delivered (`0.6.10`):** migration `011-marketing-sms-consent.sql` (mirrored at lazy DDL in
  `src-routes/marketing-sms.ts`) adding idempotent `phone_e164`, `phone_hash`, `timezone`, and
  `timezone_inferred` columns onto `oshal_marketing_contacts` (indexed on `(owner_sub, phone_hash)`)
  and `oshal_marketing_sms_queue` with exact-owner FORCE RLS (`oshal.current_sub`, no operator
  bypass); pure E.164 normalization (`normalizePhoneE164`), mandatory 7-field TCPA/CTIA prior
  express written consent validation (`programName`, `disclosureText`, `frequency`, `helpText`,
  `stopText`, `feeDisclosure`, `recordedAt`), deterministic opt-in confirmation builder
  (`buildSmsOptInConfirmationText`), fail-closed `hasValidSmsConsent` and `evaluateSmsSendGate`,
  and pure CTIA STOP/HELP keyword classifier (`classifyInboundSmsKeyword`); owner-scoped
  `POST /api/marketing/audience/sms-opt-in`, `POST /api/marketing/audience/sms/schedule`,
  `GET /api/marketing/audience/sms/queue`, and `POST /api/marketing/audience/sms/keyword`; and
  the **SMS Consent & Quiet Hours** card in `#pane-compliance`. (Live US 10DLC SMS transmission
  and the public Twilio webhook stay honestly blocked on the operator's Twilio business-account
  migration above.)
- **Proven by:** `tests/marketing-sms-p4.test.mjs`, `tests/marketing-sms-browser.test.mjs`
  (`1440x900` & `412x915`), `tests/marketing-audience-rls.test.mjs` (enforcing-role PG 16 FORCE RLS
  across migrations `001`–`011`), and live Blue proof (`0.6.10`).

### Inbound STOP and HELP
- **Blocked on the operator (live Twilio webhook):** owner-scoped deterministic STOP/HELP keyword
  classification, suppression, consent revocation, and held-queue cancellation shipped in `0.6.10`
  (`POST /api/marketing/audience/sms/keyword`), while the `auth: public` inbound webhook verified
  with `X-Twilio-Signature` waits on the operator's Twilio business-account move and 10DLC number.
- **Remaining:** an `auth: public` inbound webhook in the package, configured on the owner's Twilio
  number, verifying `X-Twilio-Signature`; STOP family keywords (any case) suppress and send one final
  confirmation; HELP answers with the program text.
- **Done when:** STOP from a real handset suppresses within one webhook, HELP answers, and a forged
  request is refused.

### ~~Quiet hours and recipient time zones~~ — DONE in `0.6.10`
- **Delivered (`0.6.10`):** explicit IANA time zone (`timezone_inferred = false`) or NANP area-code
  inferred time zone (`inferTimezoneFromPhone`, `timezone_inferred = true`) stored on
  `oshal_marketing_contacts`; DST-aware clock-controlled `evaluateSmsQuietHours(nowIso, recipientTimezone)`
  enforcing 8 a.m.–9 p.m. recipient-local permitted hours and holding quiet-hours sends in
  `oshal_marketing_sms_queue` (`status = 'held_quiet_hours'`) with the exact UTC ISO `release_at`
  of the next `08:00:00` in the recipient's local time zone.
- **Proven by:** clock-controlled tests in `tests/marketing-sms-p4.test.mjs` (10 p.m. recipient-local
  in `America/New_York` and `America/Los_Angeles` held until exact next 8 a.m. local; 10 a.m. local
  permitted), `tests/marketing-audience-rls.test.mjs`, `tests/marketing-sms-browser.test.mjs`, and
  live Blue proof (`0.6.10`).

## P5 — Attribution and analytics

### ~~Attribution columns on ingest~~ — DONE in `0.6.9`
- **Delivered (`0.6.9`):** pure `extractEventAttribution()` (`routes/marketing-attribution-model.js`)
  parsing `campaign_slug` and `medium` from direct fields, nested `utm`/`meta` objects, and URL
  query parameters (`?utm_campaign=...&utm_medium=...`), wired into `marketing-ops-routes.ts`
  (`gscDateTotals` requesting `['date', 'page']` dimensions and `replaceDayEvents` writing
  `campaign_slug` and `medium` on every `INSERT INTO oshal_marketing_events`, preserving `NULL`
  when unattributed).
- **Proven by:** `tests/marketing-attribution-p5.test.mjs`, `tests/marketing-audience-rls.test.mjs`,
  `tests/marketing-attribution-browser.test.mjs`, and live Blue proof (`0.6.9`).

### ~~UTM capture on sign-up and conversions~~ — DONE in `0.6.9`
- **Delivered (`0.6.9`):** migration `010-marketing-attribution.sql` adding
  `oshal_marketing_conversions` (`conversion_id`, `owner_sub`, `contact_id`, `campaign_slug`,
  `medium`, `source`, `kind`, `amount_cents`, `reference_id`, `utm`, `occurred_at`, exact-owner
  FORCE RLS on `oshal.current_sub` with no operator bypass), automatic first-touch `signup`
  conversion capture in `marketing-optin.ts` on UTM-tagged sign-ups (idempotent across submit and
  confirm), and `POST /api/marketing/attribution/conversions` inheriting immutable first-touch
  `campaign_slug`/`medium`/`source` from prior sign-up consent UTM evidence when not overridden.
- **Proven by:** `tests/marketing-attribution-p5.test.mjs`, `tests/marketing-audience-rls.test.mjs`,
  `tests/marketing-attribution-browser.test.mjs`, and live Blue proof (`0.6.9`).

### ~~Email and SMS engagement per campaign~~ — DONE in `0.6.9`
- **Delivered (`0.6.9`):** idempotent engagement timestamp columns (`clicked_at`, `bounced_at`,
  `complained_at`, `unsubscribed_at`) on `oshal_marketing_deliveries` (`010-marketing-attribution.sql`
  + lazy DDL), `POST /api/marketing/deliveries/:deliveryId/event` (recording engagement events with
  automatic suppression and consent revocation on bounce, complaint, or unsubscribe; foreign owner
  `404`), `GET /api/marketing/attribution/funnel` computing per-campaign visits, first-touch
  conversions/revenue, and `delivered`/`clicked`/`unsubscribed`/`bounced`/`complained` counts with
  explicit `NO DATA` wherever a campaign sent nothing (opens omitted as unreliable), and the
  **Campaign Attribution & Engagement Funnel** card on `#pane-scorecard` in
  `tools/marketing-engine.html`.
- **Proven by:** `tests/marketing-attribution-p5.test.mjs`, `tests/marketing-audience-rls.test.mjs`,
  `tests/marketing-attribution-browser.test.mjs` (`1440x900` & `412x915`), and live Blue proof (`0.6.9`).

### PostHog bounded stats resource (core)
- **Remaining:** a bounded PostHog stats resource in the core connector spec so the ingest can read
  site traffic instead of recording `resource_unavailable`.
- **Done when:** the ingest records a PostHog row for a connected project, and an unconnected owner
  still gets NO DATA.

## P6 — Paid ads

### Ads spend read connectors (core)
- **Remaining:** connector specs and hub entries for Google Ads, Microsoft Advertising, Meta and
  LinkedIn Ads with read-only spend and campaign resources first; registrations under the business
  email per the partner-app registration pattern.
- **Done when:** one real ads account connects and its daily spend reads back through the connector.

### Ads spend as finance actuals
- **Remaining:** the daily ingest records spend per campaign as finance project actuals with the
  platform reference.
- **Done when:** the finance project shows the same spend as the ads account for a real day.

### Ads budget changes only through approved proposals
- **Remaining:** the ads-operator bot-node from ADR-131 plus deterministic write intents that apply an
  approved proposal to the ads account; nothing changes spend without a confirmed proposal.
- **Done when:** a budget change reaches the ads account only after approval, three monthly
  reallocation cycles are recorded, and a test proves an unapproved proposal cannot write.

## Cross-cutting

### Test Lab registration for every new suite
- **Remaining:** register each new package suite and its smoke in the AI Test Lab with
  `regressionTests` levels, keeping locally-tested and live-proven status separate.
- **Done when:** every phase's suites appear in the Test Lab catalog and the phase's live proof is
  recorded next to them.

### Runbook for each phase
- **Remaining:** extend the marketing engine runbook with each phase's operator steps (accounts, DNS,
  registrations, arming and disarming), landed in the same change as the phase.
- **Done when:** an operator can take each phase from zero to its done-when using only the runbook.
