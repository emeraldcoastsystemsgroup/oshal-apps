# Intelligent Communication (email-summarizer) — OSHAL app package

1.4.2 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

**This is the ADR-037 reference comms implementation** — the app the
Communications Swarm ADR describes end-to-end: per-user mailbox connectors, the
`communications-bot` that does the reasoning, and a cockpit surface. Mail and
calendar reads are fixed server operations in this package's routes, spent with
the caller's own connector token; only bounded message metadata and excerpts
reach the bot. Adding a mail provider means a kernel connector plus a fixed read
adapter here, never a new app and never a credential handed to the bot. It was
also the original **codex-packer** emission — the kernel archives the emitted
manifest at `ai-lab/packer-emissions/`.

Read your inbox, see a prioritized "My Day" digest (unread / important /
starred + today's calendar), and let the comms bot summarize your day and draft
replies in your tone, for a Google or an Outlook / Microsoft 365 mailbox, and
list and summarize a Yahoo Mail inbox. The single mutating action — send ("email me a copy") — is `no-send` 428-gated
behind an explicit confirmation.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface" —
only the surface carves):

- **In this package:** the app manifest (ticketType `email-summarizer` + the
  Email Digest Pipeline), the `/api/email` routes (inbox/message/digest reads,
  bot-run `/summary` + `/draft` with the ADR-090 `email-digest` skill-profile
  composition, the confirm-gated `/send`, the Facebook identity tab), the
  surfaces (`tools/email-inbox.html`, `email-my-day.html`, `email-social.html`),
  the app-owned `oshal_email_digests` store (lazy DDL + owner-RLS at the
  chokepoint), and a package copy of the comms-bot persona for the registrar.
- **Stays in the OSHAL kernel:** the communications-bot node (email-bot
  container + both registry blocks + the core `email-summarizer` persona); the
  **email-send machinery** at `@/app/routes/email-routes` — `sendGmail` (with
  the header-injection fence: every header-bound value CRLF-flattened at the ONE
  MIME builder), `sendOutlookMail`, and `summarizeGmailMetadata` — which
  notify-routes, the jarvis brief cron, and other store packages also send
  through (this package imports it rather than forking the builder, so the
  fence covers every packaged send); the `google`/`outlook`/`twilio`/`facebook`
  connectors + the `scripts/oshal-{gmail,outlook,twilio}.js` CLIs (the Twilio
  CLI keeps the kernel-resident `no-send` confirm gate); and the inbox-ingest
  Signals engine (`oshal_inbox_messages`) that the Social package's Signals
  view reads.

## Surfaces

| Tile | URL | What |
|---|---|---|
| My Day | `/api/email/my-day` | Digest dashboard: unread/important/starred + calendar + the bot's summary, with a mailbox switch |
| Inbox | `/api/email/inbox` | Live inbox reader with AI reply drafting, with a mailbox switch |
| Social | `/api/email/social` | Facebook identity tab (read-only public_profile) |
| Accounts | `/utilities` | Connect/disconnect Google / Outlook / Yahoo Mail / Twilio / Facebook (kernel-served) |

## Mailbox providers (1.3.0, Yahoo in 1.4.0)

Every mail route takes `?provider=google|outlook|yahoo`: `/messages`, `/message/:id`,
`/digest`, `/summary`, `/draft` and `/send`. Without it the routes use your first
connected mailbox: Google first (the 1.2.x behavior), then Outlook. Only
`/messages`, `/digest` and `/summary` then fall through to Yahoo; `/message/:id`,
`/draft` and `/send` answer 409 `no_mail_connection` instead. The surfaces show
the same choice as a mailbox switch, remembered per browser.

| Provider | Connect at `/utilities` | Reads | Send |
| --- | --- | --- | --- |
| `google` | Google (gmail.readonly, gmail.send, calendar) | Gmail list/message, Google Calendar today | kernel `sendGmail` |
| `outlook` | Outlook / Microsoft 365 (Mail.Read, Mail.Send, Calendars.Read) | Graph inbox list/message, `calendarView` today | kernel `sendOutlookMail` |
| `yahoo` | Yahoo Mail (address + Yahoo app password) | Inbox list only, through core's fixed read-only IMAP reader (`imapMail`); no calendar | not available (400) |

- Token lookup is the kernel broker (`getValidAccessToken`) for the signed-in
  caller only. A named provider is resolved alone: no fallback to another
  provider or another user's grant.
- Refusals: a provider outside the list is 400 `unsupported_provider`; no session
  is 401; no connection is 409 `no_<provider>_connection` (or
  `no_mail_connection` when none was named); a grant the provider will no
  longer refresh is 409 `reconnect_required`. With `surface=1` the same body
  comes back as `connected: false`.
