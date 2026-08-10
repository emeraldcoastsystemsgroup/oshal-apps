# Switchboard

**Every line, one board.** The merged comms + social command center — Social +
Intelligent Communication + Feeds collapsed into one app, one ribbon, one design
language. The identity is the telephone switchboard: every conversation, from every
platform, routed onto one board by one operator.

Built pane by pane. This package currently ships the **Today** board, the portal
sections (**Inbox / Calendar / Compose**), the **Threads** timeline, the **Stage**
broadcast composer, the **Streams** publishing desk, the **Workspaces** organizer,
and a durable confirmed Gmail reply outbox.

## Workspaces (shipped — [ADR-113](https://github.com/emeraldcoastsystemsgroup/open-shal/blob/main/docs/adr/113-switchboard-aggregation-surface-and-workspaces.md))

The professional model: you run several identities at once (your business, a client, a
personal presence, more than one mailbox). A **workspace** is a named brand/identity desk
grouping a set of your connected accounts; Switchboard scopes the whole board to whichever
one you pick.

This is **app-owned state, not a connector-framework field** — two Switchboard tables
(`oshal_switchboard_workspaces` + `oshal_switchboard_workspace_accounts`, owner-RLS at the
lazy-DDL chokepoint, membership keyed on `oshal_connections.connection_id`). You organize
them in the **Workspaces** surface (`GET /organize`): create / rename / recolor / delete a
desk and toggle which connected accounts belong to it. CRUD lives at `/workspaces*` +
`/accounts`; only the caller's own connections can ever join a workspace.

> Multi-account-per-provider (two Gmails) needs the connector framework's
> `UNIQUE (user_sub, provider)` relaxed — deferred; the `connection_id`-keyed model already
> accommodates it.

## Portal sections (shipped)

Each section is a self-contained route module (`src-routes/switchboard-<section>-routes.ts`) +
surface, mounted under its own prefix by `switchboard-routes.ts`. Every read takes an optional
`?workspace=<id>` scope.

- **Inbox** (`/inbox`, `/inbox/items`) — unified triage across the inbox store + live **Outlook**
  (Microsoft Graph) + **Slack** (`slack-client`), read-only, workspace-scoped. Normalized to the
  same item shape as the Today `/feed`.
- **Calendar** (`/calendar`, `/calendar/posts` + POST/PATCH/DELETE) — the content pipeline over an
  app-owned `oshal_switchboard_scheduled_posts` table (owner-RLS). Ships the model + CRUD + a
  week-grid surface **and the scheduled-time executor**: an in-package loop publishes due posts
  (`status='scheduled'`, `scheduled_at <= now()`) through the same publish path Compose uses,
  recording `published` / `failed` (+ the error; a failed post does not re-fire) per attempt.
  **OFF by default** — arming it is an explicit operator opt-in (`SWITCHBOARD_PUBLISH_EXECUTOR=true`;
  cadence `SWITCHBOARD_PUBLISH_INTERVAL_MS`, 30s floor, 60s default). Until armed, scheduled posts
  simply wait and stay publishable by hand from Compose.
- **Compose** (`/compose`, `/targets`, `/variants`, `/image`, `/publish`) — write once → per-platform
  variants written **on the communications-bot** (`executeBotOrInline`, cost captured — no controller
  LLM) → real **image generation** (the video-generation storyboard image provider) → **publish**
  the exact approved text to X / LinkedIn via the connector token, behind the `no-post` explicit-write
  confirmation gate.
- **Threads** (`/threads`, `/threads/items`) — one chronological timeline per **counterpart**:
  everything already ingested into the shared inbox store (mail + inbox-fed social mentions) folded
  per person. Identity is the package's existing model — the from-address email when present, display
  name otherwise; bulk/no-reply senders never form a thread. The timeline remains a deterministic,
  workspace-scoped read with no LLM. A Gmail row exposes a reply composer backed by the confirmed
  outbox below; social rows remain read-only. The pure aggregation lives in
  `switchboard-threads-model` (guarded by the package suite).
