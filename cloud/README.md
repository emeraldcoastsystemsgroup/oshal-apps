# Cloud (cloud) — OSHAL app package

Inspect and operate your Google Cloud by chat. Connect GCP at `/utilities` (web
OAuth, cloud-platform scope); the **cloud-ops-bot** runs `scripts/oshal-gcp.js` (and
the private cost/health diagnostics CLI) with YOUR connector token and reasons over
the real Cloud REST API responses — the API-based replacement for gcloud that works
for a remote user. Read-only by default; scheduled cloud ops ride the `cloud-op`
ticket queue.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the app manifest (ticketType `cloud-op` + the Cloud Op
  workflow + the Cloud Accounts tile onto `/utilities`) and a package copy of the
  cloud-ops-bot persona for the registrar. A THIN carve — the app never owned a
  route or html in the kernel.
- **Stays in the OSHAL kernel:** the cloud-ops-bot **node** (own container,
  registered in both `swarm-bot-registry` blocks), the GCP tool chain
  (`scripts/oshal-gcp.js`, `scripts/oshal-gcp-diag.js`, the
  `any-bot/server/services/tools/gcp/` toolkit), the `gcp` connector + per-user
  token broker (`OSHAL_CRED_GCP`), and the `/utilities` connectors hub.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Cloud Accounts | `/utilities` | Connect/disconnect GCP (kernel connectors hub) |

The app's interface is **chat with the cloud-ops-bot** (`/cockpit/?app=cloud`,
defaultView chat) plus the Tickets queue for scheduled `cloud-op` runs.

## Install

```bash
node scripts/oshal-app.js install cloud
```

No routes and no migrations — the surface is the kernel `/utilities` hub and the
bot's chat; the queue mapping (`cloud-op` → cloud) comes from this manifest at load.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **64 / 256 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| cloud-op | cloud operation ticket | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
