# Circuit Lab

A local circuit **and mechanism** lab the swarm can **drive**. A circuit is parts and wires on a
schematic canvas; a real SPICE solver (ngspice) runs the transient every time it changes. DC
motors and gear trains are part of the **same solve**: a motor's shaft is a rotational node, gears
reflect their loads onto it, and the gears turn on the canvas at their solved speed. Every run keeps
its waveforms, its deck and a report of readings per part — currents, powers, LED brightness,
battery runtime, motor rpm / torque / efficiency / stall, every shaft's rpm — and its warnings
(an unconnected pin, a resistor over its rating, an LED above its maximum, a stalled motor, a gear
nothing drives).

The solver runs in the package's **own container** (`engine/`, the cad-studio / aero-lab shape);
the api verifies the container's engine build hash before the first request, so a stale container
answers with the install command instead of a wrong number.

## Use it

Open `/cockpit/?app=circuit-lab`.

1. **Start** — *New circuit*, or pick an example: a switched LED, an RC charge, a motor with a
   3:1 gearbox, a PWM motor drive.
2. **Build** — drag a part from the palette onto the canvas (or click it), drag it into place,
   click one pin then another to wire them (electrical to electrical; shaft to shaft couples two parts; teeth to
   teeth meshes two gears). Select a part to edit its properties in the right rail — a motor,
   servo or stepper can take its nameplate from the catalog; `R` rotates,
   `Delete` removes, `Ctrl+Z` / `Ctrl+Y` undo and redo, `Ctrl+C` / `Ctrl+V` copy and paste, the
   wheel zooms and shift-drag pans. Drag on empty canvas to select several parts and move,
   delete or turn them together (`R` turns the group about its centre); drag a wire's middle
   segment to re-route it, or double-click a wire to give it a bend, drag the bend, double-click it
   away — as many bends as the wire needs; click a wire to plot its
   net. Every edit is saved and, with *run after every edit* ticked,
   solved. Every run is kept; *restore* on any run puts its circuit back.
   *Breadboard* shows the same circuit on a full-size breadboard, laid out for you: drag parts to
   other holes, click a part and press `R` to stand it upright, click hole to hole for a jumper,
   Delete a jumper — the schematic's wires follow, and both always imply the same nets (gears and
   loads stay on the schematic). The board is drawn to scale: a jumper is a straight wire at its
   real length (click it for the mm; the total is under the board), and a part whose own legs
   share a strip is named as shorted.
3. **Run** — set the window (stop, step, start from rest) and press *Run*. The *solver* row
   takes ngspice's reltol, gmin and integration method (trap or gear) for a circuit that needs
   them; left empty, the lab's defaults run with one automatic relaxed retry. The timeline plays the
   run: gears and rotors turn, LEDs glow with their current, a switch flips at its time. Tick
   signals to plot them; the cursor follows the timeline.
4. **Read** — the readings table is the solver's numbers per part, the warnings say what is wrong,
   *values on canvas* writes every net's voltage and every part's current on the schematic at the
   timeline's time, and the downloads give the waveforms (JSON), the deck (`.cir`) and the report.
   A selected gear has *Open in CAD Studio*: its involute outline becomes a printable part.
5. **Or talk** — "add a 470 ohm resistor in series with the LED", "why is the motor stalling",
   "what gear ratio gets the load to 500 rpm". The engineer in the chat rail calls the same
   route-backed tools; the canvas refreshes as it works.

## The contract (the same words the bot reads)

Thirty-one part types — ground, junction, battery, signal source, resistor, potentiometer,
capacitor, inductor, diode, zener, LED, lamp, switch, NPN, N-MOSFET, op-amp, voltage regulator,
relay, 555 timer, H-bridge driver, sequenced pin, step/dir driver, an Arduino Uno with its sketch,
DC motor, hobby servo, stepper motor, gear, load, torsion spring, pulley (with belts),
crank-slider — with their pins, units, defaults and ranges published by
`GET /api/circuit-lab/capabilities` and asserted equal between the Node routes and the Python
worker by spec. Motors are identified from nameplate numbers (nominal volts, stall amps, no-load
rpm and amps); a servo decodes its pulse width and runs a position loop on a geared motor; a
stepper turns one step per pulse on its driver and reports its load angle and lost steps; a load
can carry a constant torque (a lifted weight); a torsion spring, a belt between two pulleys (it
slips at its grip) and a crank-slider make the mechanics non-rigid in the same solve; an Arduino
Uno's sketch is compiled and run in avr8js and its output pins drive the circuit. `catalog/drivers.json` holds ready nameplates with
a source line per number. The full contract, the models and the gear-train reflection are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The engine container

The oshal api image is Alpine; the solver runs in a Debian container built locally from the
official Python image plus Debian's `ngspice`, `gcc-avr`, `avr-libc`, `arduino-core-avr` and
`nodejs` packages and the pinned `avr8js` tarball (about 250 MB downloaded on the first build).
When the page says the engine is not answering, run the command it prints — from the host of any
box running the stack:

