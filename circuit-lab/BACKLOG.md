# Circuit Lab — backlog

Each entry has done-when criteria. Nothing here is built; the README and ARCHITECTURE describe
only what is.

## B1 — Microcontroller firmware in the loop — BOTH halves DONE (output 0.6.0, input 0.7.0)

**Verification state (2026-09-14, 0.7.0):** the 0.6.0 gap is closed and the input half is built. `python -m unittest discover -s tests` reports **45 OK** inside `circuit-lab-engine` built from this tree with `libngspice0` added (the four 0.6.0 `Firmware` cases among them — their first run on record), and `container/circuit_engine_bridge.py --selftest` is green with `blinkRisingEdges: 3` and all six checks true. **Not installed on any box**: the reference box still runs 0.5.1 and its engine image predates both halves. The step-by-step hand-over is [docs/continuing-0.7.0.md](docs/continuing-0.7.0.md).

An `arduino` part's Uno sketch is compiled by avr-gcc against the Arduino core inside the engine
container and run in avr8js for the transient; every OUTPUT pin it drives is a PWL source in the
same ngspice transient (ARCHITECTURE §5a). The real-solver suite proves a blink sketch's LED
current toggles at the sketch's period, `analogWrite` averages to its duty through an RC, Serial
text is captured, and a sketch that does not compile is refused naming it with the compiler's
words.

The INPUT half, done when: `digitalRead` / `analogRead` in the sketch see the
solver's node voltages — a co-simulation step per firmware tick through ngspice's shared library
(`libngspice`, Debian `libngspice0`: external-source and per-step callbacks) — so a button that
the sketch polls and a potentiometer it reads change what it drives, with a real-solver test for
each. Nano / Mega variants and a Pico (rp2040js) follow the same path.

**Done in 0.7.0** (ARCHITECTURE §5b): `firmware/cosim.py` drives `libngspice.so.0` through ctypes
in its own process — driven pins are `external` sources served from the AVR's own edge timeline,
and at every accepted solver point the node voltages on the pins the sketch reads are latched into
avr8js (port pins through the AVR's 1.5 V / 3.0 V band, ADC channels in volts through the real
conversion timing) before the AVR is advanced one sync step ahead. `sim.syncSeconds` (default
100 µs, bounded 4 µs … 10 ms and to a quarter of the run) is the step. The real-solver suite proves
a button the sketch polls (the LED can only change because `digitalRead` saw the node the switch
pulled down) and a potentiometer it reads (`analogRead` reports the counts the solved wiper voltage
implies, and the PWM it writes averages to that duty), plus four refusals: a pin nothing drives
(open-loop, said so), a sync step out of bounds at either end and past a quarter of the run, a
second board, and an inverting loop the step itself drives (`cosim_chatter`).

Still open: more than one board per run (one slicer holds one AVR), and the Nano / Mega / Pico
variants above. Neither is needed by the criteria this entry set.

## B2 — Breadboard view — DONE in 0.4.0; turned parts and wire lengths DONE in 0.8.0 (on the branch, not installed)

The *Breadboard* view renders every electrical part on a full-size board with its footprint
(DIP-8s across the gap on their pinouts), the nets are derived from strips and rails plus jumpers,
`tests/board-model.test.js` proves board and schematic imply the same net partition (hence the
same deck) on every starter example both ways, and the browser suite proves it on the actual page
through a layout, a move and a jumper.

The criteria this entry left open — "parts can be rotated on the board (vertical footprints) and a
wire's physical length is drawn rather than an arc" — are met in **0.8.0** (ARCHITECTURE §9b). A
placement carries `rot` (90 / 180 / 270, clockwise): a row part's legs step down the rows, back
along the row or up the rows from its anchor, so an upright resistor anchored on row c lands in c
and f across the channel; click a part on the board and press R. A DIP is refused a turn and a bad
turn is refused naming `board.placements.<id>.rot`. The view is drawn to the BB830 geometry (0.1 inch
pitch, rows e and f 0.3 inch apart, each inner rail row two pitches out — BusBoard's SB830 datasheet,
BPS-MAR-(SB830)-001 Rev 4.00) and a jumper is a straight line at its span: the selected one reads
its length in mm, the total and longest sit under the board. A part the board shorts (two of its
own legs on one strip) is named under the board. Proven on the host 2026-09-14:
`tests/board-model.test.js` 9/9 (four new cases), `tests/routes.core.test.js` 11/11 (a turned
placement stored and agreeing with the schematic, a 45° turn refused), and the browser case "on the
breadboard a clicked part turns upright…" in `tests/surface-editing.core.spec.mjs` (15/15). Not
installed on any box.

## B3 — Gears to CAD Studio — DONE in 0.2.0 (the outline; the printed fit stays open)

"Open in CAD Studio" on a selected gear (and the `circuit-gear-to-cad` tool) posts an involute
outline (teeth, module, pressure angle) as a `sketch` base extruded by the face width with a bore
hole; the cross-package suite validates the body against CAD Studio's contract.

Still open, done when: a meshed pair from one design, printed, fits on the drawn centre distance
(needs a print and a measurement — evidence, not code).

