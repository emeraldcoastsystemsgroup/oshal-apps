# Vids Studio (vids) — OSHAL app package

1.5.4 declares the `package-anonymous-routes` opt-in for `GET` and `HEAD` on `/:token/video.mp4` under `/api/vids-public`, allowing published finished-video bytes to be fetched anonymously under application authorization enforcement while maintaining strict 401 gate protection across all control, job, and un-opted routes. 1.5.3 added the company audience view beside the family one (ADR-164 D6). Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

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
  persona for the registrar, migration 059 for fresh installs, migration 100
  for owner/RLS upgrades, and migration 101 for finished-artifact publication.
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

### Family view (Home shell)

The Home shell opens `/api/vids/app?audience=family`. The page then loads the
shared audience-view kit (ADR-164 D6) right after its theme bootstrap and shows
the signed-in account's own saved videos in plain words: how many are waiting or
being made (one count, because the summary route counts queued and running
together), finished in the last five days and not finished, whether the video
maker (the registered Vids worker) is ready, and the newest eight clips, story
videos and brand graphics with where each one stands. A finished video whose
export is attached opens its private preview in a new tab. Signed out, refused,
a count that could not be checked, a failed list read and an unreachable server
each read as what they are. One action and the kit's escape open Vids Studio in
the cockpit.

On open the view reads only `GET /api/vids/jobs?limit=9`, `/api/vids/home-summary`
and, for each finished video shown, `/api/vids/jobs/:jobId/artifact`. It never
dispatches a clip, story or brand job, never attaches, publishes, revokes or
removes an export, binds no control, does not poll, adds no handoff listener and
fetches no connected-actions offer: the page's inline start and module script run
only when no audience view renders. Without `?audience=` the full page runs
unchanged.

Tests: `node --test vids/tests/audience-view.test.cjs` (the static kit contract,
the served template, the family view over a stub kit and fetch, and the gated
full-page start) and, from the store root,
`OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs vids`
(headless Chromium over the served page and the real kit).

Every job and deferred worker settlement is bound to the initiating subject.
`vids_jobs` uses forced row-level security, list responses expose only that
owner's rows, and terminal worker payloads are reduced to bounded prompt/status
fields rather than persisting arbitrary remote output or error content. Dispatch
options are allowlisted and every job-table cell is HTML-escaped before rendering.

## Finished export and public publication

The worker's completed MP4 is not treated as a controller path or as public merely
because a job is done. In Vids Studio, an owner attaches the finished MP4 through
the job's **Finished export** control. The controller validates a complete MP4
container with a video track, stores it under an immutable generated artifact id,
and records its digest and byte length under the exact job owner. The private
preview remains owner-authenticated.

The owner must explicitly confirm publication and review the returned SHA-256
digest. Publication creates a random revocable token that serves only that MP4
through `/api/vids-public/<token>/video.mp4`; it grants no job, listing or control
access and is never cached. **Revoke** clears the token immediately. Removing an
export requires confirmation and requires revocation first. The artifact table is
forced-RLS and the public reader uses a transaction-local token predicate, not an
operator or owner identity.

This is a handoff boundary: no render, provider call, Drive read, or worker-local
path is performed by the controller. The user supplies the completed export after
the remote worker has produced it. See `tests/vids-publication.spec.ts` for the
real disposable PostgreSQL, multipart HTTP, filesystem and Chromium proof.

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

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| clip-generate | Veo clip | T2 | hosted | disable | not yet measured | none recorded |
| story-produce | multi-scene story | T2 | hosted | disable | not yet measured | none recorded |
| brand-graphic | brand graphic | T2 | hosted | disable | not yet measured | none recorded |
| vids-ticket | vids ticket | T4 | hosted | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
