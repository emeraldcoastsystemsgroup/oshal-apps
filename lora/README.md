# lora ("LoRA Studio") — an OSHAL app package

Train and iteratively improve a reusable character (a "sprite") so it stays consistent across
many generated images and short videos. Every trained version is validated on a fixed held-out
matrix and scored objectively — "better" is a number, and the improve loop regenerates data
aimed at the weak cells.

Carved out of OSHAL core 2026-07-17 (ADR-085 Wave 1 carve #3, design: ADR-071). This package is
the app's only home. **First package to exercise the D2 split-mountPath auth shape** (see below).

## What's inside

| Path | What |
|---|---|
| `oshal-app.yaml` | Manifest: the inline lora-director bot, TWO route mounts (split auth), ribbon tile, `indigo` skin, `suite: ai-creative`, migration, `lora-train` workflow. |
| `src-routes/` | TypeScript sources: the router, the vendored box-dispatch (`lora-train-dispatch.ts`), and the vendored scorecard math (`scorecard.ts` — was `src/features/lora-studio/`). |
| `routes/` | **Compiled JS** the loader mounts (`oshal-app build` output). |
| `personas/lora-director.yaml` | The director bot's persona. |
| `tools/lora.html` | The studio surface, served by `GET /api/lora/ui` from this package dir. |
| `migrations/058-lora-studio.sql` | Fresh-install schema with mandatory per-subject ownership and forced row-level security. |
| `migrations/100-lora-owner-rls.sql` | Idempotent upgrade for installations that already recorded migration 058; legacy rows become operator-only rather than being guessed onto a user. |
| `tests/` | Scorecard/dispatch tests plus owner-scoping, callback-attribution, and command-boundary guards. |

## Auth shape (the split-mountPath pattern)

Core mounted one path two ways (public ingest before the OIDC wall + OIDC studio). The loader
forbids mixing auth modes on one mountPath, and its own comment names the sanctioned carve
shape — split the mounts:

- `GET /api/lora/ingest` — a health-only public probe; it neither reads nor mutates
  model data.
- `POST /api/lora/ingest` — the GPU-box callback. It requires both
  `X-Service-Secret` and the canonical base64url `X-Oshal-User-Sub-B64` for the
  exact initiating owner. The external URL is byte-identical to core and the
  internal router path remains `/`. A fleet secret by itself cannot choose a
  character or write another user's result.
- `/api/lora/...` — `auth: oidc` (the studio + surface).

Characters, models, and scorecards are owner-scoped in route predicates and by
forced PostgreSQL RLS. Each authenticated owner gets an isolated starter
character, so identical character subjects can safely exist for different users.
The studio treats callback/database fields as untrusted text, binds actions without
inline JavaScript arguments, and accepts only parsed credential-free HTTP(S) gallery URLs.

## The GPU box

Heavy work never runs on the api: dataset generation + validation drive the box's ComfyUI HTTP
API, kohya training runs via the worker node's **gated `shell.exec`** (ADR-070) through the
shared remote-client registry. Box-side scripts (`train-lora.py`, `validate-lora.py`,
`make-targeted-batch.py`, `overnight-loop.py`) live in the **framework repo's**
`scripts/comfyui-edge/` (shared with Video Studio, deployed to the box's repo clone) — the
vendored dispatch references them by name on the box. Env (deployment-level, documented in the
framework `.env.example`): `LORA_CONTROLLER_URL`, `LORA_EDGE_CLIENT_ID`, `LORA_EDGE_HOSTNAME`
(+ code-read `LORA_BOX_REPO`, `LORA_BOX_VENV_PY`, `LORA_BOX_DATASET`). Note
`LORA_CONTROLLER_URL` is also read as a *fallback* by the apply/profile-studio dispatches —
the name is not lora-exclusive.

Training, validation, and overnight commands carry the owner as a bounded
base64url argument. Every callback reconstructs that exact subject into
`X-Oshal-User-Sub-B64`; credentials and owner identity are never placed in a URL.
The edge worker reads `SWARM_SERVICE_SECRET` from its local process environment;
the fleet credential is never embedded in the durable remote-task command.

## Install

```bash
node scripts/oshal-app.js install lora     # from an OSHAL checkout
```

Ships `status: active` (parity with core — the app was live when carved). Data note: the three
`oshal_lora_*` tables stay in place across the carve (no drop); on a fresh deployment the
package migration creates them.
