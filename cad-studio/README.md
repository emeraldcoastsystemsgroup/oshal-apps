# CAD Studio

A real CAD kernel — Open CASCADE Technology (OCCT) through CadQuery — that the swarm can **drive**.
A part is a **base** plus an **ordered feature list**; every change replays the list on the kernel
and re-exports **STEP** (real CAD geometry), **STL** (for printing), four **hidden-line drawing
views** and a **report** (extents, volume, mass at a density, validity). The person edits in the
studio, the right-rail concierge edits by talking, and any MCP client edits through the same
route-backed tools — one model, one history, iterated.

The kernel runs in the package's **own container** (`engine/`, the aero-lab shape); the api verifies
the container's engine build hash before the first request, so a stale container answers with the
install command instead of a wrong model.

## Use it

Version 0.1.1 uses the core's shared STL preview. Upgrade core first so
`/shared/ui/js/stl-viewer.js` exposes `OSHALStlViewer.apiVersion === 1`, then
install this package. A missing or incompatible shared viewer produces an
explicit update error. The small package adapter preserves the existing studio
interface; the kernel and model history remain package-owned. This preview-only
update does not change the engine build hash or require an engine rebuild.

From the core checkout, `npm run test:shared-stl-viewer` tests both CAD and Scan
pages with real Chromium/WebGL and synthetic HTTP responses. It proves shader
compilation, drawing and viewer lifecycle, separately from the kernel tests below.

Open `/cockpit/?app=cad-studio`.

1. **New part** — a box to start (or open a Scan to Print job's outlines, or send an STL here from
   anywhere in the swarm — ADR-139 "Open in CAD Studio").
