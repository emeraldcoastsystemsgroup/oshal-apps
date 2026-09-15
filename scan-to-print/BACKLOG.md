# Scan to Print — backlog

Each entry has done-when criteria. An entry marked **Done** carries its evidence; every other entry
is not built. The README and ARCHITECTURE describe only what is.

The requested editable CAD/SOLIDWORKS workflow is specified in the
[CAD Studio delivery plan](CAD-PLAN.md). CAD-01 through CAD-10 extend this queue
without relabeling the current scan meshes as parametric CAD. CAD-01 owns the
cross-studio acceptance for B4; the remaining scan input/print rows stay here.

## B1 — Depth-image upload lane (real LiDAR / ToF range images)

`carveDepth` and the `DepthMap` contract are shipped and exercised with the simulated sensor. What
is missing is an **input** for a real device's range image.

Done when: `POST /jobs/:id/depth` accepts a 16-bit PNG or a float32 raw range image plus the
`DepthMap` header fields (view, mmPerPx, centre pixel, plane), calls `refineWithDepth` on the
job's current grid, and the report's `lane` reads `depth`; a spec uploads the `renderDepth`
output of the cup fixture and asserts the cavity is recovered over HTTP.

**Done on `feat/package-backlog-sweep`.** `POST /jobs/:id/depth` takes one multipart file,
`depth`, as `format=png16` or `format=f32le`. The header fields are `view`, `mmPerPx`,
`uCenterPx`/`vCenterPx`, `uCenterMm`/`vCenterMm` (default 0), `planeMm`, `depthScale` (mm per
stored unit, default 1), plus `width`/`height` for raw. The header is validated in the engine
(`parseDepthHeader`), and every bad field is refused 422 with its name. Float32 NaN or ±Infinity is
no return. 16-bit `0` is no return, the convention 16-bit depth formats share. The 16-bit PNG is
decoded in a grey16 pipeline end to end: a probe showed sharp's default raw decode turns such a PNG
into 8-bit-scaled sRGB (a stored 4001 came back as 15). The route refines the job's current photo
hull (`reconstructHullWithDepth`, see B8), so the report's `lane` reads `depth`. `/capabilities`
lists the depth lane and its bounds.

As built:
- One range image per build, like the point cloud. It is not stored as a job input, so a later
  `POST /reconstruct` rebuilds the photo hull without it.
- The lane needs a photo hull (at least one assigned view). A range image alone cannot bound a
  part's sides, and a job without views answers 409 `no_views_assigned`.
- `source_kind` stays `photos` or `video`, because the migration's CHECK allows only
  `photos | video | pointcloud`. The refinement is recorded as `report.lane: 'depth'`.
- A sensor plane inside the part is refused. The carver would otherwise read material behind the
  plane as free space.
- The header must already place the image orthographically in the world frame. A phone's
  perspective frame needs B2's `reprojectToCanonicalView` first, and the route does not take
  intrinsics or a pose.
- The surface has no upload control for it yet.

Evidence: `tests/engine-depth-upload.test.js` (5 cases: decoding, refusals) and
`tests/depth.core.test.js` (3 HTTP cases, framework-coupled; see B8 for the cavity over HTTP).

## B2 — Perspective range images → canonical orthographic view

Phone depth cameras deliver perspective range images. The engine's contract is orthographic in a
canonical view.

Done when: a pure function re-projects a perspective range image (intrinsics + pose in the world
frame) into a `DepthMap` for the nearest canonical view, with a spec that renders a perspective
image of the cup fixture synthetically, re-projects it, and carves within one voxel of the
orthographic result.

**Done (engine) on `feat/package-backlog-sweep`.** `reprojectToCanonicalView(image, target)` in
`engine/grid/depth-reproject.ts` takes pinhole intrinsics, a camera-to-world pose (camera +X
right, +Y down, +Z forward; pixel centres at +0.5) and a `z` or `range` depth kind. It
back-projects every finite return, picks the canonical view nearest the optical axis
(`nearestCanonicalView`), and keeps the shallowest landing per map pixel. No return stays NaN.
`renderPerspectiveDepth` is the sim sibling of `renderDepth`: a pinhole camera ray-marched through a
grid.

