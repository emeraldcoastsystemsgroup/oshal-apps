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
