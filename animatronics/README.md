# Animatronics

0.2.3 adds the company audience view beside the family one (ADR-164 D6): Studio, Orbit and Commons (the Business shells) open this package's first surface with `?audience=company`, and the shared kit paints the same account-scoped card in the company grammar; the reads and the model are unchanged. Proven by `tests/audience-view.test.cjs` (Test Lab case `audience-view`) and the store's `scripts/audience-views.browser.cjs` over `tests/audience-view.fixture.cjs`, which expects the same card under both audiences.

The **motion layer** for a Halloween prop or any servo animatronic. A prop is a **rig** — hobby
or bus servos with per-channel calibration (centre pulse, microseconds per degree, reversal,
hard pulse clamps) and **software limits** in mechanism degrees, grouped into **mechanisms**: an
eye gimbal, eyelids, a neck, a jaw, an arm. On top of the rig live a **pose library** (`NEUTRAL`,
`LOOK_LEFT`, `EYES_CLOSED`, `JAW_OPEN`) and **scenarios** — timed scripts of scenes in the
Glicksman shape: move to a pose over a duration with an easing, hold, run another scenario,
repeat, or run children together. The upper layer asks for `BLINK` or `LOOK_AT`; the engine
turns that into pulses.

The server **compiles** a scenario to a 50 Hz frame stream through the calibration, **rehearses**
it on servos that move no faster than their rated speed (a move the servo cannot follow shows up
as lag before any pulse exists), **budgets the actuator supply** (idle, peak-moving per frame,
all-stalled; a USB port is refused), and only then hands the page the exact **controller protocol
lines** to stream — over **Web Serial** — to an ESP32 or Arduino driving a PCA9685. The PC thinks,
the microcontroller drives: the ServoEye / Phil / PiBob split, with the pulses owned by the server.

No engine container: the engine is deterministic TypeScript inside the package.

## Use it

Open `/cockpit/?app=animatronics`.

1. **New rig** from a template — *Two-axis eyes* (the Adafruit gimbal), *Six-servo face* (eyes,
   lids, neck — the Phil / Zappo-II shape), *Talking skull* (adds a jaw on 55 g servos) — each with
   its poses and scenarios. Adjust the calibration table once the mechanism is on the bench: pick
   the servo from the catalog and its numbers fill in; set the software limits to what the
   linkage actually allows. **Save calibration** re-validates everything and disarms the rig.
2. **Jog** the sliders: in design mode they move the drawing; once armed they move the prop.
   **Capture as pose** saves the slider angles under an `UPPER_CASE` name.
3. **Scenarios**: pick one, edit its JSON (`move`, `hold`, `together`, `run`, `repeat`), save,
   **Rehearse**. The drawing replays what the *rate-limited* servos would do; the report says per
   channel what the move asked versus what the servo is rated for, the lag, whether it settled,
   and the supply verdict. A cubic in-out ease peaks at three times the average speed — command a
   fast blink `linear`.
4. **Look at**: click a bearing on the pad; the eyes take their share first and fast, the neck
   follows slower, and what neither can reach is the residual. Rehearsed until armed.
5. **Connect** the controller (Chromium desktop, Web Serial), **Arm** (the browser asks, the server
   asks for `confirm: true`, then hello + every channel's clamps + the neutral frame go to the
   controller), then **▶ Play**, look-at and jog stream the server's lines while the drawing follows.
   **E-STOP** turns outputs off on the controller first and disarms on the server after. A rig
   change, a lost link or a closed page disarm too.
6. **Or talk** — "make it glance left and blink", "why does the jaw lag", "add a SURPRISED scenario".
   The director in the chat rail edits the same libraries through route-backed tools and rehearses
   every change. It cannot arm or play; a person does that with the controller connected.

## The authority rail

`draft → rehearse → arm (confirm) → play / look-at / jog → disarm (e-stop)`

- **Rehearse** never needs arming and never moves anything; it is logged.
- **Arm** needs `confirm: true` (428 without) and a supply the budget accepts (422 otherwise).
- **Play / look-at / jog** answer 409 until armed; each re-rehearses from the believed pose and is
  refused (422) if the supply budget says refuse for that motion.
- **Disarm** is always allowed and is the e-stop. Every command is a row in the command log.

## The contract (the same words the bot reads)