A re-projected return certifies its whole orthographic column as free, which is exact only when the
camera ray runs down that column. Each sample's lean from the look axis is therefore measured, and
samples past `maxLeanDeg` (published default 45°, where a ray crosses into the next column within
one voxel of depth) are dropped. Every dropped sample (lean, behind the plane, off the map) is
counted in the returned `stats`. Remaining limit, as built: under that limit, a surface the camera
could not see but which lies inside a certified column is still carved. The error grows with lean
× depth.

Evidence: `tests/engine-depth-reproject.test.js`, 6 cases. A camera 10 mm off-centre and tilted
4.6° above the cup re-projects into `top` and carves within one voxel of the orthographic result.
894 of 59 160 cavity voxels differ, all adjacent to the reference. Where the orthographic map is
flat, the re-projected depth agrees to half a voxel (worst measured 0.195 mm, the quarter-voxel
march step). Both depth kinds pass, and a mislabelled depth kind fails that agreement on more than
500 pixels. The spec also covers view selection, dropped-and-counted samples, determinism and
RangeError refusals. Registered as `engine-depth-reproject`.

## B3 — ArUco / known-size fiducial for automatic scale

Today the person enters ruler measurements. A printed fiducial of known size in the frame would
set the scale without typing.

Done when: a marker detector (deterministic, no model) finds a fiducial square in a photo, the
registration takes its pixel size as the scale anchor for that view, and the report's
`dimensionSources` gains `fiducial`.

Measurement reconciliation also remains open: native synthetic 60 x 40 x 30 mm
views with entered 80 x 40 x 30 mm dimensions produced a fresh 70 x 40 x 30 mm
mesh and 25% front/top proportion warnings. Uniform per-view scaling averages
axis scales; changing a ruler entry is not an exact CAD axis resize. See the
[observed limitation and CAD-04/CAD-07 acceptance](CAD-PLAN.md).

Done when for reconciliation: show requested/nominal drawing dimensions separately
from actual exported mesh bounds, retain conflicting-view warnings and require
review. A contradictory multi-axis fixture must expose the mismatch without a
manufacturing accuracy claim; CAD-04 separately proves an explicit editable resize
by independent reimport of the intended 80 x 40 x 30 mm geometry.

## B4 — Artifact exchange as a SOURCE

The package accepts images via "Send to…". It does not yet offer its STL / SVG / OBJ to the
picker.

Done when: the manifest declares `artifacts.provides` with a `list` route returning the caller's
artifacts (`{items, folders, nextCursor}` per BUILDING-EXTENSIONS), and the cockpit picker shows
a job's STL.

## B5 — Print progress read-back

Submission rows record the host's answer at upload time only.

Done when: `GET /printers/:id/status` results are attached to the latest submission on read and
the surface shows `printing 43 %` from the host's own progress field for each of the three hosts.

## B6 — Store-side execution of the framework-coupled route suite

`tests/routes.core.test.js` needs a core checkout and is excluded from the store-CI wildcard.

Done when: the suite is registered with the store's framework-coupled runner
(`scripts/security/run-framework-coupled-tests.mjs`) or an equivalent gate, and a red route test
fails a PR.

## B7 — Base sealing for one-sided point-cloud scans

A phone LiDAR scan of an object on a table has no underside, so the flood fill leaks and the lane
reports `closed: false`. The object rests on the bed plane, which is a fact the engine can use.

Done when: `fillSolidFromSurface` takes `sealBase: true` and treats the plane Z = 0 as solid
boundary (the footprint of the lowest occupied layer is capped before the flood); the lattice box
fixture without its bottom face then fills to exactly 72 000 mm³ with `closed: true`; a fixture
with a genuine side through-hole is NOT filled by the seal; the point-cloud route exposes the flag
and the report records `sealedBase: true`.

**Done in 0.4.0.** `fillSolidFromSurface(grid, closeRadius, { sealBase: true })` caps the holes
in the lowest occupied layer before the flood; the lattice box with its underside removed fills to
exactly 72 000 mm³ with `closed: true`; a 12 x 10 mm side window and a missing lid both still leak
with the flag on; `POST /jobs/:id/pointcloud` takes `sealBase` (an unreadable value is refused 422)
and the report and response record `sealedBase` with a warning that the base face is an assumption.
Cases: `engine-depth-lidar` (three) and `routes-core` (one), both registered in `tests/test-lab.yaml`.