- **Stage** (`/stage`, `/stage/broadcast`) — the broadcast fan-out composer: write once, pick target
  channels from the connected set (the surface reads Compose's own `/targets`), tailor per channel
  (Compose's `/variants`, on the bot) or send as-is, then **one confirmed action** fans the exact
  approved texts out through Compose's exported `publishTo` — the SAME publish path Compose and the
  calendar executor use, never a parallel rail. Per-channel isolation: one failed channel records its
  error and the rest still send. Every send requires the explicit `no-post` confirm; Stage adds no
  scheduler (scheduled sends stay behind the Calendar executor's opt-in flag). The pure fan-out lives
  in `switchboard-stage-fanout` (guarded by the package suite).

## Streams — the CMS publishing desk (shipped)

The operator's call (2026-08-09): publishing must work like a real CMS — the pattern of the
editorial system built for the JMN client — except the publish targets already exist, so
Streams manages content and lands on Compose's confirm-gated `publishTo`, never a parallel rail.

- **One post entity** (`oshal_switchboard_stream_posts`, owner-RLS) moving through the 8-state
  editorial machine: `draft → in_review → approved → scheduled → published`, with `rejected`,
  `failed`, and `archived`; every legal action is table-driven in the pure
  `switchboard-streams-model` (guarded by the package suite).
- **Per-channel variants** (`…_stream_variants`) for x / linkedin / facebook / instagram / threads,
  each carrying its own publish outcome (`published` / `failed` + error / honest `skipped
  no_binding` for the copy-paste-only platforms). Variant drafting rides the EXISTING Compose
  `/variants` bot endpoint — no LLM in the Streams controller path.
- **A revision per edit** (`…_stream_revisions`): the prior content is snapshotted before every
  PATCH; edits are allowed only in `draft`/`in_review` — anything later must reopen.
- **Fail-closed publish**: `confirm: true` or 428; any publishable variant empty/over-limit rejects
  the whole publish before anything sends; channels then send independently; a claim CAS
  (`publish_claimed_at`) makes a double-fire or concurrent executor tick unable to double-post.
- **Scheduling** shares the Calendar executor's opt-in switch (`SWITCHBOARD_PUBLISH_EXECUTOR`) —
  one flag governs all outward scheduled publishing in this package; until armed, scheduled posts
  wait and stay publishable by hand.
- **Imports** fold the older stores in idempotently ((user_sub, source, source_ref) unique):
  the LinkedIn assistant's judged drafts (score + rationale carried over) and Content Studio drafts.

## Confirmed reply outbox (shipped locally)

`POST /replies/outbox` accepts only an exact reply body, an owned Gmail source message id,
`confirm: true`, and a mandatory `Idempotency-Key`. The server derives the recipient and
subject from that caller-owned inbox row; callers cannot turn the route into an arbitrary-recipient
mail endpoint. Recipient, subject, body, and source id are owner-key encrypted before the durable
row is inserted. `GET /replies/outbox` and `GET /replies/outbox/:id` return content-free status only.

The executor claims with PostgreSQL `FOR UPDATE SKIP LOCKED`, then resolves the caller's Google token
immediately before reusing the kernel's single fenced `sendGmail` implementation. A repeated request
with the same key and content returns the original row even if the source inbox row was later pruned.
Reusing a key for changed content is `409`; each worker claim also decrypts and re-hashes every
send-affecting field before touching a provider, so a plaintext/ciphertext mutation fails closed.
If a process loses a claim or a provider result is ambiguous, the row becomes `uncertain` and is
never blindly resent; the provider API has no downstream idempotency key, so safety requires manual
review. Delivery is enabled for already-confirmed rows by default and can be paused with
`SWITCHBOARD_REPLY_EXECUTOR=false`. This code has local boundary tests; it does not claim a live
Gmail acceptance run or deployment.

The earlier portal pane set was built in parallel (research → build → adversarial-verify, 3/3
passed), then integrated + compiled + deployed as one package. The reply-outbox addition described
above remains a locally verified change until it clears the normal protected-branch and deployment
workflow.

## Today (shipped)

A single, prioritized, time-ordered stream of everything that needs you right now,
pulled from the stores the kernel already fills and normalized onto one board:

| Source | Where it comes from | Shown as |
|---|---|---|
| **Gmail** | `getValidAccessToken(pool, sub, 'google')` — the caller's own inbox | mail that looks like it **needs a reply** (unread + not bulk); time-sensitive ones flagged. The bulk/automated remainder is counted as **"handled by bot"**, never shown. |
| **Calendar** | `calendar.readonly` on the same Google connection | today's upcoming meetings |
| **Social signals** | `oshal_inbox_messages` (`category='social'`), filled by the framework inbox-ingest cron | mentions/DMs from LinkedIn / X / Facebook, platform inferred from the sender domain |

The board is **read-only data-access** (ADR-036): the route normalizes + ranks +
buckets; it calls **no LLM**. Ranking prose and reply drafting run on the
communications-bot in later slices. Reads are scoped to the caller's own connection —
no DB creds leave the route.

### Design

The surface (`tools/switchboard-today.html`) is built entirely on the framework theme
tokens (`/shared/ui/css/surface-themes.css` + `surface-glass.css`). Every colour is
derived from a framework token with a standalone fallback, so the board is native to
all 11 cockpit themes and still renders if opened on its own. Platform brand marks
(Gmail/LinkedIn/X/Facebook/SMS/Voice/Calendar) are the only fixed colours.

## Routes

`createSwitchboardRoutes(ctx)` → mounted at `/api/switchboard` (requiresAuth):

- `GET /today` — the Today board surface (also `GET /`).
- `GET /feed` — the unified board JSON. `?surface=1` returns a graceful
  `{ connected: false }` payload (instead of a 409) when Google isn't connected, so the
  surface can show a "connect your accounts" hero.

## Reused, not rebuilt (framework-resident, ADR-093)

- the **communications-bot** node (container + registry block `b0…0001` + core persona
  — the copy in `personas/` is for the registrar);
- the **inbox-ingest Signals engine** (`oshal_inbox_messages`) this board views;
- the per-user connector broker + the google/outlook/twilio/linkedin/twitter/
  meta-business/facebook connectors.

## Roadmap (next slices)

- **Multi-source ingest** — generalize inbox-ingest to native Outlook / Telegram / Slack /
  X / LinkedIn adapters so "one board" is literal, not Gmail-shaped. This is also what widens
  **Threads** past the Gmail-fed store (today its timeline covers what the store has ingested:
  mail + inbox-fed social notifications — not live DM/text/call legs) and lets its identity
  grouping graduate to the ADR-100 person model.
- **Reply provider parity + assisted drafts** — the durable confirmed path currently covers
  Gmail rows already present in the shared inbox store. Outlook/social reply adapters and
  communications-bot drafting (with cost captured) remain separate follow-ups.
- **Stage media** — attaching a generated image to a fan-out publish (blocked on the same
  X media/upload + LinkedIn asset-register follow-ups Compose's `/publish` documents).
- **Carve/retire** the three predecessor packages once the panes are signed off.

## Tests

Dependency-free `node --test` suites in [`tests/`](tests/) run in store-CI (plain node, no
install) against the **compiled** `routes/*.js` — the same bytes the framework mounts: the
Stage fan-out core (one compose → one submission per channel, per-channel failure isolation,
twitter→x alias folding), the Stage route's send gates (no confirm → 428 and the publisher is
never invoked; workspace mismatch sends nothing), the Threads aggregation (email-first
identity, chronological ordering, bulk exclusion, honest counts under caps), the reply outbox
(confirmation-before-I/O, source-owned recipient binding, encryption, semantic idempotency,
atomic claims, and terminal ambiguous outcomes), and a classic-script parse guard over every
surface's inline `<script>` (the world 1.0.1 lesson).
