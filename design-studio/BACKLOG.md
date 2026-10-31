# Design Studio — backlog

Each entry has done-when criteria. An entry is open until its status line says otherwise; the README
describes only what is built.

## B1 — The design partner cannot call the engines' tools on the native kernel — CLOSED in 0.4.0 by engine orders

A manifest still cannot grant another package's tools. The partner files `design-engine-order` instead and the person's open page runs it with their session, so nothing depends on an operator grant. Evidence: `tests/order-model.test.js`, the order case in `tests/routes.core.test.js`, the order case in `tests/design-studio.spec.mjs`, and the live rail turn in the 0.4.0 proof.

The persona names the engine packages' tools (`cad-*`, `circuit-*`, `embodied-*`, `print-service-*`) and
ADR-203 D3 assigns them "where the kernel allows a bot that assignment". A package manifest cannot grant
another package's tools to its bot: a route-backed tool calls its own package's routes, and a tool grant
to an agent is an operator action in the cockpit (core `docs/apps/package-tools.md`, "Bots in an adopted
package": `PUT /api/agents/<agentId>/tools/groups/<group>`). Until then the partner reads only this
package's rows and tells the person which poster button does the engine read through their session.

Done when: the design partner, on the Spark, calls `embodied-physics-reports` and `circuit-list-designs`
from the rail and binds what it read with `design-bind-artifact`; the grant path (manifest field or the
operator step) is written in the README; a Test Lab case proves the turn.

## B2 — Fabricate is recorded, not made — CLOSED in 0.2.0 (ADR-203 D7, lane @ds-fab)

Was: the Fabricate poster read *printable* from the design's programs and **Make the print set** recorded
what a manifest written outside the page said. Now the page makes the set: every Design-phase part with a
program is exported once through CAD Studio with the person's own session (an embodied part becomes the
person's own CAD Studio part, tagged with the product and the program's hash so a second run rebuilds
nothing; a bound CAD Studio part is read as built), this package parses each STL back and checks it
watertight, writes `PRINT-SHEET.md` from the parts' own fields, `bom.csv` from the bought rows and
`manifest.json` with every file's sha256 under its lasting directory, serves them by name, reads
*fabricated* from its own listing, and the closure records the manifest's sha256. A part without a program,
not built, refused by the engine or exported with an open mesh is listed unprintable with the reason, never
skipped. A printer chosen in Settings gets one file at a time through the print service's posted-model
route after the person confirms.

Evidence: `tests/print-set.test.js` (4 cases), the print-set case in `tests/routes.core.test.js` (10/10),
the three Fabricate cases in `tests/design-studio.spec.mjs` (11/11 in Chromium), and
`tests/print-set.engine.spec.mjs` (one part through `oshal-cad-studio-engine:local`: 1004 triangles,
3.55 g at 1.2 g/cm³, 16 × 16 × 16 mm); 

## B3 — The body contract's tick rate and sense rates have no engine source

`plant.tickS` and `senses[].rateHz` are null and named in `missing`: the rail's node listing
(`GET /api/embodied/physics/status` nodes[]) carries no `tickHz` even though the hexapod node's hello does,
and no engine reply states the LiDAR's or the IMU's rate (the bought rows carry mass and price only).

Done when: embodied publishes the node's hello (`tickHz`) on the rail listing and the senses' rates on
the design's rows or the node's capability manifest, this page records them in the controller and sensors
reads, and `GET /projects/{id}/body` publishes them with `missing` empty for a closed spider.

## B4 — The spider's Electrical phase reads *holds* only after the person's own solve

ADR-203 D5 says the page reads *holds* on day one. The example binds Circuit Lab's `hexapod-power`
example by name; a solved run belongs to a person's own design, which only **Open in Circuit Lab** (or
`circuit-create-design`) creates, so day one reads *drafted* with the example found in the lab and one
press makes the copy, solves it and binds it. The page never adopts another person's run or a published
number as a verdict.