## B8 — Hull + depth fusion in one job

`refineWithDepth` exists but nothing calls it from a job: the photo hull and a depth map cannot yet
meet on the same grid.

Done when: after B1, `POST /jobs/:id/depth` refines the job's CURRENT grid (the photo hull) rather
than a fresh one, the report's `viewsUsed` lists both the silhouette views and the depth views,
and the cup fixture (three photos of a solid cylinder + a top-view depth map) reconstructs the
cavity over HTTP.

**Done on `feat/package-backlog-sweep`.** The photo hull is carved by one helper
(`carvePhotoHull`) that both the photo lane and `reconstructHullWithDepth` use. The depth route
therefore refines exactly the grid `POST /reconstruct` would build from the same photos, settings
and ruler, not a fresh block. The report's `viewsUsed` lists the silhouette views and then the
depth views, once each, and the new `depthViews` names the depth ones. The method line reads
`Visual hull from 3 silhouettes (front, right, top), depth-carved from 1 range image (top)`.

Evidence:
- Engine (`engine-depth-upload`): front, right and top silhouettes of a cylinder plus a top range
  image of the cup carved from that hull recover the cavity voxel for voxel.
- HTTP (`depth.core.test.js`): the same three photos, then a range image rendered from an
  analytic cup on its own grid (as a sensor would see it). The cavity is recovered within 5 % of
  π·14²·45 mm³, over float32 and again over a real 16-bit PNG, which carves the identical volume.
  Refusals and another owner's 404 are covered too.

## B9 — Orientation cube: automatic view assignment

Assigning each photo a view is the last manual step of the photo lane. A printed paper cube with a
distinct marker on each face, placed beside the object, tells the camera which canonical view it
is looking at.

Done when: a deterministic marker detector (no model) reads the visible face marker, the image
upload assigns the view automatically when exactly one known marker is found, an unknown or absent
marker leaves the view unassigned, and six synthetic photos with markers reconstruct with no
manual assignment.

**Done on `feat/package-backlog-sweep`.** `detectFaceMarkers(raster)`
(`engine/raster/face-marker.ts`) runs Otsu on darkness, then 4-connected components. A square
component clear of the image edge is sampled as a (4 + 2)-cell grid, by majority over each cell's
central half. It must show a solid black border ring and mixed data cells, so a uniformly dark part
is never a candidate. Its 16 data cells are read against a six-code dictionary under all four
rotations.

The codes came from a deterministic greedy search (every row and column mixed, seven to nine black
cells). Any two faces, in any rotation, differ in at least 6 cells, and no face matches its own
rotation within 6; the spec re-verifies both. One wrong cell is tolerated. Exactly one known marker
names the view; none, an unknown pattern, or two markers leave it to the person, with a sentence
saying which.

`POST /jobs/:id/images` reads the marker and assigns the view when exactly one known marker is
visible and no other photo already holds that view. The row's `silhouette.marker` keeps the
decision and its reason, and the response gives `viewsFromMarkers`. `faceMarkerSvg(view, sideMm)`
prints a face.

As built:
- Video frames are NOT auto-assigned. A turntable clip shows one face marker, slightly turned, in
  several frames, and the first would win by upload order rather than by being square-on. B12's
  suggestions own video.
- The marker must be photographed near square-on: a candidate's sides must agree within 20 %.
  Perspective and skew are not corrected.
- The cube must stand clear of the object and be smaller than it in every photo. The silhouette
  keeps only the largest component.
- There is no download route or surface control for the printable faces yet.

Evidence:
- `tests/engine-face-marker.test.js`, 8 cases. Each face names its view beside an object. Rotations
  are reported. One wrong cell passes and two do not. None, unknown and two markers stay
  unassigned. A black square object and a too-small marker are ignored. The dictionary distances
  hold. Six marker photos go through the real silhouette extractor and reconstruct the 60 × 40 × 30
  box to exactly 72 000 mm³.
