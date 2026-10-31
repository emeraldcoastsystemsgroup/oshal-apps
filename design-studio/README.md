# Design Studio

## What this package needs on a swarm

Everything ships in the packages. Design Studio has no engine of its own; each phase reads the package that owns it, with the signed-in person's session.

| Phase | Package (optional dependency) | Its engine |
|---|---|---|
| Design, Fabricate | `cad-studio` | `cad-studio/engine/install-engine.sh` |
| Electrical and power | `circuit-lab` | `circuit-lab/engine/install-engine.sh` |
| Mechanical, Sensors, Controller, Simulate | `embodied` | `embodied/engine/install-engine.sh` (the certified spider gait ships in its image) |
| Send to printer, slicing | `scan-to-print` | a printer and a slicer registered in its Printers panel |

Install what the products need; a phase whose package is absent says so on its poster and every other phase keeps working. A person who is not an administrator needs each package assigned to them, not Design Studio alone.

**The design partner works in the engines** through `design-engine-order`. A package route cannot reach a sibling package, so the order waits in this package's table and the person's open product page runs it with their session (`tools/design-studio-orders.js`). The vocabulary is closed and carries no URL. Closing a phase, ticking the bench checklist and sending to a printer stay the person's.

The design-to-build **process** as one application, for anything (ADR-203): a clothes hanger, a widget,
a refrigerator, the spider. A **product** is a brief plus a chain of **phases** from a fixed vocabulary,
in this order:

| # | Phase | What it must produce | Engine | What closes it |
|---|---|---|---|---|
| 1 | brief | the product in words: what it is, what it must do (one requirement per line), its targets | reasoned | the person says the brief is right (**Confirm the brief**) |
| 2 | design | the parts model: printed parts as CAD Studio programs, bought rows, the mass budget, joint loads | cad-studio, embodied | parts-complete: the budget closes, every load inside its rating, every part has a program |
| 3 | mechanical | every actuator sized from its worst stance | embodied, reasoned | every joint inside its continuous torque |
| 4 | electrical | the bus, the pack, the regulators, solved as one transient | circuit-lab | the rails hold under stall and the runtime is stated by the solve |
| 5 | sensors | each sense with a mount, a rate and a reader | embodied, reasoned | each named sense is a row and a part of the design |
| 6 | controller | one program for the plant and the hardware, a node on the rail | embodied | a node of the kind is on the rail |
| 7 | simulate | the plant (embodied's own for the spider; generated from the design's mechanism for any other machine), a baseline, a trained policy, the certification gate | embodied | a certificate bound to the policy hash and the engine build |
| 8 | fabricate | the print set: every part exported once through CAD Studio as a watertight STL, the sheet from the parts' own fields, the BOM, a sha256 manifest; a printer takes one file at a time | scan-to-print, cad-studio, embodied | a finished set at the current design revision, every file watertight, no part unprintable; the closure records the manifest's sha256 |
| 9 | build | the assembly in order, bring-up, the certified brain on the body | reasoned | only the bench: a person ticks every step; no software closes it |

A product carries the subset its brief needs: a hanger is phases 1, 2, 8, 9; the spider is all nine; the
lift (example `lift-1`) is seven, and its plant is generated from its own design (ADR-203 D9, below).
Each phase binds to the **engine** whose artifact it produces, or is `reasoned` when no engine on the
swarm solves it. The package owns no engine and copies none: it stores products, briefs, bindings and
closures per person (three private tables) and reads the engines through their own routes.

