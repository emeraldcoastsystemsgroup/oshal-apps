# Scan to Print

Scan exports STL/OBJ meshes, dimensioned SVG and world-millimetre contours with
measurement provenance. **Open in CAD Studio** sends current contours to the
separate [CAD Studio](../cad-studio/README.md) application for feature editing and
STEP export. Scan's own meshes contain no CAD feature tree. SOLIDWORKS integration
and further engineering workflows remain in the [delivery plan](CAD-PLAN.md).

## Depth upload, view suggestions, print checks (0.5.0)

- **Range images** (BACKLOG B1, B8): `POST /jobs/:id/depth` takes a 16-bit PNG or float32 range
  image plus the header that places it (view, mm per pixel, centre pixel, plane, depth scale). It
  refines the job's current photo hull, so a cavity no outline can see is carved out. The report's
  lane reads `depth`, and `viewsUsed` lists both kinds of view. The route is API-only for now.
- **Perspective range images** (B2): `reprojectToCanonicalView` turns a phone's pinhole range
  image into the orthographic map the carver reads (engine only).
- **Joint registration** (B10): one least-squares fit over every view. Each view reports its
  residual, and the worst is warned about first.
- **Symmetry** (B11, engine only): opt-in mirror completion. The report and the drawing say how
  much was copied rather than seen.
- **Suggest views from the video** (B12): the surface proposes the square-on frame per unassigned
  view, and you confirm each one. A view the clip never showed gets no proposal.
- **Orientation cube** (B9): a paper cube with one marker per face (`faceMarkerSvg`) stands beside
  the object. A photo upload reads the visible face and assigns the view itself; no marker, an
  unknown one, two, or a view already taken leave it to you.
- **Print checks** (B13): every report carries `printChecks`, the thinnest wall and the steepest
  overhang against the limits a nozzle and a layer height imply (defaults 0.4 mm / 0.2 mm, two
  perimeters). A failing check is written on the drawing.

Evidence for each is in [BACKLOG.md](BACKLOG.md) under its item.

## Shared preview and CAD handoff (0.3.1)

Upgrade the core before installing Scan 0.3.1 or CAD Studio 0.1.1. Both pages load
the core `/shared/ui/js/stl-viewer.js` (`OSHALStlViewer.apiVersion === 1`) before
their small compatibility adapters. An older core produces an explicit viewer
update error. Geometry generation stays in each application's existing engine.
The core's `npm run test:shared-stl-viewer` exercises both actual pages in Chromium
with real WebGL and synthetic HTTP responses; it does not run the CAD kernel.

The 0.3.1 integration retains upload identity and output freshness protections
alongside the 0.3.0 contours artifact. Editing inputs, switching jobs or receiving
a newer output revision while contours load retires the pending CAD handoff.
Late creation responses cannot navigate away from the newly selected job.
`surface-cad-handoff.test.js` covers these races with the actual page source and
DOM/HTTP doubles; the existing HTTP regression also refuses stale contours.

## Output freshness (0.2.1) and upload identity (0.2.2)

Native acceptance exposed a multipart callback losing the verified database
identity after photo parsing. The fresh owner lookup correctly refused that
identity-less request with `404 job_not_found`. Version 0.2.2 preserves the
original asynchronous context across upload callbacks, following the established
Create upload pattern. It does not bypass ownership checks or reconstruct a
privileged identity. Photo, video and point-cloud upload callbacks use the same
context-preserving wrapper; a dedicated real-framework identity regression covers
the boundary that the earlier database double did not exercise.

Changing measurements, reconstruction settings, the drawing title, photos or
view assignments retires the previous report and outputs. Reconstruct again
before exporting or printing. A failed rebuild cannot leave an older model
marked ready. Unchanged settings and rejected invalid patches preserve a current
result. Current nonprintable meshes remain available for inspection; slicing,
G-code download and printer submission require a current model that passed the
existing mesh checks. Those checks do not certify a manufacturing process.

The page clears old output controls when measurements/settings are edited and
shows a reconstruction prompt. Late preview/rebuild responses cannot restore
old geometry or overwrite newer unsaved measurements. The WebGL viewer's shader
and first-frame scheduling are corrected and exercised with rendered pixels.
The server rechecks persisted state independently
and refuses stale requests with `409 output_stale`. Conflicting operations on
the same object return `409 job_busy`, allowing the person to retry after the
current operation. Coordination covers the current single-API process; it is
not a distributed lock for multiple concurrent API writers.

