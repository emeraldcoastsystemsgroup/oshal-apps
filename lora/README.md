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
| `migrations/058-lora-studio.sql` | The app's schema (3 tables + seed), idempotent; applied via `app_package_migrations`. The route also carries the identical lazy `ensureLoraSchema` (belt-and-braces, matches core). |
| `tests/lora-scorecard.spec.ts` | Scorecard math unit spec (run against a checkout with the package present). |

## Auth shape (the split-mountPath pattern)

Core mounted one path two ways (public ingest before the OIDC wall + OIDC studio). The loader
forbids mixing auth modes on one mountPath, and its own comment names the sanctioned carve
shape — split the mounts:

- `POST/GET /api/lora/ingest` — `auth: public`, router self-guards on `x-service-secret`
  (the GPU box's callback; **the external URL is byte-identical to core**, internal router
  paths moved to `/`). Expect the loader's loud ANONYMOUS-CALLABLE warn at load — intended.
- `/api/lora/...` — `auth: oidc` (the studio + surface).

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

## Install

```bash
node scripts/oshal-app.js install lora     # from an OSHAL checkout
```

Ships `status: active` (parity with core — the app was live when carved). Data note: the three
`oshal_lora_*` tables stay in place across the carve (no drop); on a fresh deployment the
package migration creates them.