`GET /api/animatronics/capabilities` publishes the channel fields, the mechanism kinds with their
roles (`eye-gimbal` pan/tilt, `eyelids` upper/lower/left/right, `neck` yaw/pitch/roll, `jaw` open,
`arm` and `custom` any), the step kinds and easings, the caps, the protocol, the templates and the
`prop` kind vocabulary. Axis keys are `<mechanism>.<role>`; angles are mechanism degrees inside
each channel's limits; pan/yaw positive is the prop's right, tilt/pitch positive is up, lids 0 is
open, jaw 0 is closed. `catalog/servos.json` holds servos and controller boards with a `source`
line per row. **This package OWNS those servo rows** — a servo bought once is described once — and
Circuit Lab reads the SG90 row out of this file rather than describing the same part again
(`circuit-lab/tests/shared-parts.test.js` fails if the row's identity, mass, price, pulse range,
travel, speed, torque or currents move without it following). Changing a number here changes the
answer there; deleting a row withholds it there, naming this package.
The full contract and the models are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md);
the wire protocol and the firmware posture are in [docs/CONTROLLER-PROTOCOL.md](docs/CONTROLLER-PROTOCOL.md).

## The `prop` kind

`prop` is a first-class peripheral kind in **embodied**'s vocabulary (ADR-156 D6, folded in at
animatronics 0.2.0 / embodied 0.15.0): kind, safety class floor, closed senses and acts, and the
confirm-exempt set are decided there, and `GET /capabilities` names `embodied` as the owner. Since
0.2.1 this package READS that row out of embodied's compiled `capability-manifest.js` beside it
rather than keeping a copy — there is exactly one place the vocabulary is written down. Store
packages install one at a time, so the read is guarded: with no embodied on the box there is no
prop vocabulary and no capability manifest (`GET /rigs/:id/manifest` answers 503 naming the owner),
and a rig, its poses, the rehearsal, the supply budget and the Web Serial stream all work anyway.
`tests/engine-kind.test.js` points the package at a fixture packages root whose embodied declares a
different row and requires the answer to change with it, pins every unhappy shape as a refusal with
nothing invented in its place, and proves embodied's own `validateManifest` ACCEPTS a rig built from
the servo catalog. What is still deliberately out: a prop does not enrol as a node on the swarm
rail — that stays gated on the ADR-149 decision, and the same test pins the refusal.

That read is a declared dependency, not a hidden one: the manifest names `embodied` under
`dependencies.optional.apps`. Optional is an install-time OFFER that never blocks — installing
Animatronics offers embodied alongside it, and declining still installs a package where every rig,
pose, scenario, rehearsal, supply budget, arming and Web Serial stream works, with only the
capability manifest withheld. `marketplace.json` mirrors that block; it is generated from the
manifest by `scripts/gen-catalog-dependencies.mjs`, so change the manifest and regenerate.

## The family view (Home shell)

The Jarvis Home shell frames this page with `?audience=family` (ADR-164 D6). The page then paints
the caller's saved props through the shared audience-view kit instead of the editor: how many
props, shows (scenarios) and poses are saved and how many props are armed, a title led by an armed
prop, a tile per prop (its template, servos, poses and shows, when it last changed), the shows in
plain words with their descriptions, and each prop's last practice run — the rehearsal report the
routes saved with it, passed with its length or not passed with its first reason. One action and
the kit's escape open Animatronics in the cockpit.

On open the view makes exactly one read, `GET /api/animatronics/rigs`, an owner-scoped SELECT the
full page already makes. It never reads the capabilities, the catalog, a rig's detail, runs or
manifest, never rehearses (a rehearsal writes a command-log row), never arms, plays, looks, jogs or
disarms, and never opens a Web Serial link. Signed out, refused, no props, a failed read, an
unreadable answer and an unreachable server each read as what they are. The editor's start (the
contract and catalog reads, the rig poll, the controller link and the disarm beacon) runs only when
no view renders; without the parameter the page runs exactly as before.

## Tests

```bash
node --test "tests/*-*.test.js"                                   # engine, protocol, seam, surface link — 35 cases, dependency-free
node --test tests/audience-view.test.cjs                          # the family view: kit contract, behaviour over the real rig route, the gate — dependency-free
OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js    # the routes over loopback HTTP (needs a framework checkout)
OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/surface.core.spec.mjs   # the actual page in headless Chromium with a fake serial port
OSHAL_FRAMEWORK=C:/Projects/oshal node scripts/audience-views.browser.cjs animatronics   # from the store root: the family view and the untouched full page in headless Chromium
```

Registered in `tests/test-lab.yaml`. The firmware sketch has no registered case: nothing here
compiles or runs it (BACKLOG B2).

## What is not modelled

Load, inertia and stall on the servo (the rehearsal is rate-limited tracking, not dynamics);
linkage geometry and collisions between mechanisms; sound and lip-sync; a bus servo's position
readback. Each is a BACKLOG entry with done-when criteria, not a hidden assumption.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **32 / 128 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| motion-director-chat | director chat turn | T4 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->