**A phase's stage is computed when the page is read, never stored** (ADR-203 D2): `concept → sized →
parts-complete` for design, `drafted → solved → holds` for electrical, `baseline → trained → certified`
for simulate, each from the owning engine's reply through the person's own session. A **closure** is a
row the person or the design partner writes with the engine's evidence line and the artifact revision
it was read from; a closure whose artifact has moved on reads as **stale**. An absent engine reads
"no engine on this swarm for this phase"; a failed read is shown, never swallowed.

## Use it

Open `/cockpit/?app=design-studio`. Four screens (ADR-203 D4):

1. **Products** — your products as posters; the whole poster opens the product. One button: **New product**.
2. **New product** — the walkthrough that writes the brief: the name; what it is, in one line; what it must
   do, one requirement per line; the targets (mass, size, cost, runtime, each optional). The phase chain is
   proposed from the requirement lines with the engine each phase will use (a line about motors or loads asks
   for a mechanical spec, power for electrical, senses for sensors, behaviour for a controller, movement for
   the simulator) and the reason per phase is shown; untick what you do not want, press **Create**. A need no
   engine on this shelf solves (a thermal one) is named, not dropped. The proposal is the package's rules over
   the lines (`POST /api/design-studio/plan`); the design partner on the rail revises the chain with
   `design-plan-phases`.
3. **Product** — one poster per phase in chain order: the stage line as read from the engine, the big
   figure, the closure line, and **one button**: *Confirm the brief* / *Edit the brief*, *Open in CAD Studio*,
   *Open the design*, *Open in Circuit Lab*, *Node status*, *Run the baselines*, *Certify*, *Make the print
   set*, *Start the build*; for a product whose plant is generated from its design, *Create the parts in CAD
   Studio*, *Build the plant*, *Run the baselines*, *Train the policy*, *Certify*, and a second plain button on
   the Design poster, **Define the mechanism**. When an engine's reply meets the phase brief's bar and the phase is open, the
   button becomes **Close the phase**: it binds the engine reply excerpt it read and records the closure with
   the evidence line and the revision. *Start the build* opens the checklist (ADR-203 D8): the assembly order
   from the design's parts by link, the bring-up steps from the controller, the certified brain's load door;
   each tick is a closure of one step, and the poster says no software closes the phase. *Make the print
   set* makes it (below); the Fabricate poster carries a second, plain button, **Send to printer**, only
   when a set exists and a printer is chosen in Settings.
4. **Mechanism** (from the Design poster of a CAD-bound product) — the part that is ground, a row per joint
   (parent, child, hinge / slide / fixed, axis, range, the child's origin in the parent, the motor row that
   drives it, the stated gear ratio), the payload, and the task read from the brief's line. The spider's
   design is embodied's own, so its screen is read-only (its joints are the plant's). Details below.
5. **Settings** — the engine per phase (an engine that did not answer this session is marked absent), the printer the print set goes to (from the print service), and the bound artifacts (CAD Studio parts
   and a Circuit Lab design can be bound here).

**The spider is the first product** (ADR-203 D5): the design partner's `design-create-project {example:
"spider-18"}`, or `POST /api/design-studio/projects {"example":"spider-18"}`, creates it with every phase
bound **by name** to what ADR-202 built — embodied's `spider-18` fit, Circuit Lab's `hexapod-power`
example, the hexapod node, the certified gait `hexapod-walk-ppo-shape-seed1` and its certificate, the
print set `scripts/hexapod-prints.mjs` writes. Not one of the design's numbers is in this package: on a
swarm with embodied the posters read parts-complete, sized, specified, on-the-rail and certified from the
engine's own replies; **Open in Circuit Lab** makes your copy of the power example, solves it on the
circuit engine and binds it, after which Electrical reads *holds*; on a swarm without embodied those
posters say the engine is absent.

## The print set (ADR-203 D7)

**Make the print set** on the Fabricate poster makes the set for whatever the Design phase is bound to:

- *embodied's parts model* (the spider): every printed part of `GET /api/embodied/build/<machine>?fit=`
  with a CAD program becomes the person's own CAD Studio part, created once through
  `POST /api/cad-studio/models` with the program's base and features and a source tag
  `{designStudio: {project, part, programSha}}`; a second run finds each part by that tag and rebuilds
  nothing whose program did not change.
- *CAD Studio parts* (the hanger): the models bound to the Design phase are read as built; nothing is
  rebuilt.

For each part the page reads the STL and the kernel's report (`valid`, `massG`, `volumeMm3`,
`extentsMm`, `densityGcm3`) from CAD Studio and posts them to this package, which parses the STL back,
checks it watertight (every edge on exactly two triangles, no degenerate triangle) and keeps it as
`<part id>.stl`. A part without a program, not built in CAD Studio, refused by the engine, reported as
not a valid solid, or exported with an open mesh is recorded **unprintable with the reason** and listed
in the sheet, the BOM and the manifest, never skipped. When every part has a file or a reason the set
is finished: `PRINT-SHEET.md` (file, count, material, orientation, layer height, supports, extents, the
kernel's mass at the report's density beside the design's estimate, notes; each column from the part's
own field, "not stated" where the design says nothing), `bom.csv` (printed, unprintable and bought
rows), `manifest.json` (every part with its source, report and sha256; the unprintable list; the sheet
and BOM digests). The poster then reads *fabricated* (or *unprintable* naming the parts, or *printable*
when the set was made at an older design revision), the files are linked on it, and **Close the phase**
records the manifest's sha256 as the revision.

The routes, all under `/api/design-studio/projects/{id}` and owner scoped: `GET /print-set` (the
listing: the finished manifest and its sha256, or the set in progress), `POST /print-set` (begin, from
the design's rows), `PUT /print-set/parts/{partId}` (multipart `stl` + `meta`, or JSON `{reason}`),
`POST /print-set/finish`, `POST /print-set/sent` (a printer hand-off as the print service answered it),
`GET /print-set/{file}` (one file by a name the manifest lists; an STL downloads as `<product>-<part>.stl`;
the state file is never served and a request never names a path on disk).

**Why the page, not a route, does the engine work.** On the native kernel a package route reaches
neither a sibling package nor another package's engine (`engine.exchange` relays only to the engine
pinned for the calling package; the sandbox has no network - circuit-lab B17), so the parts go through
CAD Studio from the browser with the person's own session and this package's routes only check, write
and serve. The set lives under this package's **lasting directory** (`lastingStorage: true`,
`OSHAL_PACKAGE_DATA_DIR/print-sets/<sha(sub)>/<project>/`; elsewhere `DESIGN_STUDIO_DATA_DIR` or the
shared workspace root), one set per product; one STL is at most 8 MiB and a set at most 64 printed
parts (the kernel's body bounds). See [BACKLOG.md](BACKLOG.md) B5, B6, B7.

**Send to printer** sends one file of the finished set to the printer chosen in Settings through the
print service's posted-model route (`POST /api/scan-to-print/service/print`, the path the
`print-to-3d-printer` tool takes for a scan job), after the person confirms the build plate is clear,
as that tool asks; a print starts only when the printer's owner turned its auto-start on, otherwise the
file waits on the printer. The service's reply (uploaded, started, its message) is recorded beside the
set and read on the poster. Without a print service or a chosen printer there is no button and the
poster says so.

## The plant from the design (ADR-203 D9)

A product designed in CAD Studio gets its physics plant from its own design, so the Simulate phase can
train and gate a brain for any machine. Three things make it:

- **The mechanism** (`PUT /api/design-studio/projects/{id}/mechanism`, the tool `design-set-mechanism`, the
  Mechanism screen): `parts` (the Design phase's bound CAD Studio parts by id), `base` (the part that is
  ground), `joints` (`{id, parent, child, type: hinge | slide | fixed, axis, rangeRad | rangeM, originMm,
  drivenBy: <motor row id> | null, gearRatio}`), `motors` (`{rowId, source: embodied | circuit-lab}`, references
  only: the numbers are read when the plant is built), `payload` (`{massKg, attachedTo}`) and `task`. The task
  is read from the brief's requirement line when the body states none: "lifts 2 kg to 300 mm in 5 s" (raise,
  hoist; g or kg; mm, cm or m; s or min) becomes a displacement of the payload, the load and the time. Stored
  as one row per product (migration 002, `revision` counts the saves). Refused by name: `part_not_bound` (a
  joint names a part not among the Design phase's bound parts), `unknown_motor` (a row the mechanism does not
  declare), `cycle` (a loop, a part hung from two joints, parts hanging from each other), `bad_mechanism`
  naming the field.
- **The plant spec** (`POST /projects/{id}/plant-spec {parts, motors}`): the page reads each part's kernel
  report from CAD Studio (mass, extents) and the motor rows from embodied's catalog
  (`GET /api/embodied/build/catalog`: stall torque, no-load speed, the continuous rating the joint sizing
  uses) or Circuit Lab's drivers (listed, but a row without a continuous rating cannot drive a joint and says
  why), and this package composes the spec every number of which is one of those reads or the mechanism's
  own statements (the gear ratio, the ranges, the origins). `part_not_read` and `motor_not_read` when a read
  is missing.
- **The plant in embodied's engine** (`POST /api/embodied/physics/plant/load`): each part a MuJoCo body at
  its joint's frame carrying the kernel's mass (a box of the extents; an STL as a mesh when the spec carries
  one), the joints as declared, position servos limited to stall × ratio with the row's torque-speed line as
  damping, the payload as a mass on its part, sensors on every joint, an IMU on the base and a position sensor
  on the payload. **Build the plant** on the Simulate poster does it with the person's session; **Run the
  baselines** scores a PD controller on the inverse-kinematics targets for the task (exact for one joint, with
  the model's own gravity sag added so a held load sits on the target); **Train the policy** starts a PPO run
  of residuals on those targets in the engine (a job the poster follows on Reload; the reward is the tracking
  error plus the torque excess over each drive's continuous rating, the rows' numbers); **Certify** replays the
  policy through those ratings, the stall and the brief's time and writes the certificate beside the policy,
  bound to its sha256, the engine build and the spec's digest. Stages: concept → built → baseline → training →
  trained → certified, each from the engine's reply; **Close the phase** records the certificate's sha, after
  which the body contract carries the plant's actuators from the row (range in its own unit, continuous and
  stall torque, no-load rpm, the gear ratio), the certified reach policy as the walker (command
  `[payloadTargetM]`, door `plant.step {command}`) and the plant route as the node.

**The lift is the first machine through it** (`design-create-project {example: "lift-1"}`): three part
programs (a base plate, a column, a carriage; boxes with holes), a mechanism (the column fixed on the base,
the carriage sliding up the column driven by embodied's `sts3215-12v` row through a rack the design states at
40 rad of motor per metre), a 2 kg payload and the brief's line. On a swarm with CAD Studio and embodied:
**Create the parts in CAD Studio** on the Design poster builds the three programs once with your session
(tagged with the product), **Define the mechanism** shows the kernel's masses beside the joints, **Build the
plant** → **Run the baselines** → **Train the policy** → **Certify** → **Close the phase**. The numbers the
engine measured on this box are in `tests/plant.engine.spec.mjs`'s run and the lane handover; the policy's
verdict against the baseline is reported, never asserted. What the generic plant cannot do yet is in
[BACKLOG.md](BACKLOG.md) B8 and embodied's B33.

## The body contract (ADR-203 D6)

`GET /api/design-studio/projects/{id}/body` publishes `design-studio-body/1`, an open description of the machine for any controller trained outside this swarm:
the plant (engine, MJCF route, physics timestep, tick), every actuator (the plant's joint and range, the
design row's continuous and stall torque and no-load rpm), every sense present or absent, the walker (the
certified policy's sha256, the certificate, the command vector `[vx, vy, vyaw]`, the `hexapod.step
{command}` door) and the node (kind, endpoint). **Every value is read from the bound artifacts' engine
reply excerpts**, recorded when a phase is closed on the product page or bound through
`design-bind-artifact` with `artifact.read`; a value no read supplies is named in `missing`, never filled
in, and a contract missing a required value answers `409 body_incomplete` naming each one. The rail's node
listing states no tick rate, so `plant.tickS` is null until an engine reply carries one; the sense rates
are missing for the same reason.

## The design partner (the right rail)

The concierge `design-partner` (ADR-203 D3) works the chain side by side through this package's
route-backed tools: `design-list-projects`, `design-get-project`, `design-create-project`,
`design-plan-phases`, `design-bind-artifact`, `design-close-phase` (refused as `missing_evidence` without
BOTH the evidence line and the revision), `design-phase-brief`. The open product registers with the shared
document handoff (`/shared/ui/js/document-handoff.js`), so a change the partner makes is drawn on the page;
the page publishes a context digest to the assistant rail and takes `design_action` custom ops (open a
product, reload, new product).

What it can and cannot call on the native kernel: a route-backed tool calls this package's own routes; the
engine packages' tools (`cad-*`, `circuit-*`, `embodied-*`, `print-service-*`) reach the partner only when the
operator grants them to its agent in the cockpit (core `docs/apps/package-tools.md`, "Bots in an adopted
package"); until then the partner says so and the poster's button does that read through the person's
session. The print set is made by the page's button, never by a tool (BACKLOG B5); the partner reads the
manifest's sha256 from the fabricate binding and closure. Jarvis, which composes every admitted package's tools, is the same partner from Today. Stages are
read browser-side on purpose: on the native kernel a package route cannot read a sibling package
(circuit-lab BACKLOG B17), so the server never computes a stage. See [BACKLOG.md](BACKLOG.md) B1.

## Layout

```
oshal-app.yaml            the package: tools, bot, routes, migration, the tile, surface.ops
personas/design-partner.yaml
migrations/001-design-studio.sql   design_project, design_binding, design_closure (owner RLS)
migrations/002-design-mechanism.sql design_mechanism (one row per product, owner RLS)
src-routes/               TypeScript, compiled to routes/ (CommonJS, @/ aliases left intact)
  phase-model.ts          the vocabulary, the phase briefs, the proposal, the validations
  project-store.ts        the per-person store (text ids, plain inserts, sorting in code)
  examples.ts             the spider-18 and lift-1 examples, bound by name
  mechanism-model.ts      the mechanism as data, the task from the brief, the plant spec from the reads
  mechanism-store.ts      the mechanism row (insert once, whole-row updates as revisions)
  mechanism-routes.ts     GET/PUT /projects/{id}/mechanism, POST /projects/{id}/plant-spec
  body-contract.ts        design-studio-body/1 from the bound reads (a generated plant's actuators from the row)
  print-set-mesh.ts       an STL parsed back and checked watertight
  print-set-model.ts      the set's rows validated by field, the sheet, the BOM, the manifest
  print-set-store.ts      the set on disk under the data root (begin, part, finish, listing, files)
  print-set-routes.ts     the print-set routes under a product
  design-studio-routes.ts the mounted factory
  surface-files.ts, home-summary.ts, package-smoke.ts
tools/                    the page: design-studio.html, .css, -stages.js (the reads and stage rules),
                          -screens.js (the four screens and dialogs), -fabricate.js (the print set through
                          CAD Studio, the printer hand-off), -mechanism.js (the Mechanism screen, the parts
                          through CAD Studio, the plant actions, the Simulate view of a generated plant),
                          .js (routing, actions, the rail)
tests/                    see below
```

## Test

```
node --test "tests/*-*.test.js"                                                        # the process and the print set as data, no framework
OSHAL_CORE_ROOT=<core checkout> node --test tests/routes.core.test.js   # the routes over loopback HTTP
OSHAL_CORE_ROOT=<core checkout> node --test tests/design-studio.spec.mjs # the four screens in Chromium
OSHAL_CORE_ROOT=<core checkout> node --test tests/print-set.engine.spec.mjs # one part through the real CAD engine image
OSHAL_CORE_ROOT=<core checkout> node --test tests/plant.engine.spec.mjs     # the lift end to end on the real CAD kernel and the real embodied engine image
```

- `phase-model.test.js` — the vocabulary; a hanger's four phases and the spider's nine with the lines that
  asked; every validation refusing by field; `missing_evidence` and `missing_step`; the example by name; the
  body contract from bound reads, every value traced to the fixture, and `body_incomplete` naming what is
  missing.
- `routes.core.test.js` — the compiled routes with express from a framework checkout and the in-memory pool:
  the caller gate, the plan, create from a brief and from the example, CRUD, owner scoping, bindings as
  revisions, closures and their refusals, the phase brief, the body contract 409 then 200, Home, deletion.
- `print-set.test.js` — the STL parse and watertight check (a box passes, a dropped triangle is three open
  edges), the set input and part meta refused by field, the file name from a validated id only, and on a
  temporary directory: begin, a kept part with its sha256, an unprintable part with the fault, finish refused
  while a part is unaccounted, the sheet, the BOM and the manifest, the hand-off record, begin again.
- `design-studio.spec.mjs` — the four screens over the real routes and canned engines (`design-studio.fixture.mjs`):
  the walkthrough and Create, the spider's posters, Close the phase and the body contract, absent and failing
  engines, Run the baselines and Certify, Open in Circuit Lab, the build checklist, Make the print set through
  the fixture's CAD Studio (every part once, the files, the closure at the manifest's sha256, a second run
  rebuilding nothing, the set stale when the design moves on), unprintable parts listed with their reasons and
  an open mesh caught, the hanger's one-file set, Send to printer, Settings, 412 × 915, daylight from the
  tokens. Screenshots in `DESIGN_STUDIO_SHOTS` when the folder exists.
- `print-set.engine.spec.mjs` — one small generic part through `oshal-cad-studio-engine:local` (docker, no
  network) and then the real routes: the engine's bytes kept watertight with their sha256, the kernel's mass,
  volume and extents; skips loudly naming the missing prerequisite when docker or the image is absent.
- `mechanism-model.test.js` — the mechanism refused by name (part_not_bound, unknown_motor, cycle,
  bad_mechanism with the field); the task from the brief's line in its units; the plant spec composed from the
  reads with every number traced (part_not_read, motor_not_read); the lift example against its own binding and
  CAD Studio's compiled contract; the body contract of a generated plant.
- `plant.engine.spec.mjs` — the lift end to end on the real engines: the three programs through the CAD
  kernel image, embodied's real compiled routes dialling a container from the embodied engine image
  (`OSHAL_EMBODIED_ENGINE_IMAGE`, whose build hash must be this tree's), the page in Chromium through Create the
  parts, Define the mechanism, Build the plant, Run the baselines, Train the policy (`PLANT_PROOF_TIMESTEPS`,
  default 20000), Certify, Close the phase and `GET /body`; results in `PLANT_PROOF_OUT`. Skips loudly naming
  the missing prerequisite.

Compile after a change to `src-routes/` with the store's usual `tsc -p src-routes/tsconfig.json` against a core checkout
(its `node_modules` supplies types only), then delete the `.js.map` files.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| design-partner-chat | design partner chat turn | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