The manifest now declares `testing.catalog` and `uses: [test-catalog]`, so
installation registers all fourteen cases. Nine dependency-free Node recipes
can run in the installed Lab. The existing HTTP recipe and the new
`output-freshness`, `upload-identity` and `surface-freshness` recipes retain explicit framework or
browser prerequisites. Readiness is the existing metadata-only smoke. Catalog
registration does not claim a suite has executed.

For local regression, set `OSHAL_CORE_DIR` to the framework checkout and run
`node --test tests/routes.core.test.js tests/freshness.core.test.js tests/identity.core.test.js`, then
`node --test tests/surface-freshness.core.spec.mjs` with the framework's installed
Playwright/Chromium. These use synthetic photos, temporary files, a loopback
server, a database double and printer/process doubles; they do not send a print
or substitute for real PostgreSQL/hardware acceptance. Existing dependency-free
engine/camera checks remain required.

Source verification for the 0.2.1 correction passed **78 checks**: 49 retained
engine/camera checks, 22 HTTP checks (15 new, seven retained) and seven new
Chromium checks. Strict TypeScript and canonical compilation agree on all 31
generated route modules; scoped function/file limits and package/catalog
validation pass. Installed execution and native acceptance are recorded
separately after activation.

The corrective 0.2.2 run adds five real request-identity upload cases: **83
distinct checks** in total (49 engine/camera, 27 HTTP and seven Chromium).
The photo case reproduced the native `404` before the callback correction and
passes afterward; the earlier 502 remains separate operational evidence.

Photograph an object from its six sides (or film it, or import a LiDAR point cloud), enter one
ruler measurement, and get:

1. an **engineering drawing** — third-angle, six views, overall dimensions, title block (SVG, A3, mm);
2. a **watertight 3D model** — STL and OBJ — you can rotate in the browser;
3. a **print job** on your own OctoPrint, Klipper/Moonraker or PrusaLink printer, behind an
   explicit confirmation.

The geometry is **deterministic**: same photos, same ruler number, same bytes. There is no model
in the geometry path. The one inline concierge (`scan-to-print-operator`) briefs jobs and drafts
capture guidance; it never computes geometry and never sends a print.

**Why it exists beyond printing:** every input lane ends in one occupancy grid, and the same grid
accepts depth-map and point-cloud input. The LiDAR lane is built and tested with a simulated
sensor and a real `.ply` parser — read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before
extending it.

## Use it

Open `/cockpit/?app=scan-to-print`.

1. **New object** → name it.
2. **Capture** — on a phone, tap **Use camera**: a live viewfinder with a chip per view and a
   framing line for each (top = FRONT edge at the bottom of the screen, right = FRONT edge on the
   left, …). Tap **Capture** per view, or **Record six views** for a 3-second countdown per view —
   rotate the object when it says so; skip or stop any time. Each frame is bounded to 1280 px,
   uploaded as a photo and assigned its view; the engine never learns it came from a camera.
   **Take a photo** opens the phone's camera app instead (the fallback when the browser will not
   hand this page a live camera). Or add photos from files — plain, contrasting background, camera
   square to each face, the object in the same orientation every time — and assign each a view
   (front, back, left, right, top, bottom). With the orientation cube standing beside the object
   (clear of it and smaller than it), each photo names its own view on upload. Minimum for a solid:
   front, top, right. Or add a video:
   **Suggest views from the video** proposes the square-on frame for each view still unassigned
   (click **assign** to accept one, or **Assign all suggested**), or assign frames by hand. Or
   import a `.ply` point cloud (iPhone/iPad Pro LiDAR via
   Scaniverse/Polycam: metres, Y-up) — that lane skips steps 2–3's photo logic entirely.
   Tick **seal base** when the object stood on a table and its underside was never scanned: the
   lowest scanned layer is capped so the interior can fill. It caps that one layer and nothing
   else — a gap anywhere else still leaks and is still reported — and the report then carries
   `sealedBase` with a warning that the base face is an assumption, not a measurement.

   The live camera needs a secure context (HTTPS, or localhost) and camera permission. Inside the
   cockpit the surface runs in a same-origin iframe, which inherits the page's camera permission.
