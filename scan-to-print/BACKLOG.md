# Scan to Print — backlog

Each entry has done-when criteria. Nothing here is built; the README and ARCHITECTURE describe
only what is.

## B1 — Depth-image upload lane (real LiDAR / ToF range images)

`carveDepth` and the `DepthMap` contract are shipped and exercised with the simulated sensor. What
is missing is an **input** for a real device's range image.

Done when: `POST /jobs/:id/depth` accepts a 16-bit PNG or a float32 raw range image plus the
`DepthMap` header fields (view, mmPerPx, centre pixel, plane), calls `refineWithDepth` on the
job's current grid, and the report's `lane` reads `depth`; a spec uploads the `renderDepth`
output of the cup fixture and asserts the cavity is recovered over HTTP.

## B2 — Perspective range images → canonical orthographic view

Phone depth cameras deliver perspective range images. The engine's contract is orthographic in a
canonical view.

Done when: a pure function re-projects a perspective range image (intrinsics + pose in the world
frame) into a `DepthMap` for the nearest canonical view, with a spec that renders a perspective
image of the cup fixture synthetically, re-projects it, and carves within one voxel of the
orthographic result.

## B3 — ArUco / known-size fiducial for automatic scale

Today the person enters one ruler measurement. A printed fiducial of known size in the frame would
set the scale without typing.

Done when: a marker detector (deterministic, no model) finds a fiducial square in a photo, the
registration takes its pixel size as the scale anchor for that view, and the report's
`dimensionSources` gains `fiducial`.

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

## B8 — Hull + depth fusion in one job

`refineWithDepth` exists but nothing calls it from a job: the photo hull and a depth map cannot yet
meet on the same grid.

Done when: after B1, `POST /jobs/:id/depth` refines the job's CURRENT grid (the photo hull) rather
than a fresh one, the report's `viewsUsed` lists both the silhouette views and the depth views,
and the cup fixture (three photos of a solid cylinder + a top-view depth map) reconstructs the
cavity over HTTP.

## B9 — Orientation cube: automatic view assignment

Assigning each photo a view is the last manual step of the photo lane. A printed paper cube with a
distinct marker on each face, placed beside the object, tells the camera which canonical view it
is looking at.

Done when: a deterministic marker detector (no model) reads the visible face marker, the image
upload assigns the view automatically when exactly one known marker is found, an unknown or absent
marker leaves the view unassigned, and six synthetic photos with markers reconstruct with no
manual assignment.

## B10 — Consistency solve for registration

Extents propagate greedily from the known dimension through the views; a view whose two axis
estimates disagree gets their mean. A least-squares fit over all views at once would use every
silhouette and report a residual per view.

Done when: `registerSilhouettes` solves the three extents and per-view scales jointly (linear in
log space), the skewed fixture's registration reports a per-view residual instead of a single
warning, and the box and cylinder fixtures produce the same extents as today to within one voxel.

## B11 — Symmetry completion (opt-in, flagged)

Many printed parts are symmetric. When the person asserts a symmetry plane, the visible half can
be mirrored to complete a view that could not be photographed.

Done when: `reconstructFromSilhouettes` accepts `symmetry: 'x' | 'y'`, mirrors the carved grid
about the asserted plane through the footprint centre, records `mirrored` in the report and on the
drawing notes, and a half-visible fixture reconstructs to the full analytic volume.

## B12 — Video: automatic square-on frame suggestion

Video frames are sampled at a fixed rate and the person picks the square-on ones by eye.

Done when: a deterministic score (silhouette bounding-box aspect stability across neighbouring
frames plus minimal skew between the two axis scale estimates) ranks each frame per candidate
view, the surface proposes the best frame per view for confirmation, and a synthetic rotating-box
sequence yields its three axis-aligned frames as the suggestions.

## B13 — Printability pre-check beyond topology

`printable` is a topological verdict. A part can be watertight and still have a wall thinner than
the nozzle or an unsupported overhang.

Done when: a distance transform over the occupancy grid reports minimum wall thickness and the
largest overhang angle given a nozzle diameter and a layer height (both inputs, never literals),
the report gains `printChecks`, the drawing notes list any failing check, a 0.6 mm wall at a 0.4 mm
nozzle is flagged thin, and a solid cube flags nothing.

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