Done when: Circuit Lab publishes a solved example's readings through a route (its evaluation note's
numbers as the engine measured them) and this page reads *holds* from that reply for a product bound to
the example alone, saying it is the example's solve and not the person's.

## B5 — The print set is made by the page, so the design partner cannot make it from the rail

On the native kernel a package route reaches neither a sibling package nor another package's engine:
`engine.exchange` relays only to the engine pinned for the calling package in `OSHAL_PACKAGE_ENGINES`
and the sandbox has no network (circuit-lab B17; core `crates/oshald/src/package_engine.rs`). So the parts
go through CAD Studio from the browser with the person's session, and this package's routes only check,
write and serve the set. A set begun in a browser that closes mid-run stays unfinished and the poster
says so (*a set begun … was not finished (n parts pending): make it again*). The partner can read the
result (the fabricate binding and closure) but not make it.

Done when: either the kernel lets a package call a sibling package's route for the admitted caller
(the ADR-203 D3 grant path, B1) so a `design-make-print-set` tool can run the same steps server-side, or
the operator pins this package to the CAD Studio engine in `OSHAL_PACKAGE_ENGINES` and a route runs the
programs through `engine.exchange` with the bridge protocol; and a Test Lab case proves a set made from
the rail.

## B6 — Orientation, layer height and supports are "not stated" for the spider's parts

The sheet takes orientation, layer height and supports from the part's own fields (`orientation`,
`layerHeightMm`, `supports`) and never invents them. embodied's printed rows carry `printNotes` prose
("collars up, 3 skins, 20 % gyroid"), `material`, `qty`, `option` and `link`, but none of the three
fields, so the spider's sheet reads "not stated" in those columns with the notes beside them.

Done when: embodied's `buildHexapod` rows state the three fields and the spider's sheet shows them; the
browser case asserts the sheet line with the design's own words.

## B7 — Send to printer goes through the print service's posted-model route, not the `print-to-3d-printer` tool

`print-to-3d-printer` takes a scan job id (`jobId`), not a posted model; the page sends one file through
`POST /api/scan-to-print/service/print` (multipart `model` + `printerId`), the same `sendModel` path the
service takes for every caller, under the owner's auto-start, after the person confirms (as the tool asks).
The reply is recorded beside the set in the service's words.

Done when: scan-to-print's tool takes a posted model or a design-studio print-set file reference, so the
design partner (B1 granted) can send a file from the rail under the tool's ask-by-default grant.

## B8 — The generated plant: what the lift's chain does not do yet (ADR-203 D9, lane @ds-plant)

The plant from the design (the Mechanism, embodied's `plant.*` ops, the reach task and gate) carries the
lift end to end on the real engines. What it does not carry, each with its reason and done-when:

- **Meshes through the kernel.** embodied's builder takes a part's STL as a mesh geom (`meshStl`, proven in
  `engine/tests/test_plant.py`), but a package route body on the native kernel is capped at 100 KB and the
  lift's smallest STL is larger, so the page sends the kernel's extents and the plant's parts are boxes.
  Done when: the spec names a part's STL by a reference the engine can redeem (an artifact handle, or
  CAD Studio's engine pinned beside embodied's in `OSHAL_PACKAGE_ENGINES`) and the lift's carriage is a
  mesh in the plant, with the browser case asserting `mesh: true` in the load reply.
- **Training is started by the page, so the partner cannot start it from the rail.** The plant routes are
  embodied's; the partner reaches them only through B1's grant path. Done when: B1, and a
  `design-train-plant` tool that posts the spec the route composed.
- **A product with a mechanism but no lifting line in the brief** builds its plant but has no task:
  the poster says so and Train the policy is not offered. Done when: a second task kind (a reach to a
  world position, a swing to an angle) is read from a line and the Mechanism screen lets the person
  choose it.
- **The mechanism's joint origins are typed in millimetres**, not placed on the parts' geometry. Done when:
  the Mechanism screen offers a part's faces and holes from the kernel's report as origins.

Embodied-side limits (a floating base, a second chain's exact inverse kinematics, a contact between parts)
are embodied's B33.
