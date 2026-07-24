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
