# Vids Studio (vids) — OSHAL app package

Turn an idea into generated video. The **vids-operator** (Veo specialist) drives
Google Vids by CLICKING, in a remote operator's logged-in Chrome, via the
`@oshal/vids-operator` desktop worker deployed as a remote-client node (ADR-073/
074). `POST /api/vids/jobs` dispatches a clip generate-job to the registered
worker; `POST /api/vids/story` dispatches a multi-scene Extend STORY
(`content.produce` / `content.next` — the ADR-080 cycler); `/api/vids/app` is the
self-contained job-queue surface behind the cockpit tile.

Carved out of OSHAL core 2026-07-19 (ADR-085 Wave 3, "skill with a surface"):

- **In this package:** the `/api/vids` routes (job/story dispatch + the embedded
  job-queue surface, `auth: service-or-oidc` — the same posture core server.ts
  mounted). Browser requests use their authenticated subject. In-container
  `vids_generate` / `creative_*` calls must send both `X-Service-Secret` and the
  canonical base64url `X-Oshal-User-Sub-B64` owner assertion; machine
  authentication alone never grants access to a user's queue. The package also
  contains the `vids_generate` tool, the manifest
  (ticketType `vids` + the studio pipeline), a package copy of the vids-operator
  persona for the registrar, migration 059 for fresh installs, and migration 100
  for owner/RLS upgrades on existing installs.
- **Stays in the OSHAL kernel:** the SHARED **vids-operator remote-client desktop
  worker** (`packages/oshal-vids-operator`) with its registry entries in BOTH
  `swarm-bot-registry` blocks — all four vids-family apps (vids, creative-studio,
  video, daily-trade-recap) reference it; the ADR-080 Extend-story content
  library + production engine (it lives in the worker's `content.*` tools); the
  remote-client registry/mesh these routes enqueue into; `scripts/oshal-vids.js`
  (the CLI); and kernel migration 059.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Vids Studio | `/api/vids/app` | Job queue + submit form + worker presence (self-served by this package) |

The `creative-studio` store app declares this app as a dependency and tiles the
same surface (story jobs land in `vids_jobs` too).

Every job and deferred worker settlement is bound to the initiating subject.
`vids_jobs` uses forced row-level security, list responses expose only that
owner's rows, and terminal worker payloads are reduced to bounded prompt/status
fields rather than persisting arbitrary remote output or error content. Dispatch
options are allowlisted and every job-table cell is HTML-escaped before rendering.

## Install

```bash
node scripts/oshal-app.js install vids
```

Requires `APP_PACKAGE_DYNAMIC_ROUTES=1` (the ADR-085 route mounter) and a running
Vids worker on a machine with a screen + signed-in Chrome:

```bash
npx @oshal/vids-operator chrome   # debug Chrome on a dedicated profile
npx oshal-vids worker             # register with the swarm + poll for jobs
```

Without a registered worker, `POST /api/vids/jobs` returns 503 and the surface
shows "no worker registered".

Kernel CLI calls also require a non-empty `OSHAL_USER_SUB`; the CLI encodes it
into `X-Oshal-User-Sub-B64` and fails closed before making a request when the
identity or service secret is absent.
