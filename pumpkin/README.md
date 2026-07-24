# Pumpkin (pumpkin) — OSHAL app package

Animated talking jack-o'-lantern Halloween prop (?app=pumpkin). A full-screen
procedural pumpkin face is projected INTO an inflatable pumpkin — glowing eyes and
a mouth that lip-syncs to speech. Two modes: **mimic** (mic → browser STT → the
pumpkin says your line back; pure voice I/O, no LLM) and **autonomous** (a guest
speaks and pumpkin-bot — the inline agent `...054` — replies in character via
`executeBotOrInline`, so cost lands in `chat_tasks`). Two topologies: all-in-one
(the projector page captures, thinks, speaks) and paired (the projector registers
a room + SSE-subscribes; a phone remote pushes speak/preset/mode events). Input
endpoints honor the optional `PUMPKIN_ALLOWED_SUBS`/`PUMPKIN_ALLOWED_EMAILS`
allowlist; everything is owner-scoped by OIDC sub.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the app manifest (the Pumpkin tile + focus ribbon), the
  `/api/pumpkin` routes (control surface + paired remote, presets CRUD, last-used
  settings, autonomous chat, and the bundled preset/reply/room engine with SSE
  stream + pushes), the two
  surfaces (`tools/pumpkin-app.html`, `tools/pumpkin-remote.html`), a package
  copy of the pumpkin-bot persona for the registrar (the manifest deliberately
  declares NO `bots:` block — the inline node `...054` is already registered in
  core, and re-declaring it would double-register the agent), and a migrations/
  copy of `084-pumpkin-platform.sql` so fresh installs create the tables at load.
- **Stays in the OSHAL kernel:** the full-screen **projector framework page** at
  `/pumpkin/` (`src/pages/pumpkin` via `server-ui-assets` — carved apps keep
  their framework page mounts), the pumpkin-bot **inline node** (both
  `swarm-bot-registry` blocks + the `ai-lab` persona; it rides api rebuilds),
  the kernel migration `scripts/migrations/084-pumpkin-platform.sql`, the voice
  pipeline (`/api/voice/*`), and the default Pumpkin tile in
  `oshal-framework.json`.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Pumpkin | `/api/pumpkin/app` | Control surface: preset + mode, save looks, pair a projector room (self-served by this package) |
| (remote) | `/api/pumpkin/remote` | Phone remote for the paired topology (self-served by this package) |
| (projector) | `/pumpkin/` | Full-screen projector page (kernel framework page) |

## Public browser demo

Pumpkin remains server-side read-only for anonymous guests. The control surface detects a guest
session and runs its showcase controls locally instead: look editing and saved looks use browser
storage, Say/Ask use browser speech plus deterministic zero-cost character replies, and the
control/projector/remote tabs communicate through a same-browser channel. This makes the public
demo fully tappable without creating database rows, spending LLM or voice tokens, allocating
server rooms, or reaching an operator's signed-in projector.

The copied demo-remote link is intentionally same-device/same-browser. Cross-device projector
pairing and autonomous AI use the authenticated, owner-scoped room/API path and require sign-in.

## Install

```bash
node scripts/oshal-app.js install pumpkin
```