3. **Scale** — enter at least one measured extent in millimetres (width X, depth Y, height Z).
4. **Reconstruct** — choose resolution (voxels along the largest extent) and smoothing, click.
   Read the report: extents with their provenance (known / derived / assumed), volume, facets,
   the printable verdict, the print checks (thinnest wall, steepest overhang), warnings and the
   method's limitations. Download STL / OBJ / SVG / report.
   **Open in CAD Studio** hands the front / top / right outlines (the `contours` artifact, world
   millimetres) to the `cad-studio` package, where they become a real CAD part — holes, fillets,
   STEP — as a `contours` base.
5. **Print** — register your printer (label, kind, base URL, API key), choose G-code (needs a
   configured slicer) or STL (OctoPrint slices), tick *start printing* if you want, confirm.
   Setup: [docs/PRINTERS.md](docs/PRINTERS.md).

## What it cannot see (honest limits)

- The photo lane produces the **visual hull**: cavities, undercuts and holes not aligned with a
  view are filled solid. The depth/LiDAR lane is what recovers them.
- Photos are assumed orthographic (square to the face, far enough back). Skewed proportions are
  reported per view as a residual against the joint fit, not corrected. With three views in one
  loop no fit can tell which photo is skewed, so all three carry the misfit.
- A symmetry assertion copies material nobody saw. It is opt-in, and the report and the drawing
  give the copied volume.
- Print checks are advice, not a slicer. The overhang reading is within 1° shallow and 6° steep on
  voxelised slopes, so a slope near the limit is a borderline call.
- An extent no supplied view shows is assumed equal to the measured one and flagged everywhere.
- A point cloud with no underside only closes when you assert the bed plane (**seal base**). The
  capped face is then an assumption; the report says so and the drawing notes carry it.

## Layout

```
oshal-app.yaml            manifest — one mount, one bot, three read-only tools, one ribbon tile
src-routes/               TypeScript sources
  scan-to-print-routes.ts the mounted factory: surface, assets, /capabilities, composes the two below
  job-routes.ts           jobs, photos/video/point-cloud ingest, views, scale, reconstruct, artifacts
  print-routes.ts         printers (owner-key encrypted keys), status, confirmed print submission
  job-store.ts            every SQL statement, each owner-scoped
  data-dir.ts             job-file layout (never inside the package dir; UUID-validated paths)
  image-ingest.ts         sharp decode / mask PNGs; ffmpeg frame sampling (configured, argv only)
  home-summary.ts         ADR-145 Home tile (import-free)
  package-smoke.ts        canonical CORE-05 readiness probe
  engine/                 the deterministic pipeline — zero framework imports
    raster/               RGBA raster + mask types, silhouette extraction (Otsu, morphology, fill)
    grid/                 the six views, the occupancy grid, silhouette / depth carvers, point cloud
    mesh/                 surface nets
    drawing/              exact contour tracing, the third-angle SVG sheet
    print/                printer adapters (OctoPrint / Moonraker / PrusaLink), slicer command
    geometry/             vendored ocean-lab primitives: vectors, metrics, validation, STL, OBJ
    pipeline.ts           lanes → finishFromGrid → report → artifacts
routes/                   compiled CommonJS (committed; the manifest points here)
tools/                    the surface (scan-to-print.html + .js), the WebGL STL viewer (-gl.js), the phone camera module (-camera.js)
personas/                 the concierge persona (package copy for the registrar)
migrations/               001 — jobs, images, printers, submissions + owner RLS
docs/                     ARCHITECTURE.md (the contract), PRINTERS.md (runbook)
tests/                    engine-*.test.js (dependency-free), routes.core.test.js (framework-coupled)
```

## Configuration (all optional)