- The Outlook adapter (`src-routes/outlook-mailbox.ts`) sends only fixed Graph
  v1.0 requests on `/me`. Lists are at most 50 rows and 5 pages, newest first.
  A pagination link off `graph.microsoft.com` is not followed.
- Yahoo is read through core's AppContext `imapMail` seam. Core resolves your
  own app password and signs in to `imap.mail.yahoo.com:993` read-only, and this
  package never holds the password. Opening a message, drafting a reply and
  sending answer 400 `not_supported_for_provider` for Yahoo without contacting
  it. A core without the seam answers 501 `provider_unavailable`. Yahoo 1.4.0
  needs the matching core (the Yahoo connector + `imapMail`).
- The summary and the drafted reply run on `communications-bot` for every
  provider, so cost lands in `chat_tasks` the same way.

A live Outlook connect needs the Azure app registration on the deployment
(`AZURE_EMAIL_APPLICATION_ID`, `OUTLOOK_CLIENT_VALUE`; see the kernel's
`docs/partner-app-registration.md`). The tests below use a recording provider
host, not a real mailbox.

## Install

```bash
node scripts/oshal-app.js install email-summarizer
```

No migrations — `oshal_email_digests` is created lazily at the route's
`ensureEmailSchema` chokepoint with owner-RLS appended. Uninstall/toggle never
touches your digests or your mail.

<!-- 2026-08-05 | maintainer@emeraldcoastsystemsgroup.com | Document fail-closed digest recovery after removal of the public encryption-key fallback. -->

## `SESSION_SECRET` digest recovery

Set a nonblank `SESSION_SECRET` before creating or reading cached summaries. A digest encrypted
under the retired public fallback cannot be authenticated with a newly provisioned secret; use
**Summarize my day** again to replace that cache. Reconnect Google only if the kernel Accounts page
also reports its separately managed connector credential as unreadable.

## Configurable Home summary (1.1.0)

GET /api/email-summarizer/home-summary reads only the caller's saved oshal_email_digests row and decrypts it with the existing package helper. Both data points default on:

| Metric id | Meaning |
|---|---|
| cached-digest | Whether a nonempty, decryptable digest is saved. The first 120 normalized characters appear as a cached excerpt. |
| digest-age | Age of the saved digest's updated_at. This is generation time, not current mailbox freshness. |

No cached row is "Not saved", not an empty inbox. A missing table, missing encryption key, or corrupt ciphertext returns 503. No summary GET calls Gmail/Calendar, generates AI text, dispatches work, or creates schema. Connect a mailbox and generate a digest from email-myday; the Home link opens that same surface. Hiding cached-digest also hides its excerpt and associated highlight.

This manifest requires the matching core metricsPointer support (core PR #411). The matching core and this package were deployed and authenticated Home rendering was verified on 2026-09-10 UTC; see APP-HOME-EXTRACTION-PLAN.md for the rollout record. Validation: 12 compiled-route tests in scripts/home-summary.test.cjs; scripts/home-summary.integration.cjs exercises actual PostgreSQL schemas, owner RLS and SELECT-only source grants, plus Chromium desktop/mobile and saved metric hiding. Run the integration harness from the matching core checkout with HOME_TEST_DATABASE_URL pointing to a disposable localhost database named home_summary_test. It uses mock sign-in and seeded records, not live accounts.

## Test Lab catalog (1.2.1, extended in 1.3.0 and 1.4.0)

[tests/test-lab.yaml](tests/test-lab.yaml) registers every shipped test and preserves the existing `package-readiness` smoke ID. Registration does not execute tests. An authorized operator can run the supported Node suites from the AI Test Lab against a sealed package snapshot; versioned results record the source revision and sandbox cleanup.

| Test entry | Level | Execution boundary |
| --- | --- | --- |
| `tests/session-crypto.test.mjs` | unit | Isolated Node runner; synthetic data only |
| `tests/outlook-mailbox.test.mjs` | unit | Compiled Graph adapter and provider switch with a recording fetch |
| `tests/surface-provider.test.mjs` | unit | Inbox / My Day scripts in `node:vm` with a recording fetch (not a browser receipt) |
| `tests/isolation.core.test.js` | integration | Runs `tests/email-mailbox-isolation.spec.ts` (Vitest) against a framework checkout: real broker, core migrations 060/100/101 with forced RLS on a disposable PostgreSQL, loopback HTTP, and core's real IMAP reader against a loopback IMAP responder |

These tests do not contact accounts, providers or live business records. Surface syntax and stubbed-handler assertions do not claim browser or connector acceptance. Package readiness remains a separate metadata-only probe.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| day-summary | day summary | T2 | none | disable | not yet measured | none recorded |
| reply-draft | reply draft | T2 | none | disable | not yet measured | none recorded |
| comms-ticket | communications ticket | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
