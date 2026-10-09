# Scan to Print — continuation guide

This is the handover for the package. It says what is built, where it is proven, how to run it,
and how to pick up each open item. It describes the package as it is on `origin/main` of the
store on 2026-10-06 (version **0.7.0**). Anything not on main is named as in flight, with its
owner. If a sentence here and the code disagree, the code is right and this file is stale.

Read in this order: [README.md](../README.md) (what it does, how to use it) →
[docs/ARCHITECTURE.md](ARCHITECTURE.md) (the geometry contract) → this file → [BACKLOG.md](../BACKLOG.md).

## 1. Status

| | State |
|---|---|
| Store `origin/main` | `scan-to-print` 0.7.0 (store #427, 2026-10-06) |
| Local box (`oshal-local-api`), 2026-10-06 15:21 CDT | 0.7.0 installed, with its slicer engine container `oshal-scan-to-print-engine` (OrcaSlicer 2.4.2, self-test passed). The catalog review 40e2df13 was approved by the operator and the migration applied; he holds `maker`. The operator bot's tools are seeded (reads auto, print ask). The studio, jarvis, orbit and commons experiences run 1.1.1. The operator's Bambu Lab P2S is registered in the app. |
| Core | No core code was changed for this package. ADR-150 is the decision record and ADR-153 records CAD Studio, the consumer of the contours. 0.7.0 uses core's existing package tools and ADR-149 catalogs |
| Engine and surface tests | `node --test "tests/*-*.test.js"` — dependency-free; runs in store-ci and the pre-push store gate |
| Framework-coupled tests | `OSHAL_CORE_DIR=<oshal checkout> node --test tests/*.core.test.js` — routes, depth, frames, markers, freshness, identity, the print service, the package tools and the real-core authorization harness (`kernel.core`); local and Test Lab only |
| In flight | none |
| Not configured on the box | `SCAN_TO_PRINT_SLICER_CMD` (HTTP hosts get G-code only from a configured slicer; Bambu Lab printers are sliced by the engine container instead) |
| Not yet proven | a print started by oshal on a real printer (BACKLOG B19; the P2S's registration, status and an FTPS upload are live-proven, and the operator printed the uploaded files from the printer screen); a real phone camera session in the cockpit; a real iPhone/iPad LiDAR `.ply` through the point-cloud lane |

## 2. Release lineage

| Version | PR | What it added |
|---|---|---|
| 0.1.0 | store #191 (2026-09-12) | The package: deterministic engine (silhouettes → visual hull → surface nets → STL/OBJ → third-angle SVG), depth-map carver + `.ply` point-cloud lane, printer adapters behind `confirm: true`, inline concierge, migration 001, surface + WebGL viewer, docs, 40 engine cases + 7 route cases. Core ADR-150 (#437) |
| 0.2.0 | store #192 (2026-09-12) | Phone camera capture in the surface: viewfinder, per-view guidance line, record-six-views countdown, `tools/scan-to-print-camera.js` (UMD, testable under plain node), `tests/surface-camera.test.js` |
| 0.4.0 | `feat/package-test-catalog-pilots` (2026-09-14) | BACKLOG B7, base sealing: `fillSolidFromSurface` takes `sealBase`, the point-cloud route exposes the flag, the report records `sealedBase` and says the base face is an assumption. Three engine cases and one route case |
| 0.5.0 | `feat/package-backlog-sweep` (2026-09-14) | BACKLOG B1 + B8 (`POST /jobs/:id/depth`: a 16-bit PNG or float32 range image refines the job's current photo hull), B2 (perspective → canonical re-projection, engine), B10 (joint least-squares registration with per-view residuals), B11 (opt-in symmetry completion, engine), B12 (`GET /jobs/:id/frame-suggestions` + "Suggest views from the video"), B13 (`printChecks` on every report), B9 (orientation-cube face markers: a photo upload assigns its own view). Evidence per item in BACKLOG |
| 0.3.0 | store #194 (2026-09-13) | The CAD bridge: `contours` artifact (front/top/right outlines in world mm, simplified within half a voxel, ≤ 1500 points) written on every reconstruction, "Open in CAD Studio" in the report card, `tests/engine-contours.test.js`. CAD Studio (`cad-studio` package, ADR-153) turns the outlines into a B-rep part |
| 0.5.1 | store #236 (2026-09-17) | The manifest declares what the package reaches: CAD Studio as an optional app (the "Open in CAD Studio" hand-off), checked by the store's reach gate. |
| 0.5.2 | store #355 (2026-09-28) | The company audience view for the Business shell (ADR-164 D6): the shared kit paints the account's objects and printers. |
| 0.5.3 | store #387 (2026-09-28) | The family audience view beside the company one. |
| 0.6.0 | store #424 (2026-10-06) | The swarm print service (`/api/scan-to-print/service`), Bambu Lab printers on the home network (certificate-pinned FTPS upload, MQTT status and start), the OrcaSlicer engine container, per-printer slice settings and the owner's auto-start. Migration 002. |
| 0.6.1 | store #425 (2026-10-06) | Every connection to a Bambu Lab printer offers TLS 1.2 at most (a P2S broker on 01.02.00.00 was reported to hang on TLS 1.3); a Printers panel at the top of the object list, so printers are managed with no object open; the P2S menu path in the help. |
| 0.7.0 | store #427 (2026-10-06) | Agents use the print tools: the five tools are in-process package tools under an ADR-149 catalog (`authorization.yaml`, one `maker` role), and the operator bot is the printer bot (reads auto, print ask). The studio, jarvis, orbit and commons experiences name `maker` (1.1.1). |

## 3. What is complete, with evidence

**Photo lane** — six canonical views, one to three ruler measurements, visual hull. Evidence:
`tests/engine-reconstruction.test.js` (frames right-handed; a three-view box registers to its exact
extents; volumes within 1 %; the carved solid re-projects to its silhouettes; byte-identical re-runs;
refusals are `RangeError`s with reasons).

**Silhouettes** — border-median background, plateau-midpoint Otsu, edge-replicated morphology,
largest component, holes filled. Evidence: `tests/engine-silhouette.test.js`.

**Depth lane (the LiDAR building block)** — `carveDepth` removes only free space in front of a
return, `NaN` never carves, `renderDepth` is the simulated sensor. Evidence:
`tests/engine-depth-lidar.test.js` (a hollowed cylinder's cavity recovered to the voxel).

**Point-cloud lane** — own bounded PLY parser (ASCII, binary LE/BE), voxelise with unit scale and
Y-up re-orientation, close + flood fill, leak reported as `closed: false`. Evidence: same file
(a lattice box fills to exactly 72 000 mm³; a missing face leaks and says so).

**Mesh, drawing, exports** — surface nets watertight by construction and validated anyway;
A3 third-angle sheet with dimensions, title block, provenance notes; binary STL exactly
`84 + 50·n` bytes; OBJ 1-based. Evidence: `tests/engine-drawing.test.js`, `tests/engine-geometry.test.js`.

**Printing** — OctoPrint / Moonraker / PrusaLink adapters, key in a header only, URL refusals
(loopback, credentials, non-http, query), slicer as a configured argv command. Evidence:
`tests/engine-print.test.js` (fake network), `tests/routes.core.test.js` (428 without confirm,
409 without a slicer, STL never auto-started, ciphertext-only printer keys).

**Bambu Lab printers and the print service** (0.6.x) — identity and a SHA-256 pin from the printer's
certificate, implicit FTPS with the session reuse the printer requires, MQTT status and start with
every start rule, the OrcaSlicer engine bridge, the owner's auto-start re-read at start time, TLS 1.2
on every printer connection. Evidence: `tests/printing-bambu.test.js` (a fake printer on real local
TLS, including one that never answers a TLS 1.3 hello), `tests/printing-slicer.test.js`,
`tests/service.core.test.js`; live against the operator's P2S on 2026-10-06: probe and pin, status,
an upload and a refused wrong pin.

**Agent tools and the catalog** (0.7.0) — the five package tools run under the verified actor; the
ADR-149 catalog binds every route exactly once. Evidence: `tests/catalog-bindings.test.js`,
`tests/tools.core.test.js`, `tests/kernel.core.test.js` (activation, the maker grant, executor runs,
refusals, the HTTP guard and the reviewed migration through the real core runtime).

**Camera capture** — `tools/scan-to-print-camera.js`; every browser object is a parameter.
Evidence: `tests/surface-camera.test.js` (sequence, guidance, frame bounds, countdown on a fake clock).

**CAD bridge** — `contours` artifact per reconstruction. Evidence: `tests/engine-contours.test.js`
(box outlines at exactly ±30 / ±20 / 0..30 mm; a ⌀40 cylinder's top outline within 3 % of π·20²).

**Ownership and gates** — every SQL statement carries `owner_sub`, the migration installs owner
RLS on all four tables, ids are UUID-validated before touching a path, printer keys are stored
through the personal-data vault. Evidence: `migrations/001-scan-to-print.sql`, `routes.core.test.js`
(a second subject gets 404).

## 4. Module map (where to change what)

| Concern | File (`src-routes/…`) | Entry points | Test |
|---|---|---|---|
| Pixels → mask | `engine/raster/silhouette.ts` | `extractSilhouette`, `otsuThreshold`, `fillHoles` | `engine-silhouette` |
| The six views, the world frame | `engine/grid/views.ts` | `VIEW_FRAMES`, `projectToView`, `viewExtent` | `engine-reconstruction` |
| The solid | `engine/grid/occupancy-grid.ts` | `createOccupancyGrid`, `projectGrid`, `clearBorder` | all engine suites |
| Photo lane | `engine/grid/silhouette-carver.ts` | `registerSilhouettes`, `carveSilhouettes` | `engine-reconstruction` |
| Depth lane | `engine/grid/depth-carver.ts` | `carveDepth`, `renderDepth`, `DepthMap` | `engine-depth-lidar` |
| Point-cloud lane | `engine/grid/point-cloud.ts` | `parsePly`, `voxelizePointCloud`, `fillSolidFromSurface` | `engine-depth-lidar` |
| Mesh | `engine/mesh/surface-nets.ts` | `surfaceNets` | `engine-reconstruction` |
| Drawing | `engine/drawing/engineering-drawing.ts`, `contours.ts` | `renderEngineeringDrawing`, `traceContours` | `engine-drawing`, `engine-contours` |
| Printers, slicer | `engine/print/printer-adapters.ts`, `slicer.ts` | `adapterFor`, `validatePrinterBaseUrl`, `sliceStl` | `engine-print` |
| The lanes' common tail and the report | `engine/pipeline.ts` | `finishFromGrid`, `reconstructFromSilhouettes`, `refineWithDepth`, `exportArtifacts` | every engine suite |
| HTTP: jobs, uploads, reconstruct, artifacts | `job-routes.ts` | `createJobRoutes` | `routes.core` |
| HTTP: printers, print | `print-routes.ts` | `createPrintRoutes` | `routes.core`, `service.core` |
| Bambu Lab on the LAN | `printing/bambu-lan.ts`, `bambu-mqtt.ts`, `bambu-ftps.ts` | `probeBambuPrinter`, `bambuStatus`, `bambuUpload`, `bambuStart` | `printing-bambu` |
| Slicing for Bambu Lab | `printing/slicer-engine.ts`, `engine/` (container) | `sliceToArchive`, `slicerEngineBuildHash` | `printing-slicer` |
| Sending a print, recording it | `print-service.ts`, `printer-registration.ts` | `sendToBambu`, `sendToHttpPrinter`, `recordAttempt`, `registerBambuPrinter` | `service.core` |
| HTTP: the print service | `service-routes.ts` | `createPrintServiceRouter` | `service.core` |
| Agent tools | `print-tools.ts` | `registerPrintTools`, `PRINT_TOOL_SPECS` | `tools.core`, `kernel.core` |
| Authorization | `scan-authorization.ts`, `../authorization.yaml` | `registerScanToPrintAuthorization` | `catalog-bindings`, `kernel.core` |
| SQL (owner-scoped) | `job-store.ts` | one function per statement | `routes.core` (SQL-dispatching double) |
| Files on disk | `data-dir.ts` | `resolveDataRoot`, `jobDir`, `artifactPath` | `routes.core` |
| Decoding, ffmpeg | `image-ingest.ts` | `decodeToRaster`, `extractFrames`, `pngToMask` | `routes.core` |
| The mount | `scan-to-print-routes.ts` | `createScanToPrintRoutes`, `/capabilities` | `routes.core` |
| Surface | `tools/scan-to-print.html`, `.js`, `-gl.js`, `-camera.js` | — | `surface-camera` |

The engine has **no framework import** (`engine-geometry` asserts it). Keep it that way: it is
what lets the compiled engine run under plain `node --test` in store-ci and inside the api image.

## 5. How to work on it

**Build** (from the package root; the framework's TypeScript is used):

```bash
node C:/Projects/oshal/node_modules/typescript/bin/tsc -p src-routes/tsconfig.json && find routes -name '*.js.map' -delete
```

**Test:**

```bash
node --test "tests/*-*.test.js"                                            # dependency-free
OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js     # needs a core checkout
```

**Gates before a PR** (run on a clean export of `origin/main` with your package copied in, not on
the shared checkout — other agents' work is in that tree):

```bash
node scripts/check-catalog.mjs
node --test scripts/security/package-audit.test.mjs
node --test scripts/security/security-ci-contract.test.mjs     # one pre-existing red: manual-only workflow
node scripts/security/check-store-test-discovery.mjs
node scripts/security/check-store-security.mjs                  # regenerate the inventory with --print on a route change
node C:/Projects/oshal/scripts/oshal-app.js validate scan-to-print
node scripts/security/rebuild-store-routes.mjs --check-only --store . --framework C:/Projects/oshal
```

**Version bump = three files in one commit:** `oshal-app.yaml`, the `marketplace.json` row, and
`README.md` regenerated with `node scripts/gen-readme-apps-table.mjs` (`scripts/check-catalog.mjs`
refuses drift). A new route entry also needs `scripts/security/store-route-inventory.json`
regenerated and reviewed.

**Land it:** branch → PR → merge (CONTRIBUTING.md). In a shared checkout build the commit in a
private index from `origin/main` and push it by SHA rather than moving `HEAD`
(`git read-tree origin/main` under `GIT_INDEX_FILE`, `git --work-tree=<export> add -- <paths>`,
`write-tree`, `commit-tree -p origin/main`, `git push origin <sha>:refs/heads/<branch>`).

**Deploy to a box:** merging changes nothing on a running swarm. Stage an LF export of the merged
SHA into the api container, write the canonical `.oshal-install.json` (`name`, `repo`, `ref`,
`sha`, `installedAt`, `dependencies`, `audit`) — the ADR-149 loader refuses a stamp without `repo`
("Missing authorization install provenance") — then restart the api:

```bash
git -c core.autocrlf=false archive <sha> scan-to-print | MSYS_NO_PATHCONV=1 docker exec -i oshal-local-api tar -x -C /tmp/stage
# move /tmp/stage/scan-to-print over /app/workspace-shared/deployed-apps/scan-to-print, write the stamp, then:
docker restart oshal-local-api
```

Prove it from the boot log, not from a probe: `Manifest loaded`, `Package migration applied`,
three `Mounted package route` lines, `App loaded … active`. A PAT and the service secret answer
`401 authorization_identity_required` on every package route under ADR-149 enforce; only a browser
session reaches the surface — since 0.7.0 one holding the catalog's `maker` role. Agents reach the
print service through the in-process package tools instead (docs/PRINTERS.md §6).

**Configuration** (all env, none hard-coded): `SCAN_TO_PRINT_DATA_DIR`, `SCAN_TO_PRINT_SLICER_CMD`
(+ `_TIMEOUT_MS`), `SCAN_TO_PRINT_FFMPEG_BIN`, `SCAN_TO_PRINT_FRAME_FPS`, `SCAN_TO_PRINT_MAX_FRAMES`.
See [PRINTERS.md](PRINTERS.md).

## 6. Contracts to keep (they are load-bearing)

- **World frame and the six views** (ARCHITECTURE §2–3). Every sensor projects into them; the
  camera module's guidance lines, the drawing layout and CAD Studio's contour import all assume
  them. Changing a sign here breaks three packages.
- **Binary occupancy** (0/1, empty outer shell). The carvers compose only because a voxel is never
  a probability, and the mesher is watertight only because the shell is empty.
- **`DepthMap` struct** (ARCHITECTURE §6) — orthographic, canonical view, `NaN` = no return.
- **Report JSON** (`ReconstructionReport`) is read by the drawing, the surface, the concierge and
  CAD Studio. Add fields; do not rename.
- **`contours.json`** — world millimetres, footprint centred, Z from 0, outer outlines only.
- **Determinism** — no model, seed, randomness or iteration-to-tolerance in `engine/`. The
  byte-identity tests exist to catch anyone who adds one.
- **Printing from the app is a human click behind `confirm: true`.** Since 0.6.0 the print service
  (PRINTERS.md §5/§6) also prints for agents and apps, and it starts a machine only on a printer whose
  owner turned auto-start on (OIDC-only, with confirmation, re-read at start time); a caller's own
  sliced archive or G-code is uploaded, never auto-started. Keep both properties.

## 7. Known limits (as built)

- Orthographic assumption: tilted or close photos skew proportions; reported (>10 % disagreement),
  not corrected.
- Registration keys on the bounding box; different features at the extremes of different views
  register slightly off. Uniform per-view scaling averages the two axis estimates, so changing one
  ruler entry is not an exact axis resize (documented on the in-flight branch as the measurement
  reconciliation item).
- The visual hull fills cavities, undercuts and unaligned holes. The depth lane is the remedy and
  it has no device input yet (B1/B2).
- Point-cloud fill cannot cross a gap wider than the closing radius; a one-sided top-down LiDAR
  scan leaks (reported) because the underside is open (B7).
- Surface nets can leave a non-manifold vertex on a 2×2×2 checkerboard; the edge census passes,
  slicers accept it.

## 8. How to continue — the backlog, in the order I would take it

Every item below is in [BACKLOG.md](../BACKLOG.md) with done-when criteria. Suggested order and the
reason:

1. ~~**B7 base sealing**~~ — **done in 0.4.0** on `feat/package-test-catalog-pilots`. It was the
   cheapest change that makes a real phone LiDAR scan close, and it is now the precondition B15
   was waiting on.
2. **B15 real-device evidence** — one Scaniverse `.ply` of a small object through the lane after
   B7, outcome recorded in the README. This turns "theoretically works with LiDAR" into a row.
3. ~~**B1 depth-image upload** then **B2 perspective re-projection**~~ — **done in 0.5.0** (B2 engine
   only; the depth route does not take intrinsics or a pose yet). Originally: the LiDAR lane proper. B1 is a
   route plus a decoder for 16-bit PNG / float32 raw; B2 is a pure function with intrinsics and a
   pose. Fixtures come from `renderDepth` (B1) and a synthetic pinhole render of the cup (B2).
4. ~~**B8 hull + depth in one job**~~ — **done in 0.5.0**. Originally: `refineWithDepth` already exists; expose it on the job so a
   photo hull can be refined by an uploaded depth map. Depends on B1.
5. **B3 fiducial scale** and ~~**B9 orientation cube**~~ (B9 done in 0.5.0) — remove the two remaining manual steps
   (typing a measurement, assigning views). Both are deterministic detectors; both change
   `dimensionSources` / the view assignment, nothing downstream.
6. ~~**B10 consistency solve**~~ — **done in 0.5.0**. Originally: replaces the greedy extent propagation with a least-squares fit
   over all views and reports per-view residuals; addresses the reconciliation item.
7. ~~**B13 printability pre-check**~~ — **done in 0.5.0** (engine + report; the job routes do not take a
   nozzle or layer height yet).
8. **B4, B5, B6, B14, B16** — independent; take by demand. (B9, B11 and B12 are done in 0.5.0; B3,
   the fiducial scale, remains.)
9. **B19 the live print test**, deferred by the operator on 2026-10-06 after printing the uploaded
   files from the printer screen: install 0.7.0, then an agent sends a job and the printer starts.
   **B20** gives the printer bot its own node so it answers the operator directly.

For each item: write the pure engine function first with its spec in `tests/engine-*.test.js`,
then the route with its case in `routes.core.test.js`, then register the case in
`tests/test-lab.yaml`, then bump the version (three files), regenerate the route inventory if a
route was added, and land through a PR. The engine stays free of framework imports.

## 9. Related documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — the geometry contract, frames, lanes, limits.
- [PRINTERS.md](PRINTERS.md) — printer hosts, Bambu Lab setup and Developer Mode, the slicer engine,
  the print service, the agent tools and the catalog, video sampling.
- [BACKLOG.md](../BACKLOG.md) — every open item with done-when criteria.
- Core `docs/adr/150-deterministic-object-reconstruction-scan-to-print.md` — the decision record.
- Core `docs/adr/153-iterative-cad-kernel-cad-studio.md` and the `cad-studio` package — the
  consumer of the contours artifact.
- Core `docs/adr/111-spatial-mapping-3d-reconstruction.md` — room-scale scanning; its `.ply`
  import lane reads the same file this package's point-cloud lane reads.
- `CAD-PLAN.md` (in flight on store PR #185) — the editable-CAD milestones CAD-01…CAD-10.