- `tests/markers.core.test.js`, 3 HTTP cases. Six photos arrive assigned and reconstruct to
  72 000 mm³ with no PATCH. A duplicate front, a plain photo and a smudged marker stay unassigned
  with their reasons. Video frames showing a marker stay unassigned.

## B10 — Consistency solve for registration

Extents propagate greedily from the known dimension through the views; a view whose two axis
estimates disagree gets their mean. A least-squares fit over all views at once would use every
silhouette and report a residual per view.

Done when: `registerSilhouettes` solves the three extents and per-view scales jointly (linear in
log space), the skewed fixture's registration reports a per-view residual instead of a single
warning, and the box and cylinder fixtures produce the same extents as today to within one voxel.

**Done (engine) on `feat/package-backlog-sweep`.** `registerSilhouettes` now runs ONE least-squares
fit. Each view says `log extent(axis) = log mmPerPx(view) + log pixels` for both its image axes.
The known dimensions are held exact and the normal equations are solved directly (Gaussian
elimination, no iteration). Axes no view connects to a measurement are still assumed and flagged,
as before. The registration gains `residuals: [{ view, u, v, disagreement }]`. `u` and `v` are the
signed fractions by which that view's outline exceeds the fitted extent, and `disagreement` is the
old 10 % proportion test measured against the joint fit. Warnings are per view and worst first.
Extents and scales are rounded to 12 significant digits, so solver roundoff (~1e-15) can never
push an extent across a voxel boundary.

What least squares can and cannot do (measured, not assumed):
- Three views forming ONE loop share its misfit equally. The skewed fixture's 40 % loop error
  becomes 10.6 % on each of front, top and right, and all three warn. No fit can tell which view in
  a single loop is skewed. The old code blamed the right view only because it was read last.
- A fourth view closing a second loop makes the skewed view carry the LARGEST residual (right 18 %,
  left 13 %, front and top 6.5 %). It does not isolate it: least squares averages, so the left view,
  which measures the same Y/Z pair, carries part of the error. Isolating it would need a robust
  (iterative) estimator, which this package's determinism contract rules out.
- Consistent views are unchanged. The box registers to exactly 60 × 40 × 30 from any single anchor
  axis (x, y or z), every scale is exactly 0.5 mm/px, residuals are exactly 0, and the carved box
  is still 72 000 mm³. The cylinder registers to exactly 40 × 40 × 50.
- The reconciliation case recorded under B3 (60 × 40 × 30 views, entered 80 × 40 × 30) still meshes
  to 70.00 × 40.00 × 30.00 mm, measured before and after the change. Per-view scale is now the
  geometric rather than the arithmetic mean of a view's two estimates, and at resolution 96 that
  difference stays inside one voxel.

Evidence: `tests/engine-registration.test.js`, 5 cases. Registered as `engine-registration`. The
existing `engine-reconstruction` skewed-view case still passes unchanged.

## B11 — Symmetry completion (opt-in, flagged)

Many printed parts are symmetric. When the person asserts a symmetry plane, the visible half can
be mirrored to complete a view that could not be photographed.

Done when: `reconstructFromSilhouettes` accepts `symmetry: 'x' | 'y'`, mirrors the carved grid
about the asserted plane through the footprint centre, records `mirrored` in the report and on the
drawing notes, and a half-visible fixture reconstructs to the full analytic volume.

**Done (engine) on `feat/package-backlog-sweep`.** `reconstructFromSilhouettes(views, known, {
symmetry: 'x' | 'y' })` unions the carved grid with its mirror about world X = 0 (or Y = 0), which is
where registration puts every silhouette's bounding-box centre. The grid is allocated symmetric
about that plane, so the mirror is an exact index flip (`mirrorUnion` in `occupancy-grid.ts`). It
only adds material, never removes it. The report gains `mirrored: { axis, addedVoxels, addedMm3 }`,
the method line says `mirrored about X = 0`, and a warning (so also a drawing note) says how many
mm³ were copied rather than seen. Any other axis is a RangeError before registration runs.

