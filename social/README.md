# Social (social) — OSHAL app package

Draft, review, and publish across your networks from one surface (ADR-036/038):
connect LinkedIn / X / Facebook Pages at `/utilities`, then the comms bot drafts a
post in your voice, you review it, and publishing goes out on your per-user
connector token. Nothing posts until you click Publish (the `no-post` 428 gate).
The Signals view reads your social-notification emails (LinkedIn / X / Facebook)
straight from your connected inbox, so nothing is missed on a busy day.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 2, "skill with a surface" — only
the surface carves):

- **In this package:** the app manifest (ticketType `linkedin-content` + the
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

## Install

```bash
node scripts/oshal-app.js install social
```

No migrations — the Signals feed reads the shared `oshal_inbox_messages` store and
connected-account state; nothing in Postgres is app-owned. Uninstall/toggle never
touches your posts or notifications.