## B4 — One parts model with the embodied lab (ADR-152 D1) — this lab's half DONE in 0.3.0; the servo half READS in 0.8.2

`catalog/drivers.json` is the shared declaration: motors, servos and steppers with a nameplate
that validates against the part contract, the mass and price other packages share, a `source`
line per row, and `usedBy`. The two motors embodied's fits name are rows here, and
`tests/driver-catalog.test.js` reads embodied's compiled parts model (read-only) and fails when
the name, mass or price of either drifts between the two packages. The surface and the
`circuit-driver-catalog` tool fill a part's nameplate from a row.

0.8.2 took the next step for the part this lab does NOT own. A servo bought once should be
describable once, and the SG90 was written down twice: animatronics publishes it (identity, mass,
price, source, and the pulse / travel / speed / torque / current block) and this catalog restated
it under its own name at its own price — already drifted, $3 against $2. That row now carries
`sharedPart: {owner, file, list, id}`, declares only the block this lab adds (the operating point
the solver runs it at, the reflected rotor inertia) and READS the rest out of the owner's catalog
file as data, not as an imported runtime. Fail-closed: an absent or unanswerable owner withholds
that one row naming the owner (`GET /catalog/drivers` answers `{drivers, unresolved}`) and
everything this package owns outright still loads. `tests/shared-parts.test.js` proves it against
real package trees, including a fixture owner whose different numbers move the answer.

