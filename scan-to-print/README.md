# Scan to Print

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
   (front, back, left, right, top, bottom). Minimum for a solid: front, top, right. Or add a video
   and assign the square-on frames. Or import a `.ply` point cloud (iPhone/iPad Pro LiDAR via
   Scaniverse/Polycam: metres, Y-up) — that lane skips steps 2–3's photo logic entirely.

   The live camera needs a secure context (HTTPS, or localhost) and camera permission. Inside the
   cockpit the surface runs in a same-origin iframe, which inherits the page's camera permission.
3. **Scale** — enter at least one measured extent in millimetres (width X, depth Y, height Z).
4. **Reconstruct** — choose resolution (voxels along the largest extent) and smoothing, click.
   Read the report: extents with their provenance (known / derived / assumed), volume, facets,
   the printable verdict, warnings and the method's limitations. Download STL / OBJ / SVG / report.
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
  reported as a view disagreement, not corrected.
- An extent no supplied view shows is assumed equal to the measured one and flagged everywhere.

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
OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js  # framework-coupled (express/multer/sharp)
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
  72 000 mm³; a missing face is reported as a leak.
- `engine-print.test.js` — the three hosts' upload shapes with a fake network; the key rides a
  header; URL refusals; slicer argv without a shell.
- `routes.core.test.js` — the whole flow over HTTP, the 401 / 404 / 409 / 428 gates, ciphertext-only
  printer keys, STL never auto-started, point cloud through the same tail.

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
