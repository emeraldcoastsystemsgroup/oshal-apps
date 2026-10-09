# Spaces (spaces) — OSHAL app package

0.9.2 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

<!--
CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Clarified that this installed package is the sole
  | Spaces surface source after removal of the unrouted kernel HTML copies and Compose binds.
2 | maintainer@emeraldcoastsystemsgroup.com | 0.7.1: both multipart lanes re-enter the caller RLS request identity
  | after multer (uploads over one socket chunk were refused by the strict GUC pool); guard
  | tests/upload-identity.core.test.js; the surfaces suite stripper no longer trips on video/*.
3 | maintainer@emeraldcoastsystemsgroup.com | 0.8.0: Spaces -> embodied. GET /scans/:id/scene builds a ready
  | scan into an embodied hidden scene (obstacle boxes from the splat, metres, z-up); /scenes lists
  | them as ADR-139 provides artifacts; the surface tags each ready scan as a scene source.
4 | maintainer@emeraldcoastsystemsgroup.com | 0.9.0: POST /scans/import gates a .ply by size while it
  | streams (import-upload-gate.ts): over OSHAL_SPACES_PLY_MAX_BYTES the part stops being written at
  | the first chunk past the gate and the lane answers 413 naming the limit, so an oversized capture
  | never reaches the kernel converter. A 117 MB .ply had collapsed the Docker VM. .splat keeps the
  | 300 MB ceiling; guard tests/ply-import-off-loop.core.test.js. Needs a core carrying the
  | spatial-mapping limits export.
5 | maintainer@emeraldcoastsystemsgroup.com | 0.9.1: the family audience view for the Home shell (ADR-164 D6).
  | /api/spaces/app?audience=family paints the account's saved scans from GET /home-summary alone
  | through the shared kit; the page's main and connected-actions scripts are gated on the kit's
  | decision. Guards tests/audience-view.test.cjs + tests/audience-view.fixture.cjs; new Lab catalog
  | tests/test-lab.yaml (manifest gains testing: and uses: test-catalog).
-->

Turn a real space into an explorable 3D scene, then reason over it (`?app=spaces`,
ADR-111). Film a walkthrough clip, **import** a finished capture from an iPhone/iPad
Pro LiDAR scan / depth sensor / drone photogrammetry app (`.ply`/`.splat`), or fly a
**sim-drone** scan orbit — all three flow the same pipeline into a Gaussian-splat
scene you walk in a WebGL viewer. Get live **walk/pan** guidance on a phone HUD while
you film, and paint a Wi-Fi/RF **coverage overlay** onto the ready map. All scans are
owner-scoped; the reconstruction itself is deterministic I/O — no LLM in the pipeline.
The **spaces-operator** inline concierge only BRIEFS scans and DRAFTS capture guidance;
it never runs a reconstruction.

Carved out of OSHAL core (ADR-085, "skill with a surface" — ADR-093):

- **In this package:** the app manifest (`uses: spatial-mapping` + the Spaces tile),
  the `/api/spaces` routes (the surface/viewer/capture HTML serve, owner-scoped scan
  upload/import/list/read/delete, the streamed `.splat` artifact + poses, the RF
  coverage overlay, the deterministic capture-plan, the phone-HUD capture + telemetry
  sink, and the sim-first drone scan), the three surfaces (`tools/spaces.html`,
  `tools/spaces-viewer.html`, `tools/spaces-capture.html`), and a package copy of the
  spaces-operator persona for the registrar.
- **Stays in the OSHAL kernel:** the reconstruction **engine** + owner-scoped scan
  store (`@/features/spatial-mapping` — `SpatialMappingService`, the Sim + Edge
  reconstruction providers, the import engine, pose persistence, `RfOverlayService`,
  and the capture-plan / drone-scan pattern generators), a **PINNED kernel skill**
  (`spatial-mapping`) this package declares in `uses:` and resolves from the running
  framework's dist at mount time; the spaces-operator **inline concierge node** (both
  `swarm-bot-registry` blocks + the `ai-lab` persona); and the sim-drone helper
  (`@/features/drone` `SimDroneProvider` + `validateMission`) the drone-scan mission
  flies — kernel-resident via the drone node-server pin (imported here at runtime, but
  NOT a declarable kernel-skill id, so it is not in `uses:`).

## `uses: spatial-mapping`

This app imports the reconstruction engine from the framework rather than bundling it.
`uses: [spatial-mapping]` is validated **fail-closed** at load against the kernel-skill
registry (`src/shared/kernel-skills/registry.ts`) — the id must be exactly
`spatial-mapping`. The CI kernel-skill guard keeps `@/features/spatial-mapping` in the
built image for as long as any installed app declares it.

## Surfaces

| Tile | URL | What |
|---|---|---|
| Spaces | `/api/spaces/app` | The Spaces home: capture/import/drone-scan, scan list, brief |
| (embedded) | `/api/spaces/viewer` | Self-contained WebGL splat viewer |
| (phone) | `/api/spaces/capture` | Live guided-capture HUD (walk vs pan arrows); remembers its session for the upload |

## Family audience view (0.9.1)

The Home shell opens the surface as `/api/spaces/app?audience=family` (ADR-164 D6). The shared kit
(`/shared/ui/js/app-view.js`, loaded right after the theme bootstrap) paints the signed-in account's own saved
scans in plain words: how many real spaces are ready to explore (imported scans and video builds), how many
practice rooms there are (the sim engine's made-up rooms, not measured), how many scans are being built and how
many did not finish, a title that names the account's state, and up to three of the most recently updated scans
as tiles saying how each was made and where it stands. On open it makes exactly one read, `GET /home-summary`, an
owner-scoped SELECT under the caller's session that the full page's evidence panel already makes. It never reads
the scan or scene list (`GET /scans` and `GET /scenes` run the orphaned-scan self-heal, an UPDATE), a scan's
dimensions, scene, artifact or geometry (each reads the whole model file), the viewer or a capture plan, and it
never uploads, imports, flies a drone scan, computes coverage or mounts connected actions. Tiles carry no link or
action; the one action and the escape open Spaces in the cockpit. Signed out, refused, a count the route could not
check, a scan query it could not run, the route's own failure, an unreadable answer and an unreachable server are
each named. Any other request runs the full page unchanged; its main script and its connected-actions script run
only when the kit renders no view.

```bash
node --test spaces/tests/audience-view.test.cjs
OSHAL_FRAMEWORK=<core checkout> node scripts/audience-views.browser.cjs spaces
```

The first runs from the store root with no browser: the static kit contract, the view's behaviour over the
package's real `GET /home-summary` route (express stubbed, a stub pool), and the gates of both page scripts. The
second drives `tests/audience-view.fixture.cjs` over the real page and the real kit in headless Chromium. The first
is registered as the `audience-view` case of the Lab catalog (`tests/test-lab.yaml`).

## A scan is anchored to where it was captured (0.10.0)

A scan made after a guided capture is recorded with where it was captured, so it can be found again by
position on a later visit
([ADR-169](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/169-location-places-and-proximity.md)
slice L7, `uses: location`).

1. The guided capture page (`/api/spaces/capture`) posts its readings, GPS included when the phone allows
   it, to `POST /api/spaces/capture-telemetry` under a session id, and remembers that id in the browser.
2. The upload that follows (`POST /api/spaces/scans` or `POST /api/spaces/scans/import`) carries the id
   in the optional text field `captureSessionId`, when the capture was within the last two hours. An
   optional `placeId` names a saved place to group the scan under.
3. The route registers the scan naming its session, the kernel joins that session's GPS to the scan, and
   the kernel's `anchorMap` records the anchor: the most accurate fix as the origin, the heading the
   capture began with, and a footprint from how far the fixes spread.

The upload answers `anchor` beside `scan`, with ids and a reason and never a coordinate:

```json
{ "scan": { "id": "…", "status": "queued" }, "anchor": { "anchored": true, "anchorId": "…", "placeId": null } }
```

| `anchor.reason` | The scan was registered without an anchor because |
|---|---|
| `no_capture_session` | the upload named no capture session |
| `no_capture_gps` | the session recorded no GPS fix (indoors, or location was not allowed) |
| `location_precision_stores_no_coordinates` | your location precision is place-only, which stores no coordinates |
| `location_not_found` | the `placeId` is not a place of yours or your groups |
| `location_invalid_input` | the `placeId` is not an id |
| `location_principal_required` | the caller is not a signed-in person with a verified issuer (a phone pairing token, for instance) |
| `anchor_failed` | the anchor could not be written; the log names the scan and the error class |

The anchor is stored by the kernel at the precision class you chose in Settings, Location (block by
default), and only you read it. The simulated drone scan is not anchored: it is not a capture of a place.

`tests/spaces-capture-session.test.js` runs both surfaces' own scripts and proves the session reaches the
upload. `tests/capture-anchor.core.test.js` drives the compiled route over loopback HTTP with the kernel's
real telemetry sanitizer, sidecar and capture reader (`OSHAL_CORE_DIR=<framework checkout>`); the scan
store and `anchorMap` are recorded there, and the kernel's own suites prove what is stored and who reads it.

## Importing a pre-built capture (`POST /api/spaces/scans/import`)

`.ply` and `.splat` both arrive on the multipart `model` field. They are **not** gated alike: a
`.splat` is a packed artifact the viewer streams, so it keeps the lane's 300 MB ceiling, while a
`.ply` has to be parsed into gaussians before anything can be shown — the expensive step that once
ran on the api's event loop and, at 117 MB, took the whole box out.

So the lane carries a second, per-format gate. A `.ply` over
`OSHAL_SPACES_PLY_MAX_BYTES` (framework configuration, default 50 MiB) stops being written at the
first chunk past the limit and the request answers `413` naming it:

```json
{ "error": "model_too_large", "format": ".ply", "maxBytes": 52428800, "maxLabel": "50 MB",
  "receivedBytes": 52494336, "message": "a .ply import may be at most 50 MB (52428800 bytes); reduce the capture or export a .splat" }
```

The oversized part is never fully received, written, or parsed, and no scan row is created. Under
the gate, the kernel converts the `.ply` in a worker thread (`OSHAL_SPACES_PLY_WORKER_HEAP_MB`), so
the api keeps serving while the import runs and a conversion that overruns its heap fails that one
scan instead of the process. `tests/ply-import-off-loop.core.test.js` drives both sides of the gate
over real loopback HTTP and samples `/health` throughout the conversion.

## Spaces → embodied (a scan the drone simulation can fly)

A ready scan is also offered as an **embodied hidden scene** (ADR-151 D3/Q3: the world model is
the Spaces scan). `GET /api/spaces/scans/:id/scene` reads the caller's own `.splat`, maps the
capture into embodied's frame (metres, z-up, floor at 0), voxelises the gaussian positions and
merges the occupied voxels into axis-aligned obstacle boxes, and places the drone home / base park
on the clearest open floor. The reply is `{ scene, stats, scanId, title }` where `scene` is plain
data in the embodied `Scene` shape (room, obstacles, empty surfaces/objects/zones/appliances) and
`stats` records every decision (`up`, `scale`, `unit`, `resolutionM`, `boxes`, `floorClearanceM`).

| Query | Meaning |
|---|---|
| `up=auto\|y\|-y\|z` | Which source axis points up. Spaces' own frame is +Y; 3DGS exports are often −Y. `auto` puts the dense floor at the bottom. |
| `scaleM=<n>` | Explicit scale multiplier (overrides the rest). |
| `ceilingM=<n>` | For a non-metric capture, the vertical extent is fitted to this height (default 2.4). |
| `maxBoxes=<n>` | Box cap (default 1500); the covering coarsens 5 → 10 → 15 → 20 → 30 cm until it fits. |
| `minPoints=<n>` | Gaussians per voxel below which a voxel is noise (default 2). |
| `download=1` | Serve as an attachment (`scan-<id>.scene.json`). |

`GET /api/spaces/scenes` lists the caller's ready scans as artifacts of type
`application/vnd.oshal.embodied-scene+json` (the manifest `artifacts.provides` entry), and the
Spaces surface tags every ready scan with the ADR-139 source attributes, so the shared 📤 chip
offers the scene to any destination that accepts that type. The embodied side of the contract is
an `artifacts.accepts` entry (`mode: post`) whose endpoint redeems the handle, runs its own
`validateScene`, and registers the scene per owner as a scenario the world can reset from.
`tests/spaces-embodied-scene.test.js` proves the converter against the compiled module.

The surfaces are self-contained except for the framework-served shared UI
(`/shared/ui/...`, root-relative same-origin) — consumed read-only, same as every
cockpit surface.

## Install / uninstall

```bash
node scripts/oshal-app.js install spaces
node scripts/oshal-app.js uninstall spaces
```

No migrations — the owner-scoped scan store is created lazily by the spatial-mapping
service at first use (`runRuntimeSchemaBootstrap` + owner RLS at the chokepoint).

## Package source of truth

The carve was reconciled on 2026-07-20 and the historical unrouted kernel HTML copies and local
Compose binds have been removed. Routes and surfaces are maintained only in this package:

- Core has no active Spaces route. `src-routes/spaces-routes.ts` here is the maintained source,
  including the `/pair` mobile-ingest endpoint.
- The packaged surfaces include the dimensions and geometry-download work from the completed carve.
- The packaged single-argument `createSpacesRoutes(ctx)` factory and
  `surfaceHtml(ctx.appPackageDir, ...)` serving are required by the app loader. The retired
  two-argument `apiDir` shape must not return.

### Surface stylesheet boundary

The cockpit page follows the deployment theme. The two full-screen embeds intentionally do not:

| Surface | Shared CSS | Design tokens | Reason |
|---|---|---|---|
| `tools/spaces.html` | `surface-themes.css` and `surface-glass.css` | yes | cockpit page |
| `tools/spaces-viewer.html` | none | none | neutral black WebGL rasterizer |
| `tools/spaces-capture.html` | none | none | low-latency phone camera HUD |

`tests/spaces-surfaces.test.js` protects the source-of-truth boundary in both source and compiled
routes, parses every inline surface script, and pins this stylesheet split.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

No model in the loop (T0): every feature of this application is deterministic code.
<!-- oshal-rating:end -->