Still open (embodied's half — its package, its session), done when: embodied's parts model
imports these rows by id instead of restating name, mass and price, and its MJCF generator reads
what it needs for the actuator from the same row (the KV, once aero-lab's propeller curves give
thrust per rpm — embodied B13).

Also still open here: the rest of animatronics' servo rows (MG90S, MG996R, DS3218, STS3215) are
not offered by this lab at all, and a stepper or motor `sharedPart` has no reader yet — a row of a
type with no reader is refused at load rather than half-resolved.

## B5 — Non-rigid mechanics — DONE in 0.5.0, inside the single solve

A torsion spring, pulleys joined by a belt that slips at its grip, and a crank-slider are
elements of the same implicit transient (ARCHITECTURE §5 "Clusters and the compliant links"):
each side of a spring or belt is its own rotational node, the crank makes its node's inertia
position-dependent through the exact crank kinematics. The real-solver suite checks a spring and
a load ringing at `sqrt(k/J)/2π`, a belt at the radius ratio then slipping at the grip, and the
slider following `x(θ)` within 0.05 mm with a stroke of `2r`; the canvas animates the crank, rod
and slider from the solved angle and position. The reflected-inertia path stays the default for
rigid trains — no co-simulation layer was needed for these, so none was built.

Still open, done when: a general 2-D linkage layer (arbitrary pin joints, contacts, a wheel on
the ground, backlash) co-simulates with the electrical solve at a fixed step, with a four-bar
linkage on the canvas animating against Freudenstein's equation.

## B6 — More parts — DONE in 0.3.0 (servo, stepper, step/dir driver; the 0.2.0 eight before)

Still open, done when: an ESC-driven brushless motor (three-phase, KV-rated, the drone's) is a
contract part whose DC equivalent matches the catalog rows within the ESC's commutation loss, with
a real-solver test to a published thrust-stand current at a stated rpm.

## B7 — Convergence help — DONE in 0.2.0 (the retry); the knobs DONE in 0.8.0; the real-solver case written, NOT yet run

The worker retries a refused deck once with relaxed tolerances (reltol 0.01, gmin 1e-9, gear) and
reports it as a `relaxed_tolerances` warning; a test proves the retry is taken once and the
stored deck keeps the defaults.

**0.8.0 (on the branch, not installed) — the knobs.** `sim.reltol` (1e-6 … 0.05), `sim.gmin`
(1e-15 … 1e-6 S) and `sim.method` (trap | gear) are bounded in both contracts with the field named,
published with the defaults by `/capabilities`, written into the deck's `.option` line by
`circuit_parts.spice_options`, and carried by the surface's *solver* row and the `circuit-run`
tool (ARCHITECTURE §6). A deck without knobs keeps the 0.7.0 option line exactly; a refusal under
knobs the person set comes back naming them — the automatic relaxed retry runs only at the
defaults. Proven on the host 2026-09-14 without a solver: the knobs case in
`tests/contract-parts.test.js`, the four `SolverKnobs` cases in `engine/tests/test_circuit_worker.py`
(`python -m unittest tests.test_circuit_worker.SolverKnobs`), and the browser case "the solver
knobs are saved with the design…".

Still open, done when: the two `HardSwitching` cases in `engine/tests/test_circuit_worker.py` pass
inside the engine image — a 0.1 H inductor in series with 10 Ω whose switch opens at 1 ms with no
flyback path, refused at the default tolerances (set explicitly, so the retry stays out of the way)
and solved with method gear, reltol 0.01 and gmin 1e-9. They are written and have **not run**: the
engine container was neither built nor started for this change. If that circuit solves at the
defaults it is not the case this entry asks for — replace it with one that fails there and keep the
knob-solved half.

## B8 — Store-side execution of the framework-coupled suite and the real-solver suite

`tests/routes.core.test.js` needs a core checkout; `engine/tests/test_circuit_worker.py` needs the
engine image. Both are excluded from the store-CI wildcard and registered in the Test Lab with
their real prerequisites.

Done when: both are registered with the store's framework-coupled runner (or an equivalent gate)
and a red case fails a PR.

## B9 — Editing — DONE in 0.3.0; several bends per wire and group rotation DONE in 0.8.0 (on the branch, not installed)

Marquee multi-select with group move and group delete, wires re-routed by dragging their middle
segment (saved as `route.mid`), and a click on a wire that adds its net's voltage (a shaft link's
rpm) to the plots — each with a browser case in `tests/surface-editing.core.spec.mjs`.

The criteria this entry left open are met in **0.8.0** (ARCHITECTURE §3, §9). A wire's route may
be `{points}` — 1 to 16 bend points, validated in both contracts with the field named; a
double-click on a wire places a bend without moving the wire, a bend drags on the grid, a
double-click on a bend removes it and the last one gone restores the automatic path. R on a
multi-selection turns the group a quarter clockwise about its grid-snapped centre — positions,
rotations and the routes of wires inside the group — and a turn that would push a part off the
canvas is refused with nothing moved. The geometry is `tools/circuit-lab-geometry.js`, one copy for
the page and the plain-node suite. Proven on the host 2026-09-14: `tests/canvas-geometry.test.js`
6/6, the route cases in `tests/contract-parts.test.js` and the engine's `Contract` class, a points
route stored and sent to the engine in `tests/routes.core.test.js`, and two browser cases in
`tests/surface-editing.core.spec.mjs`. The canvas also stopped taking Delete and R while the
Breadboard view shows (a hidden schematic selection could be deleted or turned from the board);
the breadboard browser case guards it. Not installed on any box.

## B10 — The assistant reads and edits the open circuit — DONE in 0.6.0

The page publishes what it shows through the cockpit's surface-bridge (`context`), Jarvis edits
through one `custom` op (`circuit_action`, ten actions through the canvas's own routes, one solve
at the end), and the concierge runs in delegate mode so a chat question gets a number. Guarded by
`tests/surface-bridge.test.js` (the manifest block, the vocabulary under the 600-character cap,
the digest under 4,000 on a 200-part circuit). ARCHITECTURE §11.

## B12 — Onshape import / export connector

From [docs/evaluations/2026-09-13-onshape.md](docs/evaluations/2026-09-13-onshape.md). Done when:
a document the person names opens as a STEP base in CAD Studio through their own credential, a
CAD Studio revision pushes back as a new Onshape version, both only on their click, the plan /
rate-limit facts are recorded from the API Limits page, and the connector is registered under the
business email per `docs/partner-app-registration.md`.

## B13 — Bought parts in the catalog with a STEP attached

From [docs/evaluations/2026-09-13-mcmaster-carr.md](docs/evaluations/2026-09-13-mcmaster-carr.md).
Done when: a catalog row of kind `bought` carries dimensions, mass and price with its source URL,
CAD Studio attaches a person-downloaded STEP to that row, and a design's bill of materials lists
printed and bought rows together. Automated retrieval through McMaster-Carr's customer API stays a
recorded no until the operator holds an approved account.

## B14 — An equation lab

From [docs/evaluations/2026-09-13-ees.md](docs/evaluations/2026-09-13-ees.md). Done when: a package
solves a named equation set with CoolProp properties behind route-backed tools, a textbook case
(a Rankine-cycle or a heat-exchanger sizing) solves to the published numbers in a real-solver
test, and the concierge can pose and read one.

## B15 — A rocket lane (OpenRocket + NASA CEA)

From [docs/evaluations/2026-09-13-openrocket.md](docs/evaluations/2026-09-13-openrocket.md) and
[2026-09-13-nasa-cea.md](docs/evaluations/2026-09-13-nasa-cea.md). Done when: a package-owned
container runs a named `.ork` design headless through orhelper and answers apogee within 2 % of
OpenRocket's own GUI result for the same file; the NASA usage agreement for LEW-17687-1 is read
and quoted in the package, RocketCEA builds in a container from `python:3.11-slim-bookworm` with
the image size recorded, and a published motor's Isp is reproduced within 1 % in a real-solver
test; the design is a contract a person and the concierge edit, and the flight animates on a canvas.

## B16 — Server-side field rendering (ParaView)

From [docs/evaluations/2026-09-13-paraview.md](docs/evaluations/2026-09-13-paraview.md). Held
until a lab produces a field result. Done when: a container renders one through pvbatch to PNG
and glTF served under the owning package's route, and the image size and time per frame are
recorded from that run.

## References evaluated (operator list, 2026-09-13)

Every tool on the operator's list has a dated note under
[docs/evaluations/](docs/evaluations/README.md) with the question answered, a cost / benefit
table, the evidence read and a verdict — a BACKLOG item above (B12–B16, plus the OpenFOAM and
GMAT items that belong to aero-lab and sat-ops) or a recorded no (WebPlotDigitizer as a container,
SimScale, EES).
