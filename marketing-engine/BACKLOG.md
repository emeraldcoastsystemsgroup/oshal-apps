# marketing-engine — BACKLOG (marketing suite)

Open work to take the marketing suite end to end: position → plan → budget (a finance project) →
produce → publish (social, email, SMS) → capture → nurture → measure → reallocate → retro. The design,
the as-built table and the operator decisions are in the
[marketing suite spec](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/apps/marketing-suite-spec.md);
prices and compliance sources are in the
[market scan](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/business/marketing-suite-market-research.md).
Every entry has a done-when so scope does not have to be guessed later. Items owned by another package
or by core say so; core items need operator approval before they start.

**Posture:** campaigns, owner consent gates, manual publishing to LinkedIn/Mastodon/Bluesky, the
scorecard and budget proposals run today. Nothing sends to a list, nothing texts a customer, and no
budget is tied to finance yet. Every outward action stays opt-in and default OFF.

**P0 is merged in both repos** (store `4b8984e5` through PR #185, merged 2026-09-14 as `4e15108`;
core `477f3a0b` through PR #431, merged 2026-09-14 as `b8de2099` and deployed from that commit):
marketing-engine 0.5.0 carries three readiness probes (first campaign, an armed channel, a
configured sender) behind `/api/marketing-engine/readiness`, and `marketing-routes.ts` is split into
five modules with all 20 routes unchanged. `marketing-suite` 1.0.0 is the ADR-141 group front door
(12 borrowed tiles, a five-step setup dashboard). The store's write-class ledger now follows a
route's package-local import closure, which also corrected 19 routes across 14 packages that
delegate their SQL to sibling modules. What remains in P0 is step 3's proof on the running box and
the two operator steps below.

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

**State of the work (checked 2026-09-14 against git and the core deploy log):** both PRs are merged.
Core `477f3a0b` + `eae041ab` reached `main` through PR **#431** (merge `b8de2099`), and
`scripts/oshal-deploy.sh` deployed `b8de2099` (image `1fe73566ae87`, api + 34 bots recreated). Store
`4b8984e5` + `1f405b7` reached `main` through PR **#185** (merge `4e15108`). Step 1 is done and step
2's recreate is done; resume at step 2's done-when, then step 3.

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

### 3. Put marketing-engine 0.5.0 and the group on the box
**State 2026-09-14 23:15Z (read from the box, nothing changed):** `swarm_applications` holds
`marketing-engine` 0.5.0 `active` and `marketing-suite` 1.0.0 `inactive`; the member `brand-graphics` 1.1.0 is
`inactive` because its store manifest declares `status: inactive` (the same line is on the installed copy),
and the group refuses activation unless all six members are active — so the group cannot activate until
that package is released as active, which is a product decision, not an install step.

The box must be healthy first: `docker ps --filter name=oshal-local-api` shows `Up (healthy)`. As of
2026-09-14 it was Exited (255) with the host overcommitted; that recovery belongs to the ops thread,
and `scripts/oshal-up.sh` is the ordered bring-up.
- **Remaining:** stage the package LF-exact from git (never from the shared working tree, which runs
  behind and carries other sessions' edits), then load the group:
  ```
  cd /c/Projects/oshal-apps
  SHA=$(git rev-parse origin/main)            # after step 1
  git -c core.autocrlf=false archive $SHA marketing-engine \
    | docker exec -i oshal-local-api sh -c 'rm -rf /tmp/stage && mkdir -p /tmp/stage && tar -x -C /tmp/stage'
  # back the current copy up OUTSIDE deployed-apps, carry .oshal-install.json across (update sha +
  # installedAt), swap the directory, then hash-verify every file against its git blob
  docker restart oshal-local-api              # a NEW route module only mounts at boot
  ```
  Install `marketing-suite` the way packages are installed on this box (the Applications page, or the
  same stage-and-load path): its six members — marketing-engine, switchboard, social, brand-graphics,
  presentations, video — must all be active or the install refuses by design.
- **Done when:** the boot log shows one `App loaded` for each of the two, `/api/marketing-engine/readiness`
  answers 200 for a signed-in user, `/cockpit/?app=marketing-suite` lands on Setup, and each of the five
  setup steps reports from its member's probe.

### 4. The two steps only the operator can take
- **Remaining:** create one campaign on the board — that alone gives the daily ingest an owner and
  starts the Monday review — then work Checklist A in `docs/business/marketing-engine-runbook.md`
  (Resend account and DNS, sender address, Bluesky app password, GitHub traffic token, the Search
  Console scope plus a Google reconnect, the site analytics provider).
- **Done when:** one Monday review ticket has appeared in the cockpit backlog from a real campaign,
  and the scorecard shows a real row for every source that is connected.

### 5. Then P1, in this order
- **Remaining:** the audience store, CSV import, the public sign-up form with double opt-in, one-click
  unsubscribe, the broadcast pipeline, delivery events, templates and the compliance pane — the P1
  items below, in that order. One core dependency comes first: the Resend connector must accept the
  `List-Unsubscribe` header pair and a batch send (core `swarm-apps/connectors/resend.yaml`), because
  today's action is a single recipient with `additionalProperties: false`.
- **Done when:** P1's own done-when criteria below are met, starting with a real sign-up completing
  double opt-in and a broadcast that reaches only confirmed, unsuppressed contacts.

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

### Install the Marketing Suite group and marketing-engine 0.5.0 on the box
- **Remaining:** install store `4b8984e5` onto the running stack: marketing-engine 0.5.0 (new
  readiness route — the api must restart for a new route module) and the `marketing-suite` group,
  whose install resolves its six members fail-closed. The group is a front door over apps that are
  already installed; `brand-graphics`, `presentations` and `video` must be active or the install
  refuses. Then point the cockpit at it (`/cockpit/?app=marketing-suite`) and decide whether the
  default framework ribbon's Marketing band stays or gives way to the group.
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

### Audience store: contacts, recipient consent, lists, suppression
- **Remaining:** migration 003 with `oshal_marketing_contacts`, `…_consents` (channel, purpose,
  status, evidence JSON: form text, time, IP, user agent, UTM, token hash), `…_lists`,
  `…_list_members`, `…_suppressions` (normalized hash + reason), all owner FORCE RLS; routes to list,
  segment by list/tag/consent state, and delete a contact with its evidence exported first.
- **Done when:** an RLS test on the enforcing role proves another owner reads zero rows from every
  table, a deleted contact leaves no row behind, and the consent export shows the evidence recorded
  at sign-up.

### CSV import with consent attestation
- **Remaining:** import that requires the owner to state the consent source, stores it per contact,
  imports every row as `pending` unless the file carries documented prior consent, and never
  re-subscribes a suppressed address.
- **Done when:** a test import proves suppressed addresses stay suppressed, rows without a consent
  source are refused, and every imported contact carries its source.

### Public sign-up form with double opt-in
- **Remaining:** an `auth: public` POST route per form slug with per-IP and per-form rate limits, a
  honeypot field, UTM capture, a `pending` consent row, and a signed single-use confirmation link sent
  through the transactional path; the confirm route flips consent to `confirmed`. Embeddable snippet
  for the static sites.
- **Done when:** a real sign-up from a phone completes double opt-in; forged, replayed and expired
  tokens are refused by tests; the route is a reviewed row in the store route inventory; the form
  answers nothing but an acknowledgement.

### One-click unsubscribe and preference page
- **Remaining:** a signed per-recipient, per-list token; RFC 8058 POST endpoint (no cookies, no auth,
  no redirect) and a visible unsubscribe page; both write a suppression and revoke the consent at once.
- **Done when:** a real mailbox's one-click unsubscribe suppresses the contact within that request,
  the next broadcast skips it, and token-forgery tests fail closed.

### Resend connector: headers and batch send (core)
- **Remaining:** extend `swarm-apps/connectors/resend.yaml` with a `headers` parameter limited to
  `List-Unsubscribe` and `List-Unsubscribe-Post`, and a batch action with a bounded recipient count;
  both stay confirm-gated and audited.
- **Done when:** a delivered test message shows both headers covered by the DKIM signature, and a
  schema test refuses any other header name.

### Broadcast pipeline with the full send gate chain
- **Remaining:** `oshal_marketing_messages` + `…_deliveries`; sending walks owner channel consent →
  recipient consent confirmed → not suppressed → domain verified → compliance lint (postal address,
  unsubscribe link and headers) → daily cap → approval → batched send; every step writes the run
  ledger, including skips.
- **Done when:** a broadcast to a real list reaches only confirmed, unsuppressed contacts; each gate
  has a refusal test; the ledger shows one row per recipient decision.

### Email delivery events: bounces, complaints, deliveries
- **Remaining:** an `auth: public` webhook route verifying the provider signature; hard bounces and
  complaints create suppressions; deliveries and clicks update `…_deliveries`.
- **Done when:** a real hard bounce and a real complaint each create a suppression, and a forged
  webhook is refused.

### HTML templates with plain-text alternative and postal footer
- **Remaining:** a small template set (announcement, newsletter, launch) rendered to HTML plus a
  generated text part; the owner's postal address and unsubscribe link are injected and cannot be
  removed; campaign-director drafts into a template, never around it.
- **Done when:** every marketing send carries both parts, the footer, and the link; a test proves a
  template without them cannot be approved.

### Compliance pane
- **Remaining:** one settings pane for sender identity and postal address, suppression management,
  consent export, contact deletion, and (P4) SMS quiet hours; sends are refused until identity and
  address are set.
- **Done when:** a broadcast is refused with a clear reason while the address is empty, and succeeds
  after it is set.

## P2 — Budget as a finance project

### Finance projects: budget, allocations, actuals (finance package)
- **Remaining:** in the finance package, `oshal_finance_projects`, `…_project_lines` and
  `…_project_actuals` (source manual, plaid, ads, sms, email, invoice) with owner FORCE RLS; an
  owner-scoped summary route (budget, committed, actual, variance by line) and a project pane on the
  finance surface.
- **Done when:** a project with lines and actuals shows correct budget vs actual, and an RLS test on
  the enforcing role proves isolation.

### Campaign-to-project link and the "Create budget" hand-off
- **Remaining:** marketing offers `create-budget-project`; finance accepts it, creates the project
  from the campaign's name and budget, and returns its id; the campaign stores `finance_project_id`
  and its surface reads the finance summary route in the same session.
- **Done when:** creating a budget from a campaign produces a finance project, and both surfaces show
  the same numbers.

### Actuals from manual entry, tagged transactions and messaging usage
- **Remaining:** manual actuals; tagging a Plaid transaction to a project line; email and SMS usage
  cost recorded as actuals from the delivery ledger.
- **Done when:** each source adds an actual with its evidence, and a removed tag removes the actual.

### Reallocation proposals on the weekly review
- **Remaining:** call the existing `reallocationProposals()` from the weekly review with real channel
  costs; proposals land as `proposed` ledger rows; approving one updates the finance lines and the
  decision ledger in one transaction; accept the `channel_allocation` field the apply path rejects
  today.
- **Done when:** a review ticket carries a proposal from real numbers, and approving it changes both
  ledgers atomically (a failure test proves neither changes on error).

## P3 — Automation and social calendar

### Sequences with per-recipient state
- **Remaining:** `oshal_marketing_sequences`, `…_sequence_steps`, `…_enrollments`; each step
  re-checks consent and suppression before it sends; a sign-up can enroll into a welcome sequence.
- **Done when:** step two reaches only contacts still consented, and an unsubscribe between steps
  stops the rest.

### Standing authorization per sequence
- **Remaining:** make the inert `standing_authorization` real for sequences only: armed explicitly
  per sequence, strict `true` only, bounded by the daily cap, with a one-click disarm; absent row
  means OFF.
- **Done when:** an armed sequence runs without per-email clicks within its cap, a disarmed one sends
  nothing further, and a garbage value never arms it.

### One calendar for engine and Switchboard items
- **Remaining:** a calendar view listing scheduled engine content and Switchboard posts together, with
  the launch plan milestones.
- **Done when:** items scheduled in either app appear once on the same calendar with their status.

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

### Launch plan with milestones and a retro
- **Remaining:** a launch plan on the campaign with dated milestones on the calendar, the asset
  checklist from launch-coordinator, and a retro note that reads the campaign's numbers.
- **Done when:** a real launch has its milestones on the calendar and a retro citing only recorded
  numbers.

## P4 — SMS

### US carrier registration on the business account
- **Blocked on the operator:** SMS waits on the business-account move (core BACKLOG "Platform SaaS
  account migration"); then register a Low-Volume Standard 10DLC brand and one marketing campaign in
  Twilio describing opt-in, opt-out and HELP.
- **Remaining:** the registration and a number attached to the campaign.
- **Done when:** the campaign shows approved in Twilio and a test text to the operator's phone is
  delivered without error 30034.

### SMS in the consent model and sign-up
- **Remaining:** add `sms` to the channel set; SMS sign-up captures prior express written consent
  with the TCPA/CTIA evidence fields and sends the opt-in confirmation (program name, HELP, frequency,
  fees).
- **Done when:** an SMS consent row holds every evidence field, and a number without one is never
  sent to (test).

### Inbound STOP and HELP
- **Remaining:** an `auth: public` inbound webhook in the package, configured on the owner's Twilio
  number, verifying `X-Twilio-Signature`; STOP family keywords (any case) suppress and send one final
  confirmation; HELP answers with the program text.
- **Done when:** STOP from a real handset suppresses within one webhook, HELP answers, and a forged
  request is refused.

### Quiet hours and recipient time zones
- **Remaining:** store each contact's time zone (explicit, or inferred from the number and marked as
  inferred); hold any marketing text outside 8 a.m.–9 p.m. recipient-local.
- **Done when:** a send scheduled at 10 p.m. recipient-local waits until 8 a.m., proven by a
  clock-controlled test.

## P5 — Attribution and analytics

### Attribution columns on ingest
- **Remaining:** the daily ingest writes `campaign_slug` and `medium` (the columns exist; the INSERT
  omits them) wherever the source can attribute.
- **Done when:** a UTM-tagged visit in Search Console or site analytics appears under its campaign on
  the scorecard.

### UTM capture on sign-up and conversions
- **Remaining:** the sign-up route stores the UTM set on the consent evidence; conversions (sign-up,
  purchase through the payments app) record the first-touch campaign.
- **Done when:** a sign-up from a tagged link and a test purchase each show their campaign on the
  funnel.

### Email and SMS engagement per campaign
- **Remaining:** delivered, clicked, unsubscribed, bounced and complained counts per campaign from the
  delivery ledger; opens are shown as unreliable if shown at all.
- **Done when:** the scorecard shows those counts for a real broadcast, and NO DATA for a campaign
  that sent nothing.

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