| Variable | Meaning |
|---|---|
| `SCAN_TO_PRINT_DATA_DIR` | Job-file root. Default: `<shared workspace root>/scan-to-print`. |
| `SCAN_TO_PRINT_SLICER_CMD` | Slicer command with `{input}` and `{output}` placeholders. Unset = no slicing; G-code uploads answer 409 with the reason. |
| `SCAN_TO_PRINT_SLICER_TIMEOUT_MS` | Slicer timeout. Default 300000. |
| `SCAN_TO_PRINT_FFMPEG_BIN` | Frame-sampling program. Default `ffmpeg`. |
| `SCAN_TO_PRINT_FRAME_FPS` / `SCAN_TO_PRINT_MAX_FRAMES` | Video sampling rate and cap. Default 1 fps, 24 frames. |

Printers are per person, entered in the app; the API key is stored as owner-key ciphertext via
the `memory` kernel skill (`@/features/personal-data`), never plaintext.

## Build

```bash
cd c:/Projects/oshal-apps/scan-to-print
node C:/Projects/oshal/node_modules/typescript/bin/tsc -p src-routes/tsconfig.json && find routes -name '*.js.map' -delete
```

`@/` aliases are left intact in the output on purpose — the oshal loader resolves them at runtime
(BUILDING-EXTENSIONS §5). Source maps are emitted so the compiled modules carry the same
`//# sourceMappingURL` trailer the framework's canonical compiler produces (the store's security
contract compares the readiness-smoke module byte for byte); the `.js.map` files themselves are
never committed. The engine under `routes/engine/` has no `@/` import at all; the geometry spec
asserts it.

## Test

```bash
cd c:/Projects/oshal-apps/scan-to-print
node --test "tests/*-*.test.js"                                         # engine-* + surface-*: dependency-free, runs in store-ci
OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js tests/depth.core.test.js tests/frames.core.test.js tests/markers.core.test.js  # framework-coupled (express/multer/sharp)
```

Load-bearing specs:

- `engine-contours.test.js` — the CAD bridge: a box's three outlines come back as exact
  rectangles in world millimetres, a cylinder's top outline is a circle within the simplification
  tolerance, and the point budget is honoured.
- `surface-camera.test.js` — the phone-capture module under plain node: view order and front-edge
  guidance, frame bounding, the countdown sequence on a fake clock (tick / capture / skip / stop /
  a failing capture halts), the stream wrapper on a fake `mediaDevices` (rear camera first, flip,
  stop releases tracks, bounded JPEG, no frame rejects).
- `engine-reconstruction.test.js` — every view frame is right-handed; a three-view box registers
  to its exact extents; volumes within 1 %; the carved solid re-projects to the silhouettes that
  carved it; two runs are byte-identical.
- `engine-depth-lidar.test.js` — a simulated top-view depth map carves a cup's cavity **to the
  voxel**; no-return pixels never carve; ASCII/binary PLY; a lattice box fills to exactly
  72 000 mm³; a missing face is reported as a leak; a capture with no underside seals to the bed
  plane and fills to exactly 72 000 mm³, while a side through-hole and a missing lid still leak
  with the seal on, and an empty grid is refused.
- `engine-print.test.js` — the three hosts' upload shapes with a fake network; the key rides a
  header; URL refusals; slicer argv without a shell.
- `routes.core.test.js` — the whole flow over HTTP, the 401 / 404 / 409 / 428 gates, ciphertext-only
  printer keys, STL never auto-started, point cloud through the same tail, the base seal recorded
  in the report and an unreadable `sealBase` refused 422.
- `engine-print-checks`, `engine-symmetry`, `engine-depth-reproject`, `engine-registration`,
  `engine-frame-suggest`, `engine-depth-upload`, `engine-face-marker`, `surface-suggest`
  (dependency-free) and `depth.core`, `frames.core`, `markers.core` (framework-coupled): the
  0.5.0 items. Each item's BACKLOG entry names the cases and the measured numbers.

## Install

```bash
cd c:/Projects/oshal
node scripts/oshal-app.js install scan-to-print
```

Then open `/cockpit/?app=scan-to-print`. The migration creates four owner-RLS tables on first
load.

## Continuing this work

[docs/CONTINUATION.md](docs/CONTINUATION.md) is the handover: status as of 0.3.0, the release
lineage, what is proven and by which test, the module map, the build / test / gate / deploy
recipe, the contracts that must not change, the known limits, and the backlog in a suggested
order. [BACKLOG.md](BACKLOG.md) holds every open item (B1–B16) with done-when criteria.