Evidence: `tests/engine-symmetry.test.js`, 5 cases. A U-shaped part with half a prong hidden in the
top photo measures 28 000 mm³ without the assertion and 36 000 mm³ (the analytic volume) with it,
matching the fully visible part voxel for voxel. A C-shaped part does the same across Y (22 000 →
28 000 mm³). An already symmetric part gains 0 voxels and says so. Registered as `engine-symmetry`.

Limit, as built: the mirror only restores material hidden INSIDE a view's bounding box.
Registration keys on each silhouette's bounding box, so a view that loses one side's extreme
registers off-centre and too small before any mirror runs. The fixtures hide an interior region for
that reason. Still open: the reconstruct route does not take `symmetry` yet, so the assertion is
engine-only until the job settings carry it.

## B12 — Video: automatic square-on frame suggestion

Video frames are sampled at a fixed rate and the person picks the square-on ones by eye.

Done when: a deterministic score (silhouette bounding-box aspect stability across neighbouring
frames plus minimal skew between the two axis scale estimates) ranks each frame per candidate
view, the surface proposes the best frame per view for confirmation, and a synthetic rotating-box
sequence yields its three axis-aligned frames as the suggestions.

**Done on `feat/package-backlog-sweep`, with one deliberate change to the score.**
`suggestSquareOnFrames` (`engine/grid/frame-suggest.ts`) keeps the skew term as written: the
view's two axis scale estimates, known size over pixel extent, compared in log space. The
first-difference "stability" term was measured and replaced. On a steady spin a 60 × 40 box also
shows the front's exact proportions at 67.4°, and that frame changes more slowly than the
square-on one (0.033 against 0.050 per step), so stability PROPOSES THE WRONG FRAME. The
replacement is a turning-point term on the silhouette area, measured against the neighbours: a
cusp on a steady spin, a plateau when the person pauses. It separates the two frames by sign. A
frame is proposed only when all of these hold:
- it sits at a turning point;
- it has object-bearing neighbours on both sides in the same clip (a clip's edge cannot confirm a
  turn);
- it is inside the registration's own 10 % threshold (`SCALE_DISAGREEMENT`, now exported).

So a view the clip never shows gets no proposal rather than the least bad frame. Frames are
proposed once each. Already-assigned frames are excluded but still count as neighbours.

`GET /jobs/:id/frame-suggestions` ranks the job's video frames (`frame-NNN.png`, split into clips
where the numbering restarts) for each view not yet assigned, from the silhouette stats stored at
ingest. The surface's "Suggest views from the video" lists each proposal with an assign button;
nothing is assigned until the person clicks. It also names the views the clip never showed and
says when fewer than three dimensions were known, since proportions were then not compared.

Evidence:
- `tests/engine-frame-suggest.test.js`, 12 cases. A synthetic turntable spin of a box yields
  its 0°, 90° and 180° frames. The exact 67.4° mid-turn frame is not proposed. A side→front→top
  sweep yields right, front and top. Also covered: pause, clip edge, never twice, the unseen view,
  exclusion and clip boundaries, refusals.
- `tests/frames.core.test.js`, 2 HTTP cases. A turntable video goes through the real video route
  with a fake ffmpeg. Front, right and back get frames 3, 9 and 15; top, left and bottom get none.
  After the person assigns front, that view and frame drop out.
- `tests/surface-suggest.test.js`, 3 VM cases on the packaged closures. Asking only reads, and
  "assign all" writes exactly the proposed pairs. The panel has not been exercised in a real
  browser.

## B13 — Printability pre-check beyond topology

`printable` is a topological verdict. A part can be watertight and still have a wall thinner than
the nozzle or an unsupported overhang.

Done when: a distance transform over the occupancy grid reports minimum wall thickness and the
largest overhang angle given a nozzle diameter and a layer height (both inputs, never literals),
the report gains `printChecks`, the drawing notes list any failing check, a 0.6 mm wall at a 0.4 mm
nozzle is flagged thin, and a solid cube flags nothing.