```sh
docker exec <api-container> sh /app/workspace-shared/deployed-apps/circuit-lab/engine/install-engine.sh
```

It builds the image, starts `oshal-circuit-lab-engine` on the stack network under its own compose
project, and self-tests it: ngspice solves an LED circuit and a motor with a 3:1 gear train to
known numbers. Re-run it whenever the page reports the engine is out of date.

## Tests

| suite | what it proves | runs |
|---|---|---|
| `tests/contract-parts.test.js` | the contract (defaults, ranges, wiring rules, caps, a wire's bend points, the solver knobs), Node ≡ Python library, Node ≡ Python build hash | plain node + python — store-ci |
| `tests/canvas-geometry.test.js` | the schematic geometry: a wire's corners and path, a bend placed without moving the wire, the bend cap, removing bends, a group turned rigidly about its centre, a turn off the canvas refused | plain node — store-ci |
| `tests/engine-client.test.js` | the transport against a fake bridge on loopback (hello, serialisation, refusals, timeouts, busy, drop) | plain node — store-ci |
| `tests/routes.core.test.js` | the routes over loopback HTTP with the real engine client and a fake bridge (gate, create, edits as runs, 422 with the field, owner scoping, artifacts, Home, delete, 503 with the install command) | `OSHAL_CORE_DIR=<core checkout> node --test tests/routes.core.test.js` |
| `engine/tests/test_circuit_worker.py` | the worker on the real ngspice: LED, RC, a switch mid-run, a geared motor, a stalled motor, PWM through a MOSFET, the eight 0.2.0 parts, a servo to its angle at its rated speed, a stepper one step per pulse holding a weight at the textbook load angle and slipping above pull-out, a motor lifting a weight, the mechanism solver's refusals, the protocol; the solver knobs written into the deck and never retried over, a hard-switched inductor refused at the defaults and solved with gear | `python -m unittest discover -s tests` inside the engine image |
| `tests/surface-editing.core.spec.mjs` | the actual page in headless Chromium over the compiled routes: an example opens, a part dragged from the palette lands where dropped and is solved, pin-to-pin wiring, delete, undo / redo, values on the canvas, restore, the inspector, a marquee group move, a wire re-route, click-a-wire-to-plot, bends placed / dragged / removed, a group turn and its refusal, a part turned on the breadboard with its short named and a jumper's length in mm, the solver knobs | `OSHAL_CORE_DIR=<core checkout> node --test tests/surface-editing.core.spec.mjs` |
| `tests/gear-profile.test.js` | the involute outline and the body handed to CAD Studio, validated against CAD Studio's own contract | plain node — store-ci |
| `tests/driver-catalog.test.js` | every catalog row validates against the contract; embodied's motors agree on name, mass and price (read-only cross-package) | plain node — store-ci |
| `tests/board-model.test.js` | the breadboard model: footprints (turned ones too), refusals, the automatic layout implies the schematic's nets on every example and the wires rebuilt from a board imply them again, moves / jumpers / reconciliation, shorted parts, jumper spans on the BB830 geometry | plain node — store-ci |
| `tests/surface-bridge.test.js` | the assistant rail: the manifest's surface ops and delegate mode, the page's context op and `circuit_action` vocabulary under the contract's caps, the digest cap on a 200-part circuit | plain node — store-ci |

All ten are registered in `tests/test-lab.yaml` with their real prerequisites. The 0.6.0 verification
state — which suites have run where, and how to finish the real-solver run and the install — is in
[docs/continuing-0.6.0.md](docs/continuing-0.6.0.md).

## The assistant

The lab rides the cockpit's surface-bridge. The page publishes what it is showing — the open
circuit's parts, wires, last readings, warnings and selection, as a capped digest — on every open,
save, run, selection and view change, so the floating assistant answers about the screen the
person is on ("why is the LED dim?" gets the solved current, not a guess). Jarvis edits through
one custom op, `circuit_action` (add / update / remove a part, connect / disconnect, run, restore,
open an example, select, switch view), which lands through the same routes the canvas uses — one
save per action, one solve at the end, and a toast saying what changed. The concierge runs in
delegate mode: a circuit question in the chat is answered by `circuit-lab-engineer` inline through
its tools rather than by a link to the tile.

## Limits, honestly

Lumped circuits and lumped mechanics. A sketch drives the circuit but cannot read it back yet
(`digitalRead` / `analogRead` see the AVR's defaults), no general 2-D linkage layer beyond the
crank-slider, no heat. A brushless motor is
solved as its DC equivalent behind an ESC (the catalog says which of its numbers are typical
rather than measured). A deck the solver refuses at the defaults is retried once with relaxed
tolerances and the report says so; a person who sets the solver's knobs gets exactly those. Each gap is a [BACKLOG](BACKLOG.md) item with done-when criteria; the external
tools on the operator's list each have a dated evaluation under
[docs/evaluations/](docs/evaluations/README.md).
