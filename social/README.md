# Social (social) — OSHAL app package

1.5.3 adds the family audience view beside the company one (ADR-164 D6): Jarvis (the Home shell) opens this package's first surface with `?audience=family`, and the shared kit paints the same account-scoped card in the family grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

Draft, review, and publish across your networks from one surface (ADR-036/038):
connect LinkedIn / X / Facebook Pages at `/utilities`, then the comms bot drafts a
post in your voice, you review it, and publishing goes out on your per-user
connector token. Nothing posts until you click Publish (the `no-post` 428 gate).
The Signals view reads your social-notification emails (LinkedIn / X / Facebook)
straight from your connected inbox, so nothing is missed on a busy day.

**LinkedIn publishing runs on the kernel's declared connector action** (`create-post` on
`swarm-apps/connectors/linkedin.yaml`), not on a call this package makes itself: the parameters
are checked against the declared schema before any credential work, the approval gate is the
shared risky-write one, the credential is your own brokered token, and a `connector_action_audit`
row is committed **before** the post is sent — if that audit trail is unavailable the publication is
refused (503) rather than made unrecorded. X and Facebook Pages still publish through their own
connector tokens in this package; neither connector declares a write action yet.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 2, "skill with a surface" — only
the surface carves):

- **In this package:** the app manifest (ticketType `linkedin-content-post` + the
  LinkedIn Content Assistant workflow), the `/api/social` routes (Workspace +
  Composer draft/publish with the confirm gate, the Signals feed read + AI
  organize, Facebook Pages stream + publish, X timeline + follow), the surfaces
  (`tools/social-workspace.html`, `social-signals.html`, `social-composer.html`,
  `facebook-stream.html`), and a package copy of the comms-bot persona for the
  registrar.
- **Stays in the OSHAL kernel:** the communications-bot node (comms container +
  both registry blocks + core `email-summarizer` persona) and the social-writer
  node (`a0…0040`, the ticket workerBot); the **Signals engine** — the
  inbox-ingest cron that fills `oshal_inbox_messages` (category=`social`) from the
  connected Gmail, which this app's Signals view reads; the
  `linkedin`/`twitter`/`meta-business` (+ `facebook`, `google`) platform
  connectors; and the kernel-resident **LinkedIn AI Content Assistant** at
  `/api/linkedin-assistant` (draft→judge→refine→approve state machine + its own
  `no-post` gate), onto which this app's "LinkedIn Assistant" tile is a view.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Workspace | `/api/social/workspace` | Who to engage (left) + draft/refine/publish (right) |
| LinkedIn Assistant | `/api/linkedin-assistant/panel` | The kernel-resident content assistant (draft→approve→publish) |
| Signals | `/api/social/signals/ui` | Inbox-fed social notifications + AI-organized briefing |
| Accounts | `/utilities` | Connect/disconnect LinkedIn / X / Facebook (kernel-served) |

## Queue-backed LinkedIn posts

`POST /api/social/linkedin-content-queue` creates an owner-scoped `linkedin-content-post`
ticket with a bounded citation list. The manifest registers that ticket type with
`pipeline: manifest-worker` and `workerBot: social-writer`; the kernel's queue binding admits
only that registered shape, so the pipeline key is part of the contract, not a default. The installed queue worker binds that ticket to the
kernel LinkedIn Assistant, persists a graded `pending-approval` draft with the ticket and
citations attached, and leaves publishing behind the existing human approval plus confirmation
gate. `GET` on the same path lists only the caller's queue tickets. A missing LinkedIn connection
still produces a truthful scheduled/blocked outcome; no provider result is invented.

## Install

```bash
node scripts/oshal-app.js install social
```

No migrations — the Signals feed reads the shared `oshal_inbox_messages` store and
connected-account state; nothing in Postgres is app-owned. Uninstall/toggle never
touches your posts or notifications.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **128 / 512 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| post-draft | post draft | T2 | none | disable | not yet measured | none recorded |
| signals-briefing | weekly signals briefing | T2 | none | disable | not yet measured | none recorded |
| daily-social-digest | daily digest | T3 | none | disable | not yet measured | none recorded |
| linkedin-content-post | LinkedIn post ticket | T2 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
