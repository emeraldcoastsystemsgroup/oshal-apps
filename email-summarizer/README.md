# Intelligent Communication (email-summarizer) — OSHAL app package

**This is the ADR-037 reference comms implementation** — the app the
Communications Swarm ADR describes end-to-end: a per-user Gmail connector, a
**codex** bot (`communications-bot`) that runs `scripts/oshal-gmail.js` itself in
its sandbox, and a cockpit surface. Adding a mail provider = a connector + a
`scripts/oshal-<provider>.js` CLI in the kernel (outlook and twilio already
follow it), never a new app. It was also the original **codex-packer** emission —
the kernel archives the emitted manifest at `ai-lab/packer-emissions/`.

Read your inbox, see a prioritized "My Day" digest (unread / important /
starred + today's calendar), and let the comms bot summarize your day and draft
replies in your tone. The single mutating action — send ("email me a copy") —
is `no-send` 428-gated behind an explicit confirmation.

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
| My Day | `/api/email/my-day` | Digest dashboard: unread/important/starred + calendar + the bot's summary |
| Inbox | `/api/email/inbox` | Live inbox reader with AI reply drafting |
| Social | `/api/email/social` | Facebook identity tab (read-only public_profile) |
| Accounts | `/utilities` | Connect/disconnect Google / Outlook / Twilio / Facebook (kernel-served) |

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

## Test Lab catalog (1.2.1)

[tests/test-lab.yaml](tests/test-lab.yaml) registers every shipped test and preserves the existing `package-readiness` smoke ID. Registration does not execute tests. An authorized operator can run the supported Node suites from the AI Test Lab against a sealed package snapshot; versioned results record the source revision and sandbox cleanup.

| Test entry | Level | Execution boundary |
| --- | --- | --- |
| `tests/session-crypto.test.mjs` | unit | Isolated Node runner; synthetic data only |

These tests do not contact accounts, providers or live business records. Surface syntax and stubbed-handler assertions do not claim browser or connector acceptance. Package readiness remains a separate metadata-only probe.
