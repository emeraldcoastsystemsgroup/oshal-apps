# Switchboard

**Every line, one board.** The merged comms + social command center — Social +
Intelligent Communication + Feeds collapsed into one app, one ribbon, one design
language. The identity is the telephone switchboard: every conversation, from every
platform, routed onto one board by one operator.

Built pane by pane. This package currently ships the **Today** board, the portal
sections (**Inbox / Calendar / Compose**), the **Threads** timeline, the **Stage**
broadcast composer, and the **Workspaces** organizer.

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
  name otherwise; bulk/no-reply senders never form a thread. Read-only first slice, workspace-scoped,
  no LLM. The pure aggregation lives in `switchboard-threads-model` (guarded by the package suite).
- **Stage** (`/stage`, `/stage/broadcast`) — the broadcast fan-out composer: write once, pick target
  channels from the connected set (the surface reads Compose's own `/targets`), tailor per channel
  (Compose's `/variants`, on the bot) or send as-is, then **one confirmed action** fans the exact
  approved texts out through Compose's exported `publishTo` — the SAME publish path Compose and the
  calendar executor use, never a parallel rail. Per-channel isolation: one failed channel records its
  error and the rest still send. Every send requires the explicit `no-post` confirm; Stage adds no
  scheduler (scheduled sends stay behind the Calendar executor's opt-in flag). The pure fan-out lives
  in `switchboard-stage-fanout` (guarded by the package suite).

Built in parallel (research → build → adversarial-verify, 3/3 passed), then integrated + compiled +
deployed as one package.

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
- **Thread actions** — reply/draft from inside a thread (on the communications-bot, cost
  captured); the first slice is deliberately read-only.
- **Stage media** — attaching a generated image to a fan-out publish (blocked on the same
  X media/upload + LinkedIn asset-register follow-ups Compose's `/publish` documents).
- **Carve/retire** the three predecessor packages once the panes are signed off.

## Tests

Dependency-free `node --test` suites in [`tests/`](tests/) run in store-CI (plain node, no
install) against the **compiled** `routes/*.js` — the same bytes the framework mounts: the
Stage fan-out core (one compose → one submission per channel, per-channel failure isolation,
twitter→x alias folding), the Stage route's send gates (no confirm → 428 and the publisher is
never invoked; workspace mismatch sends nothing), the Threads aggregation (email-first
identity, chronological ordering, bulk exclusion, honest counts under caps), and a
classic-script parse guard over every surface's inline `<script>` (the world 1.0.1 lesson).