2. **Add features** in the right rail — the form is generated from the contract the server
   enforces: hole, boss, box-add, box-cut (pocket / slot), sketch-extrude, revolve, sweep and loft
   (each add or cut), fillet, chamfer, shell, cut-plane, scale, mirror, rotate, translate. Every add / edit / disable / move /
   remove **rebuilds the part** and produces a new **revision**. A feature the kernel refuses (a
   fillet radius larger than the edge allows) is shown **skipped with the kernel's reason** — the
   part stays buildable; fix the number. A feature that takes longer than the per-feature budget
   (60 s unless the part's settings say otherwise) is refused the same way; **Stop rebuild**
   halts a rebuild that is running and the part stays at its last good revision.
3. **Or talk** — "put a 6 mm hole 10 mm from the left edge and round the vertical edges 2 mm".
   The designer calls the same tools; the studio refreshes as it works.
4. **Read the report** — extents, volume, mass at the density you set, faces / edges / validity,
   centre of mass — from the kernel, not an estimate.
5. **Download** STEP, STL, the four views (front, top, right, isometric), the report. **Restore**
   any revision to undo.

Printing stays in Scan to Print behind its explicit confirmation: download the STL and send it
from there.

## The frame and the contract (the same words the bot reads)

Millimetres, right-handed, **Z up**; the footprint is centred on X = Y = 0, the part rests on
Z = 0, the front faces −Y. "10 mm from the left edge" of a 60 mm wide part is X = −20. The full
contract — every feature's parameters, units, ranges, the edge / face selectors, the rules — is
published by `GET /api/cad-studio/capabilities` and asserted against the engine by spec. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Determinism: same base + same list → same STEP and STL bytes (the STEP header's clock and
per-session counter are pinned).

## The engine container

The oshal api image is Alpine and cannot host the OCCT wheels, so the kernel runs in a container
built **locally from upstream** (`python:3.11-slim-bookworm` + the PyPI pins in
`engine/requirements.txt` / `requirements-lock.txt`; nothing third-party is committed and the
image is never published). After installing or updating cad-studio, run once from the host — the
studio's engine-down banner prints this exact command:

```sh
docker exec <api-container> sh /app/workspace-shared/deployed-apps/cad-studio/engine/install-engine.sh
```

It builds `oshal-cad-studio-engine:local`, starts it on the stack network (its own compose project
`oshal-cad-studio-engine`, alias `cad-studio-engine`, no host port, read-only root, all
capabilities dropped, 3 GB memory cap) and runs a real-kernel self-test. Transport: the api holds
one persistent TCP connection to the bridge (`cad-studio-engine:7412`, override with
`CAD_STUDIO_ENGINE_ADDR`); one connection owns one worker process, requests are serialised, a
timeout kills the worker by closing the socket, and the first line is a hello with the engine
build hash the api checks against this package's `engine/` tree.

Licences PyPI publishes for the pins: CadQuery Apache-2.0, cadquery-ocp (OCCT) LGPL-2.1, casadi
LGPL-3.0, numpy BSD, ezdxf MIT, nlopt LGPL, the rest MIT / BSD.

## Layout

```
oshal-app.yaml            manifest — one mount, one bot, nine route-backed tools, one ribbon tile
src-routes/               TypeScript sources
  cad-studio-routes.ts    the mounted factory: surface, assets, /capabilities, one engine client
  model-routes.ts         models, features, rebuild, restore, artifacts, mesh base upload
  rebuild-service.ts      one rebuild: engine round-trip → exports → revision (per-model lock)
  feature-contract.ts     the contract (mirrors engine/cad_worker.py) — validation + description
  engine-client.ts        persistent TCP client to the bridge (hello / build hash / timeouts)
  engine-build-hash.ts    the build hash, computed exactly as the bridge computes it
  model-store.ts          every SQL statement, owner-scoped
  data-dir.ts             artifact layout <root>/<sha(sub)>/<modelId>/<revision>/
  home-summary.ts         ADR-145 Home tile (import-free)
  package-smoke.ts        canonical CORE-05 readiness probe
routes/                   compiled CommonJS (committed; the manifest points here)
engine/                   the kernel worker (cad_worker.py), its real-kernel tests, and the
                          container (Dockerfile, compose, TCP bridge, installer)
tools/                    the surface (cad-studio.html + .js) and the WebGL STL viewer (-gl.js)
personas/                 the designer concierge (package copy for the registrar)
migrations/               001 — models, revisions + owner RLS
docs/                     ARCHITECTURE.md (the contract)
tests/                    contract-features, engine-client (dependency-free), routes.core (framework-coupled)
```

## Configuration (all optional)

| Variable | Meaning |
|---|---|
| `CAD_STUDIO_ENGINE_ADDR` | Bridge address. Default `cad-studio-engine:7412`. |
| `CAD_STUDIO_DATA_DIR` | Artifact root. Default `<shared workspace root>/cad-studio`. |
| `OSHAL_API_CONTAINER` | Names the api container in the printed install command (falls back to the hostname). |
| `CAD_ENGINE_MEM_LIMIT` | Engine container memory cap for the installer. Default `3g`. |

## Test

The manifest activates six Test Lab cases, including metadata readiness. The
contract suite requires Python 3 for its cross-language build-hash comparison;
the engine-client suite needs only Node. The HTTP suite requires a framework
checkout and uses temporary files and a fake engine bridge. The real-kernel
Python suite declares an external runner and its engine-container prerequisite;
registration does not make that runner available or claim the suite has run.
The browser lifecycle suite also needs the framework checkout and Chromium. It
loads the actual editor and shared STL renderer with synthetic HTTP responses;
it proves current part/revision selection and retention of newer feature input,
separately from kernel or manufacturing acceptance.

```bash
cd c:/Projects/oshal-apps/cad-studio
node --test "tests/*-*.test.js"                                         # Node + Python 3; no npm/framework install, runs in store-ci
OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js  # framework-coupled (express/multer) + fake bridge
OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/surface-lifecycle.core.spec.mjs  # actual page/WebGL + synthetic HTTP
docker run --rm -v "$PWD/engine:/engine:ro" oshal-cad-studio-engine:local sh -c 'cd /engine && python -m unittest discover -s tests'  # real kernel
```

Load-bearing specs:

- `contract-features.test.js` — the contract names exactly the engine's bases, features and
  selectors; a typo'd parameter is refused naming the field; the Node build hash equals the
  bridge's Python build hash.
- `engine-client.test.js` — the transport against a fake bridge: stale build hash → the install
  command, timeout kills and reconnects, a dropped bridge fails the queue.
- `routes.core.test.js` — the HTTP surface end to end with the real engine client and a fake
  bridge: revisions per edit, refusals with reasons, owner scoping, artifacts by revision, 503
  naming the install command when the bridge is gone.
- `surface-lifecycle.core.spec.mjs` — held detail, STL headers/body, rebuild,
  polling, revision-list and deletion responses cannot replace another part or
  retired revision; late feature submission retains newer manual form input.
- `engine/tests/test_cad_worker.py` — the real kernel: every base and feature to analytic
  volumes, refused features skipped with reasons, STEP byte-stable, mesh sewing round-trip.
