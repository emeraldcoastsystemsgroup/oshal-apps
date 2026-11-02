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

## B9 — Built is not designed: nothing checks that parts fit or hold (found on the owner's printer, 2026-10-31)

The partner built `bench lift` as three bare boxes, the poster read parts-complete, and one reached the printer. 0.4.6 reads a bare box as `blocks` and tells the partner to design parts for what they do. Nothing yet checks a part against another: the carriage's pocket against the column, a hole against a fastener, a printed wall against a load. The plant simulates every part as a box of its size and mass, so a certified plant says the motor lifts the load in time, not that the parts fit.

**Done when:** a Design check reads each joint's two parts from CAD Studio and answers fit or interference with the clearance in mm, a refusal blocks parts-complete, and a strength estimate for a named load is either measured by an engine or the poster says none is.

## B10 — The partner runs out of tool steps on a real design

Each `cad-edit` is one order and one tool step, and a turn has few. Redesigning three parts stopped partway with the mounting holes undone. The persona says to build features in the `cad-create` list, but that does not help an edit.

**Done when:** an order edits a part with a list of features in one step, and the partner finishes a three-part redesign in one turn on the Spark.

## B11 — `bench lift` is unfinished and its policy lost

On the owner's account: the carriage has a real pocket; the base plate and the column are still plain blocks; the carriage has no mounting holes (the partner asked top or front, unanswered); the plant is from the older geometry; the print set is stale. The 60 000-step policy finished 5.7 mm off against a 5 mm tolerance and the gate refused it at 5 of 1875 control steps, while the PD baseline reached 5 of 5 in 3.58 s. The old solid-block file is on the P2S's storage and should be deleted there.

**Done when:** the three parts carry their features, the plant is rebuilt, a policy passes the gate or the baseline is chosen as the controller by name, a new print set is made and one part is printed and fitted on the column.

## B12 — A person who is not an administrator has never run this

Every proof ran as the operator persona or the owner. The automated path cannot grant a test person an application role. Native route tools run under the caller's admission (`crates/oshald/src/package_api_tools.rs`), which is the reason to expect it works, not evidence that it does. A person needs design-studio, cad-studio, circuit-lab, embodied and scan-to-print each assigned; there is no one engineering role.

**Done when:** a composite template grants the engineering shelf in one assignment, and a non-administrator signs in and runs New product, a partner-built part, Simulate and Make the print set.

## B13 — A new package reads "Application unavailable" with no reason

Installing a package grants nobody but the operator. The owner's account got `403 no tier over design-studio`, and the cockpit said only to ask an administrator. It cost a round of testing, because every proof until then had been the operator's.

**Done when:** a delivery of a new package says who holds it, the cockpit names the missing access to an administrator, and the delivery recipe has an assignment step.

## B14 — A stopped engine is invisible until a person hits it

`oshal-cad-studio-engine` and `oshal-scan-to-print-engine` had both been stopped since 2026-10-23 with their loopback links still active. Each surfaced only as a failure in the middle of work. What stopped them is not established.

**Done when:** Settings and the poster read each engine's liveness before a button is pressed, and the host's health check alerts on a stopped engine whose link is up.

## B15 — Phases with no engine

Mechanical on a machine that is not the spider, Sensors, and the spider's heat requirement are reasoned: the words are recorded and nothing measures them. A thermal engine does not exist on this shelf.

**Done when:** each reasoned phase either has an engine or its closure names that no engine measured it; a thermal solve of the Pi bay is a named option in the brief.

## B16 — Test products left under the operator persona

`spider-18`, `the hanger`, `lift-1` and `bracket hook` belong to the operator persona, not to the owner. They hold CAD parts and a Circuit Lab copy, and they are test data.

**Done when:** they are deleted or kept on purpose.

## Roadmap

Status as of 2026-11-01. The full picture across packages is in the kernel's `docs/backlog/design-to-build.md`.

| Stage | Item | State |
|---|---|---|
| Now, paused for publishing | B11 finish the lift through one fitted print | waiting on the owner's answer in the rail |
| Next | B9 fit check, B10 batched edits | not started |
| Next | B12 and B13: a person other than the owner | not started |
| Then | B14 engine liveness, B8 meshes and more task kinds | not started |
| Later | B15 thermal and other engines | not started |