**Done (engine) on `feat/package-backlog-sweep`.** `evaluatePrintChecks(grid, { nozzleMm,
layerHeightMm, perimeters })` in `engine/grid/print-checks.ts`; `finishFromGrid` puts the result on
every report as `printChecks` and `exportArtifacts` writes each failing check onto the drawing notes.
The thinnest wall is twice the smallest inscribed sphere on the medial ridge of an exact squared
Euclidean distance transform (three separable passes), exact for an odd voxel count and one voxel
conservative for an even one. The limits are derived from the inputs, not typed in: a wall must clear
`perimeters × nozzleMm`, an overhang must stay under `atan(nozzleMm / layerHeightMm)`, and a layer
taller than the nozzle is refused.

The overhang angle does NOT come from the distance transform. It is the outward normal averaged over
a sphere of `normalRadiusVoxels` (default 4), with the build plate counted as solid. Measured on
voxelised ramps from 10° to 85° (two lean directions, two voxel sizes), it reads between 0.7° shallow
and 6.0° steep. A cubic window read up to 10° steep, and a PCA plane fit was worse at the corners.
`OVERHANG_READING_BAND_DEG` publishes the band and the spec asserts it.

Evidence: `tests/engine-print-checks.test.js`, 8 cases (a cube flags nothing; the 0.6 mm wall is
thin at 0.4 mm and passes at 0.25 mm; a thin fin is located; a ceiling reads 90°; the same 55° ramp
passes on 0.2 mm layers and fails on 0.4 mm layers; the band holds; failures reach the SVG; RangeError
refusals). Registered as `engine-print-checks` in `tests/test-lab.yaml`.

Still open: the job routes do not yet accept a nozzle or layer height, so an app build is checked
against the published defaults (0.4 mm / 0.2 mm / 2 perimeters) until the settings body carries them.

## B14 — Native LiDAR ingest with a pairing token

The `.ply` reaches the package through the browser today. The native iOS scanner scaffold from
ADR-111 (`clients/ios-spaces-scanner`) can post directly.

Done when: `POST /jobs/:id/pointcloud` accepts a `Bearer` PAT minted by the kernel's pairing rail
(the `spaces` package's `/pair` pattern), the native app posts a `.ply` with it, and the job
reconstructs under the pairing token's owner — never anonymously.

## B15 — Real-device evidence for the LiDAR lane

Every LiDAR claim so far rests on a simulated sensor and a lattice-sampled fixture.

Done when: one real Scaniverse or Polycam `.ply` of a hand-sized object goes through the
point-cloud lane (after B7), and the README carries an evidence row with the file name, point
count, voxel size, `closed` flag, mesh volume and the printable verdict — pass or fail, recorded
as observed.

## B16 — Slicer and frame extraction configured on the local box

`SCAN_TO_PRINT_SLICER_CMD` is unset on the box, so G-code answers 409, and the video lane has not
been exercised on a real clip.

Done when: the swarm env sets the slicer command for a slicer present in the api container,
`/capabilities` reports `slicerConfigured: true` and `video.configured: true`, one job's G-code
submission reaches an OctoPrint host (or a recorded fake) with `state: printing`, and one real
phone clip yields frames that reconstruct.

## B17 — Run the surface-freshness browser case in the Test Lab

The `surface-freshness` Test Lab case is registered but stays pending with the reason
`Additional prerequisites require verification: harness:core-test-fixtures.` Its fixture imports
`isolated-browser.ts` from the framework checkout's `tests/fixtures/`, and the runner image ships no `tests/`
tree (checked 2026-09-14 in `oshal-local-api`: `ls /app/tests` — no such directory). Declaring only
`harness:oshal-core-root` would make the Lab run it straight into a module-not-found failure, so
the case names the missing capability instead.

It is not unguarded: `tests/surface-freshness.core.spec.mjs` runs in the manual framework-coupled gate
(`scripts/security/run-framework-coupled-tests.mjs`), green on 2026-09-14 (7 pass).

**Done when:** core's Test Lab runner image carries the shared browser fixtures behind a
probe-verified prerequisite (a core change that needs operator approval), this case declares that
prerequisite in place of `harness:core-test-fixtures`, and one Lab run of it passes on the box — a
real run of a few seconds, not a sub-second decline under load.

When it can run: the runner image's Chromium requests `/favicon.ico` and logs a 404 as a console error, so the fixture server must answer it (204), as animatronics' and circuit-lab's fixtures do - otherwise every "no page errors" assertion fails in the sandbox and passes on a host browser.
