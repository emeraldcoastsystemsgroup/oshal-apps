# Circuit Lab — architecture and the contract

This document is the contract. It states what a design is, exactly what the solver computes, in
which units, with which limits, and how the swarm drives it. Everything here is implemented in
`engine/circuit_parts.py`, `engine/circuit_worker.py` and `src-routes/` and asserted by the
suites in `tests/` and `engine/tests/`; nothing is planned or aspirational. If a sentence here
and the code disagree, the code is wrong.

## 1. One design, three editors

```
            person (canvas)  ──┐
   concierge (route-backed tools) ─┼──► /api/circuit-lab/designs/:id/parts | wires | run ──► validate (contract)
   MCP client (oshal-tools bridge) ─┘                                                          │
                                                                                               ▼
        run N ◄── artifacts (waveforms.json, netlist.cir, report.json) ◄── engine container (ngspice) ◄── parts + wires + sim
```

- A **design** is `{ parts[], wires[], sim }`. Parts are typed, placed and propertied; wires
  join two pins of one kind; `sim` is the transient window. There is no other state the solve
  depends on.
- A **run** is one successful solve: the exact circuit, the report, the engine build hash. Every
  run is kept; the waveforms live on disk under the run.
- All three editors go through the same routes. The routes validate against the contract (§3)
  *before* the engine runs, so a bad value is refused with the field named and the solver never
  sees it. A circuit the solver cannot converge is a `refused` build carrying ngspice's own words.

## 2. Units and the canvas

SI in the properties, with the maker's units where they are the ones printed on the part:
volts, ohms, farads, henries, amps; rpm for speed; mN·m for torque; g·cm² for inertia; mAh for
battery capacity. Readings come back in the same units (LED currents also in mA).

Canvas positions `x, y` are pixels on a 960 × 480 viewBox with a 20 px grid; `rotation` turns
the symbol clockwise in steps of 90°. Positions never affect the solve.

## 3. The part library

| type | pins (kind) | properties (unit, default, range) |
|---|---|---|
| `ground` | gnd (e) | — (node 0) |
| `junction` | n (e) | — (a drawing dot) |
| `battery` | + − (e) | volts (V 9, 0.1..1000), internalOhms (Ω 0.5, 0..1e6), capacityMah (mAh 500, 1..1e6) |
| `source` | + − (e) | kind (dc \| pulse \| sine), volts (V 5), offsetVolts (V 0), frequencyHz (Hz 1000), dutyPercent (% 50) |
| `resistor` | a b (e) | ohms (Ω 220, 1e-3..1e9), ratedWatts (W 0.25) |
| `potentiometer` | a w b (e) | ohms (Ω 10 000), position (0..1, 0.5) |
| `capacitor` | a b (e) | farads (F 100 µ, 1e-12..10), ratedVolts (V 25) |
| `inductor` | a b (e) | henries (H 1 m, 1e-9..100) |
| `diode` | a k (e) | — (IS 1e-14, N 1.05) |
| `led` | a k (e) | color (red \| yellow \| green \| blue \| white → Vf ≈ 1.9 / 2.1 / 2.2 / 3.0 / 3.1 V at 10 mA), maxMa (mA 20) |
| `switch` | a b (e) | closed (true), toggleAtSeconds (s, optional) |
| `npn` | c b e (e) | — (BF 150, 2N2222-class) |
| `nmos` | d g s (e) | — (level-1, VTO 2 V, KP 2 A/V² — a logic-level power MOSFET) |
| `motor` | + − (e), shaft (s) | nominalVolts (V 12), stallAmps (A 5), noLoadRpm (rpm 3000), noLoadAmps (A 0.2), inductanceMh (mH 1), rotorInertiaGcm2 (g·cm² 10) |
| `gear` | shaft (s), teeth (t) | teeth (20, 6..400), moduleMm (mm 1), inertiaGcm2 (g·cm² 5) |
| `load` | shaft (s) | inertiaGcm2 (g·cm² 50), frictionMnm (mN·m 0), viscousMnmPerKrpm (mN·m per 1000 rpm, 0.1), torqueMnm (mN·m 0, −1e5..1e5 — a constant torque against the shaft's positive direction: a lifted weight) |
| `servo` | sig v+ gnd (e), shaft (s) | nominalVolts (V 5), stallAmps (A 0.7), runAmps (A 0.2), stallTorqueMnm (mN·m 180), noLoadDegPerS (deg/s 500), travelDeg (° 180), minPulseMs (ms 1), maxPulseMs (ms 2), idleAmps (A 0.01), rotorInertiaGcm2 (g·cm² 500, the geared motor reflected to the output) |
| `stepper` | a+ a− b+ b− (e), shaft (s) | stepsPerRev (200), phaseOhms (Ω 2), phaseMh (mH 3), ratedAmps (A 1.7), holdingTorqueMnm (mN·m 400), detentTorqueMnm (mN·m 20), rotorInertiaGcm2 (g·cm² 54), dampingRatio (0.15) |
| `stepdriver` | vm gnd step dir a+ a− b+ b− (e) | currentAmps (A 1), microsteps (1 \| 2 \| 4 \| 8 \| 16), thresholdVolts (V 1.5) |
| `spring` | a b (s) | stiffnessMnmPerDeg (mN·m/° 5), dampingMnmPerKrpm (mN·m per 1000 rpm, 1) — a torsion spring between two shafts |
| `pulley` | shaft (s), belt (b) | radiusMm (mm 20), inertiaGcm2 (g·cm² 5), gripN (N 10 — the belt force this pulley can hold before it slips) |
| `crank` | shaft (s) | radiusMm (mm 20), rodMm (mm 80), sliderMassG (g 100), dampingNsPerM (N·s/m 0.5), springNPerM (N/m 0), springRestMm (mm 100), frictionN (N 0) — a crank-slider on the shaft |
| `arduino` | 5V GND D2…D13 A0…A5 (e) | sketch (text, ≤ 8000 chars: an Uno sketch) — compiled and run for the transient (§5a), reading the circuit back when a pin it reads is wired (§5b) |
| `zener` | a k (e) | breakdownVolts (V 5.1, 1..200) — a diode with BV |
| `lamp` | a b (e) | ratedVolts (V 12), ratedWatts (W 5) — its rated resistance V²/P; brightness = power / rated |
| `regulator` | in gnd out (e) | outputVolts (V 5), dropoutVolts (V 2), maxAmps (A 1) — out = max(0, min(in − dropout, Vout)); 5 mA quiescent |
| `opamp` | + − out vcc vee (e) | gain (V/V 1e5), railDropVolts (V 1) — rail-limited gain, a 1 kΩ / 100 nF dominant pole, a unity buffer, 50 Ω out |
| `relay` | c+ c− (e), com no nc (e) | coilOhms (Ω 100), coilMh (mH 10), pullInAmps (A 0.03) — NO closes at pull-in, NC opens; both release at 60 % of it |
| `sequencer` | out ref (e) | highVolts (V 5), pattern (text "level:seconds …", ≤ 64 steps), repeat (true) — a PWL source with 1 µs edges, repeated from 0 |
| `hbridge` | vcc gnd in1 in2 out1 out2 (e) | thresholdVolts (V 2.5), onOhms (Ω 0.2) — each output to vcc when its input is above the threshold, to gnd when below (0.2 V dead band) |
| `timer555` | vcc gnd trig thr out dis (e) | — smooth comparators at 1/3 and 2/3 Vcc into a hysteresis latch; out = Vcc − 1.5 high / 0.1 low through 10 Ω; discharge = 10 Ω to gnd when low |

The gear also carries `faceWidthMm` (mm 8), `boreMm` (mm 3) and `pressureAngleDeg` (° 20) for
the CAD hand-off (§8); the solver ignores them. A `text` property is bounded by a length and a
regex both libraries share (the sequence pattern).

Pin kinds: **e** electrical, **s** shaft, **t** teeth, **b** belt. A wire joins two pins of one kind and may
carry a `route` — `{ mid }`, where the canvas draws the middle segment of its three-segment path, or
`{ points: [[x, y], …] }`, the 1 to 16 bend points it is drawn through pin to pin; the solver
ignores both, and anything else (both at once, an empty or over-long list, a point that is not two
finite numbers) is refused naming `route.points[i]`. Ids
match `^[A-Za-z][A-Za-z0-9_]{0,23}$` and are unique case-insensitively (ngspice folds case).
Limits: 200 parts, 400 wires, 16 bend points per wire (`limits.maxRoutePoints`). Unknown properties are refused; every numeric range is enforced
with the field named. The library lives twice — `engine/circuit_parts.py` (`--contract` prints
it) and `src-routes/circuit-contract.ts` (`describeContract()`) — and
`tests/contract-parts.test.js` diffs them.

## 4. Nets

Union-find over the electrical wires; each electrical pin belongs to exactly one net. A
`ground` pin's net is node `0`. With no ground part, the first battery's or source's `−` pin
becomes `0` and the run carries a `no_ground` warning. Nets are numbered `n1, n2, …` in part
order, so the same circuit always produces the same deck. A net with one pin (on a part that is
not a junction or ground) is an `unconnected_pin` warning; `.option rshunt=1e12` keeps such a
deck solvable.

## 5. The deck

Every part becomes real SPICE elements. Two-terminal parts and transistors get a zero-volt
**sense source** in series with their first pin (`V<id>_i`), so every current in the readings is
measured, not derived. Batteries are `V` + series `R`; sources are `DC`, `PULSE(off, off+V, 0,
T/200, T/200, D·T, T)` or `SIN(off, V, f)`; a switch is a 1 mΩ / 1 GΩ resistor, or an `S`
element driven by a `PULSE` when it toggles; the models are pinned in `circuit_worker.py`.

### The motor, and the gear train in the same solve

A brushed DC motor is identified from its nameplate:

```
R  = V_nom / I_stall             Ke = (V_nom − R·I_noload) / ω_noload        Kt = Ke
b  = Kt · I_noload / ω_noload     L = inductanceMh · 1e-3                    J = rotorInertiaGcm2 · 1e-7
```

Electrically it is `R` + `L` + a back-EMF source `E = Ke·ω`. Its shaft is a **rotational node**
`sh<id>` whose voltage is ω (rad/s): torque is current (`F 0 sh V<id>_i Kt` injects `Kt·i`),
inertia is a capacitor `C = J_eq`, viscous friction a resistor `R = 1/b_eq`, and coulomb friction
a behavioural source `B … I = τ_eq · tanh(ω / 0.5)` that always opposes motion. `rpm(<id>)` is
`V(sh<id>) · 60/2π`.

The **mechanism** is solved before the deck is written (`circuit_parts.solve_mechanism`):

- shaft pins joined by `shaft` wires form a **shaft group** (parts on it turn together);
- a `teeth` wire between two gears on different groups is a **mesh** with ratio
  `ω_b / ω_a = − N_a / N_b` (external gears reverse);
- from each motor's group a search assigns every reachable group its signed **ratio** `r` to the
  motor; one motor per train, an inconsistent loop, or two gears meshing on one shaft is a
  refusal naming `wires`;
- the train is **reflected** onto the driver's shaft: `J_eq = J_motor + Σ r² J_g`,
  `b_eq = b_motor + Σ r² b_g`, `τ_eq = Σ |r| τ_g` (coulomb, exact for rigid gears), and a load's
  constant torque `Σ r · τ_w` — signed, because a weight lifted through a reversing mesh pulls
  the other way at the motor (power balance);
- undriven groups get a `not_driven` warning; every driven shaft's `rpm(shaft:<first part>)` is
  a signal (`rpm(driver) · r`), `torque(<driver>)` is in mN·m, and every driver reports
  `angle(<id>)` in degrees from an integrator node (`C = 1` fed by `I = ω`).

A motor, a servo or a stepper drives a train; **one driver per train**. The same reflection
serves all three.

### Clusters and the compliant links (the non-rigid mechanics)

Rigid groups joined by meshes form a **cluster**, and a cluster is one rotational node — `sh<driver>`
when a driver sits on it, `shc<n>` when it is passive — with the reflection above and its own angle
integrator, rpm and angle signals (`rpm(shaft:<reference part>)`, `angle(…)` for a passive one).
Three parts join clusters *compliantly*, each side keeping its own node:

- a **spring** (`a`, `b`, both shaft pins) is a twist integrator `∫(r_a ω_A − r_b ω_B) dt` and a
  torque `k·twist + c·(r_a ω_A − r_b ω_B)` (k from mN·m/°, c from mN·m per 1000 rpm) taken out of
  side A and put into side B through each pin's group ratio; signals `twist(<id>)` (°) and
  `torque(<id>)` (mN·m). A spring whose two ends are already rigidly linked is refused.
- a **belt** is a `belt` wire between two pulleys' belt pins: the rim speeds `v = r·ω` of the two
  sides meet in a saturating viscous coupling `F = grip·tanh(20·(v_a − v_b))` (N; the smaller of
  the two pulleys' `gripN`), so the belt creeps a little under load and slips outright at the
  grip; torque `F·r` leaves side A and enters side B; signals `slip(<wire>)` (m/s) and
  `force(<wire>)` (N); a pulley's readings give the belt force, the slip as a fraction of the
  faster rim and `slipping` (more than 10 % slip or a force at 90 % of the grip).
- a **crank-slider** on a shaft makes its cluster's inertia position-dependent. With
  `x(θ) = r cos θ + sqrt(l² − r² sin² θ)` the exact slider position, the node's equation is
  `(J_eq + m x'²) ω̇ = Σ torques − m x' x'' ω² − c x'² ω − k (x − x₀) x' − μ tanh(x' ω / 0.01) x'`:
  every torque on the cluster (the driver's, friction, loads, springs, belts) is summed on a
  torque node `tq<n>`, and a unit capacitor on the shaft node integrates the right-hand side
  divided by the position-dependent inertia. `x(<crank>)` (mm) is a signal; readings give the
  slider's final, minimum and maximum position and the stroke `2r`. One crank per cluster.

None of this needs a co-simulation loop: springs, belts and the crank-slider are elements of the
same implicit transient. A general 2-D linkage layer (arbitrary joints, contacts) is not here.

### 5a. Firmware in the loop — the Arduino Uno

An `arduino` part carries a sketch. When the deck is built, the worker compiles it for the
ATmega328P with Debian's `avr-gcc` against the Arduino AVR core (compiled once into `core.a` at
image build: one `avr-g++` call and one link per sketch, about a second) and runs the HEX in
**avr8js** (MIT, vendored from the pinned npm tarball with its sha512 checked at image build)
under node for the transient's length — at most 10 s of simulated time; a longer run carries a
`firmware_truncated` warning and the pins hold their last state. Timers 0 / 1 / 2 and the USART
run, so `delay`, `millis`, `analogWrite` (490 / 980 Hz PWM) and `Serial` behave. The runner
records every edge of every OUTPUT pin (Uno numbering D2–D13, A0–A5) as `[seconds, level]`, each
pin's mode, the serial text and the cycles; the result is cached per (sketch, seconds) in the
worker process.

In the deck an OUTPUT pin is a PWL source (0 / 5 V, 50 ns edges) through 25 Ω — the AVR's
output resistance — so an LED on D13 draws what a real one would; an INPUT pin is a 10 MΩ load
and `INPUT_PULLUP` a 35 kΩ to the rail; the `5V` pin is a sensed 5 V source against the board's
`GND` (the board's supply current is `i(<id>)`); a sketch that does not compile is a refusal
naming `parts[i].props.sketch` with the compiler's own words; a pin toggling more than 20 000
times in the run is refused (shorten the transient or slow the sketch). The board's spare
headers are not `unconnected_pin` warnings, and its GND can be the 0 V reference. Readings:
`compiled`, `flashBytes`, `simulatedSeconds`, `cycles`, `pinsDriven`, `edges`, `modes`, `serial`,
supply amps.

The sketch is compiled as C++ with `#include <Arduino.h>` in front of it and nothing else: unlike
the Arduino IDE there is no automatic prototype generation, so a function must be declared before
it is called. A board whose `GND` pin is not wired carries a `board_floating` warning.

### 5b. The closed loop — the sketch reads the circuit (0.7.0)

When a pin the sketch can read is connected to something (its net has another pin on it), the run
is no longer open-loop: the worker solves the **same circuit** a second way first, with every
driven pin as an ngspice `external` source, through **libngspice** (Debian `libngspice0`) instead
of the batch binary — and the AVR runs inside that transient.

The loop, in the order it happens:

1. A probe run (the open-loop runner) says which pins the sketch made inputs and which analog
   channels it read. Pins alone on their net are **not** feedback: nothing in the circuit moves
   them, and pretending otherwise is the fake this feature refuses to be.
2. `firmware/cosim.py` runs as its own process (libngspice is a process singleton, and a deck it
   refuses must not take the worker down) and holds **one** avr8js CPU alive on a pipe — the same
   CPU for the whole run, with its RAM, its timers and its program counter, advanced one slice at
   a time. Restarting it per slice would silently re-run `setup()`.
3. At every **accepted** solver point (`SendData`), the node voltages on the pins the sketch reads
   are latched: a digital pin keeps its level inside the AVR's own 1.5 V / 3.0 V band, an analog
   pin takes the volts into avr8js's ADC so `analogRead` converts them with its real timing. Then
   the AVR is advanced until it is one sync step ahead of the solver.
4. The solver asks for each external source's value (`ngSpice_Init_Sync` / `GetVSRCData`); that is
   a **pure lookup** into the timeline the AVR has already produced. The AVR is never advanced
   from that callback: ngspice asks about times it then rejects, and an AVR cannot be rewound.
   The `.tran` card's maximum internal step is pinned to the sync step, so the solver can never
   ask about a time the AVR has not reached.
5. The closed-loop timeline is then emitted as ordinary PWL sources and the deck is solved by the
   batch path that every other part already uses — so the waveforms, readings and warnings come
   from one well-trodden road. The two solves are then **compared**: the largest difference
   between the voltages the loop fed the sketch and the voltages the final deck produced, at the
   sampled instants (within three output steps, since each solve picks its own time points). Over
   0.35 V is a `cosim_disagreement` warning naming the node, the volts and the time.

**The step, and why it is stable.** The default sync step is 100 µs (1 600 AVR cycles), bounded to
4 µs … 10 ms and to a quarter of the run; `sim.syncSeconds` sets it and anything outside is a
refusal naming the field. Coupling is loose in one direction only: the OUTPUT path is
edge-exact (an edge keeps its avr8js timestamp inside the slice), the INPUT path is sampled, so
the sketch sees the circuit as of somewhere in the last sync step. That delay is not a numerical
fudge — a real sketch is a sampled system, and 100 µs is far shorter than the loop of any sketch
a person writes. It does have a failure mode, and the lab names it rather than hiding it: a sketch
wired back to its own input through an inverting path cannot settle, and what it then oscillates
at is the step, not the circuit. Edges locked to the sync step raise `cosim_chatter` naming the
pin and telling you to lower `sim.syncSeconds` and compare. The run still completes.

**Where it stops.** One board per run — a second AVR needs a second slicer, and running it
open-loop beside a closed one would read like a closed loop and would not be one; that is a
refusal, not a warning. A pin that changes direction mid-run carries `firmware_mode_changed`: the
deck's topology is fixed for the transient and holds the mode the sketch set first. The AVR does
not run before the solver's first accepted point (its pins are 0 V sources until then), which is
also what a real board does while it is still in reset. An engine image without libngspice keeps
the open-loop path and says so loudly — `cosim_unavailable`, naming `install-engine.sh`.

Readings gain `closedLoop`, `syncSeconds`, `coSimSlices`, `solverPoints`, `readsPins` and
`analogReads`. Proven in the real-solver suite by a button the sketch polls (the LED can only
change because `digitalRead` saw the node the switch pulled down) and a potentiometer it reads
(`analogRead` reports the counts the solved wiper voltage implies, and the PWM it writes averages
to that duty), plus four refusals.

### The servo

A hobby servo seen at its output shaft. The pulse on `sig` is decoded in the deck: a ramp of
1 V per ms runs while the signal is above 1.5 V; a delayed copy of "high" (τ 0.1 ms) opens a
~70 µs window after each falling edge in which a hold (through a unity buffer, so no charge is
shared) tracks the ramp; the ramp then resets. The hold reads the width in ms; the target angle
is `travelDeg · clamp((width − minPulseMs) / (maxPulseMs − minPulseMs), 0, 1)`, smoothed over
2 ms. A position loop drives the geared motor with `V_supply · tanh(error / 10°)` — full drive at
ten degrees of error, and nothing without a supply on `v+`. The motor's constants at the output:
`R = V / I_stall`, `Ke = (V − R · I_run) / ω_noload` (the free speed is exactly the rated deg/s),
`Kt = τ_stall / I_stall` (Kt ≠ Ke: the gearbox loses power), `b = Kt · I_run / ω_noload`, a fixed
0.5 mH. The supply current is `|i_motor| + idleAmps`. Signals: `angle`, `rpm`, `torque`, `pulse`
(ms), `target` (deg), `i` (supply) and `i(<id>:motor)`. The 1.5 V decode threshold reads a
source's 50 %-width pulse 0.4 edge-times long (0.008 ms at 50 Hz, ≈ 1.4° of 180).

### The stepper and its driver

A two-phase bipolar stepper: `N = stepsPerRev / 4` pole pairs, `Km = holdingTorque / (√2 ·
ratedAmps)` per phase (both phases at rated current give the holding torque). Each phase is
`R + L + back-EMF`, with `e_a = −Km · sin(Nθ) · ω`, `e_b = Km · cos(Nθ) · ω`; the torque on the
shaft node is `Km · (−i_a sin(Nθ) + i_b cos(Nθ))`, the detent `−τ_d · sin(4Nθ)`, and a damper
`2 · dampingRatio · sqrt(Km · I_rated · N · J)` capped at 10 % of the holding torque (the damping
real steppers show; the cap keeps it from dominating at speed). The `stepdriver` counts rising
edges on `step` with a charge packet — 1 µF charged through 5 Ω while the pin is above
`thresholdVolts`, only the charging current integrated — so every edge adds exactly
`π/2 / microsteps` electrical radians in the direction `dir` sets (pulses and gaps of 25 µs or
more). Its phase currents are `I · cos φ` and `I · sin φ` (sine / cosine microstepping: at
rated current the static torque is `Km · I`, 1/√2 of the holding torque), held by a saturating
regulator (100 V/A) whose outputs are referenced to `gnd` at half the supply; the supply current
follows the delivered power. Signals: `angle`, `rpm`, `torque`, `i(<stepper>)` / `i(<stepper>:b)`
(phase currents), `steps(<driver>)` and `i(<driver>)` (supply). The **load angle** is the
electrical angle the currents command (unwrapped over time) minus `Nθ`; the run reports it in
degrees on the shaft, `holding` when it stayed under 180° electrical, and `slipped` once it
passed — the rotor then falls into the next well and the weight, if any, back-drives it.

## 6. The run

`sim`: `stopSeconds` (default 1), `stepSeconds` (default stop/2000; at most 20 000 points),
`startFromRest` (default true → `tran … uic`: power applied at t = 0 to a circuit at rest;
false → the DC operating point first). The control block runs the transient, `linearize`s to the
sample step and writes every requested vector with `wrdata`. The worker reads the columns by
position, scales them into the public signals (`v(n1)`, `i(R1)` — battery and source currents
are positive *out of* the `+` pin — `rpm(M1)`, `rpm(shaft:G2)`, `torque(M1)`), rounds to six
significant digits and computes the readings.

**Readings per part** (`final` = mean of the last 2 % of samples; `avg`, `peak` over the run):
battery / source — volts, amps avg / peak / final, watts, `runtimeHours` (capacity ÷ average
draw); resistor — amps, volts, watts, `overRated`; capacitor — volts final / peak, `overRated`;
LED — mA final / peak, `lit` (≥ 1 mA), `brightness` (fraction of `maxMa`), `overMax`; switch —
`closed` at the end; transistors — amps, volts across, watts; motor — rpm final / peak, amps,
torque (mN·m), mechanical and electrical watts, efficiency, `stalled` (< 1 % of no-load speed
while drawing > 50 % of stall current), the derived constants and the reflected train; gear and
load — shaft, `driven`, ratio, rpm, the gear's pitch radius. Warnings: `no_ground`,
`no_reference`, `unconnected_pin`, `module_mismatch`, `not_driven`, `over_rated`,
`led_over_max`, `motor_stalled`, `non_finite`.

A solver failure is retried **once** with relaxed tolerances (`reltol 0.01, abstol 1e-8, vntol
1e-5, gmin 1e-9, method gear`) and, when that solves, the run carries a `relaxed_tolerances`
warning; the stored deck keeps the default options.

**The solver knobs.** `sim.reltol` (1e-6 … 0.05; the lab's default 0.003), `sim.gmin` (1e-15 … 1e-6
siemens; ngspice's 1e-12) and `sim.method` (`trap`, ngspice's default, or `gear` for stiff,
hard-switched circuits) let a person choose instead. Both contracts bound them and name the field;
null or absent is the default; `/capabilities` publishes the defaults, the limits and the two
methods. The deck's `.option` line is written in one place (`circuit_parts.spice_options`): a sim
without knobs gets the default line exactly (a deck from before the knobs is unchanged); a sim with
any knob gets `.option rshunt=1e12 reltol=<chosen or 0.003> abstol=1e-9 vntol=1e-6` plus the chosen
`gmin` and `method`. **A choice is never retried over**: when ngspice refuses a circuit under knobs
the person set, the refusal comes back naming them, and the automatic relaxed retry runs only at the
defaults. The surface's run settings carry the three (empty = default); `circuit-run` takes them. A second failure is `refused` with the last
error lines of ngspice's log (`engineLog` carries the tail on every run). Behavioural sources use
smooth functions (tanh, max, min) — a hard step inside one stalls ngspice's timestep control.

Readings for the added parts: zener `regulating`; lamp `brightness`, `lit`, `overRated`;
regulator input / output volts, amps, `droppedWattsFinal`, `overMax`, `inDropout`; op-amp volts,
amps, `saturated` (judged before its 50 Ω output stage); relay coil amps, `energized`, contact amps;
sequencer `levelFinal`, `steps`; H-bridge out1 / out2 amps, volts across, `direction`; 555 `outHigh`,
`risingEdges`, `frequencyHz` (from the rising edges), `dutyPercent`; servo `angleDeg`, `targetDeg`,
`pulseMs`, supply amps, `tracking` (within 5°), `stalled` (over 10° while drawing half the stall
current); stepper `angleDeg`, rpm, phase amps, `loadAngleDeg`, `holding`, `slipped` (a
`stepper_slipped` warning) — read at the last sample, since a step inside the 2 % window would
blur them; step/dir driver `stepsFinal`, supply amps, phase peak.

## 7. The engine container

`engine/container/Dockerfile`: `python:3.11-slim-bookworm` + Debian's `ngspice` (39), `gcc-avr`,
`avr-libc`, `arduino-core-avr` and `nodejs`, the pinned `avr8js` 0.21.1 tarball (sha512 checked at
build), the Arduino core precompiled to `core.a`; a non-root user, read-only root, `/tmp` for the
scratch decks and sketch builds. `circuit_engine_bridge.py` serves the
worker over TCP (`circuit-lab-engine:7413` on the stack network, own compose project
`oshal-circuit-lab-engine`): one connection owns one worker process, the first line is a hello
with the protocol and the **build hash** of `circuit_worker.py, circuit_parts.py,
container/circuit_engine_bridge.py, container/Dockerfile, firmware/arduino_build.py,
firmware/avr8js_run.js, firmware/cosim.py`. The api (`engine-client.ts`) verifies
that hash against this package's tree before the first request; a mismatch or an absent
container is `capability_unavailable` with the exact install command
(`engine/install-engine.sh`, which builds, starts and self-tests the container).

## 8. The API

All under the `oidc` mount `/api/circuit-lab`; every handler re-derives the caller and every SQL
statement carries `owner_sub` beside the migration's RLS.

| method | path | what |
|---|---|---|
| GET | `/capabilities` | the contract, the examples, the engine status, the catalog's size |
| GET | `/examples` | the four starter circuits |
| GET | `/catalog/drivers` | the shaft-driver catalog (`?type=motor|servo|stepper`): rows with a nameplate that validates against the contract, mass, price, `source`, `usedBy` (§8b) |
| GET / POST | `/designs` | list; create (`{title, example?, parts?, wires?, sim?, run?}`) — a non-empty circuit is solved |
| GET / PATCH / DELETE | `/designs/:id` | read (with runs and engine status); rename or change `sim`; delete (runs and files go) |
| PUT | `/designs/:id/circuit` | replace parts + wires (`run` default false — the canvas autosave) |
| POST | `/designs/:id/parts` | add a part (`run` default true) |
| PATCH / DELETE | `/designs/:id/parts/:partId` | change (props merged) / remove with its wires |
| POST | `/designs/:id/wires` | connect two pins |
| DELETE | `/designs/:id/wires/:wireId` | disconnect |
| POST | `/designs/:id/run` | solve, with an optional `sim` patch |
| POST | `/designs/:id/restore` | put back a kept run's circuit and settings, solved as a new run (`restoredFrom`) |
| GET | `/designs/:id/parts/:partId/gear-profile` | the CAD Studio body for a gear (`?faceWidthMm=&boreMm=` override its properties); 422 with the reason above 120 teeth or for a bore into the rim |
| GET | `/designs/:id/runs`, `/runs/:run` (`latest`) | history; one run's circuit and report |
| GET | `/designs/:id/runs/:run/artifacts/:key` | `waveforms` (json), `netlist` (cir), `report` (json); `?download` |

Every mutation answers `{ design, run: {run, report} | null, build: {ok, code?, error?,
reason?, field?, ms} }` with 200 / 201 on success, 400 (contract, `field`), 404, 422 (the
engine refused, `field` when it named one), 503 (engine unavailable, the install command in
`reason`).

## 8a. The gear hand-off

`gear-profile.ts` draws the involute spur-gear outline (pitch radius mN/2, base radius rp·cos α,
addendum m, dedendum 1.25 m; true involute flanks between the base circle and the tip, radial
below the base circle, short root and tip arcs; 3–6 points per flank by tooth count, at most
2000 points, so at most 120 teeth) and builds the body CAD Studio's `POST /models` takes: a
`sketch` base on the XY plane extruded by `faceWidthMm`, plus a `hole` of `boreMm` on the axis.
The surface posts it under the person's own session and opens CAD Studio; the concierge gets the
same body from `circuit-gear-to-cad`. `tests/gear-profile.test.js` validates the body against
CAD Studio's own contract (read-only cross-package import).

## 8b. The driver catalog

`catalog/drivers.json` declares motors, servos and steppers once: an id, the type, a name, a
kind, the mass and price other packages share, an optional KV / cell count, a **nameplate** that
is exactly the part's properties (loaded through the same `validateProps`, so a row that drifts
from the contract fails the mount naming the row and the field), a **source** line saying where
each number came from (a number marked typical is not a measurement), and **usedBy**. The two
motors embodied's fits name are rows here; `tests/driver-catalog.test.js` reads embodied's compiled
parts model read-only and fails when either name, mass or price differs between the packages
(B4, this lab's half). The inspector's "nameplate from the catalog" and the
`circuit-driver-catalog` tool fill a part's properties from a row.

**A row may not describe a part another package already owns.** A servo bought once should be
describable once, and the SG90 was written down twice — animatronics publishes it (identity, mass,
price, source, and the pulse / travel / speed / torque / current block a rig is built from) and
this catalog restated it under its own name at its own price. Such a row now carries
`sharedPart: {owner, file, list, id}` instead, declares only the block this lab adds — the
operating point the solver runs it at and the reflected rotor inertia — plus a `note` saying so,
and `loadDriverCatalog` reads the rest out of the owner's catalog **file**. It is data, not an
imported runtime: nothing here requires a sibling package's module, so the scoped route compile is
untouched and the store's package-separation guard has nothing to weaken. The translation into
this lab's units (µs → ms, s/60° → deg/s, kg·cm → mN·m, mA → A) lives here, once, so the owner
never carries this lab's units.

Store packages install one at a time, so the read is fail-closed: an owner that is absent, or
present but unable to answer (no list, no row, unreadable file, a row missing a number), WITHHOLDS
that one row with a reason naming the owner — `GET /catalog/drivers` answers `{drivers, unresolved}`
and every row this package owns outright still loads. Restating a field the owner publishes, or
choosing an operating point outside the owner's voltage window, is refused at load with the field
named. The catalog is re-read per request, so installing the owner later needs no restart.
`tests/shared-parts.test.js` proves all of it against real package trees on disk, including a
fixture packages root whose owner declares different numbers — the answer moves with it, which a
copy could not do.

## 9. The canvas

A 1920 × 960 world on a 20 px grid; the viewBox is the camera (wheel zooms about the cursor, shift-
or middle-drag pans, *reset view* returns to the top-left 960 × 480). Every hit test goes through
the screen CTM, so drops, drags and wires stay exact at any zoom. Edits are snapshotted locally
for undo / redo (Ctrl+Z / Ctrl+Y, 100 deep, reset when a design opens or the concierge's edit
arrives by poll); a selected part copies and pastes (Ctrl+C / Ctrl+V, offset 40 px, a fresh id).
With *values on canvas* on, every electrical wire shows its net's voltage, every mechanical link
its shaft's rpm and every sensed part its current (a servo's or stepper's angle), at the
timeline's time. A drag on empty canvas draws a marquee: the parts inside become one selection
that moves and deletes together (the inspector shows their count). A wire's middle segment is a
drag handle: dragging it re-routes the wire and the position is saved on the wire as
`route.mid`. Clicking a wire adds its net's voltage (a shaft link's rpm) to the plots. Rotors and
gears turn by the solver's `angle(<driver>)` signal (times the shaft's ratio) when it exists; a
servo's horn points at its angle.

**Bends and group turns** (`tools/circuit-lab-geometry.js`, one plain-JS copy the canvas and the
plain-node suite both load). A double-click on a wire puts a bend on the segment nearest the click
— snapped to the grid along a horizontal or vertical run, so placing it never moves the wire — and
the wire's current corners become explicit bend points (`route.points`); a bend drags on the grid;
a double-click on a bend removes it, and the last one gone leaves no route (the automatic path). A
corner that repeats the one before it or lies on the straight run between its neighbours carries
no shape and is dropped. `R` on a multi-selection turns the group a quarter clockwise about the
grid-snapped middle of the parts' bounding box: every position turns about it and every part's own
rotation advances 90°, so the group — pins included — turns rigidly; a routed wire whose two ends
are both in the group turns with it as bend points; a turn that would put a part closer than 20 px
to the canvas edge is refused in a toast with nothing moved. Keys reach the canvas only while the
schematic is showing.

## 9b. The breadboard

A design may carry a **board** beside the schematic (`board` jsonb: `{ placements: { partId:
{ col, row, rot? } }, jumpers: [{ id, from, to }] }`). The board is a full-size breadboard — 63
columns, rows a–e and f–j, two rails top and bottom — and a hole is `a5`, `j12`, `T+3`, `B-40`.
The five holes of a column in a block are one **strip**; a rail is one strip. Every electrical
part type has a **footprint**: which hole each pin sits in relative to its anchor (a resistor's
legs four columns apart, a transistor's three pins in a row, a servo's or driver's header in a
row, a ground on a rail hole; a 555 and an op-amp are DIP-8 packages straddling the gap on their
real pinouts — pins 1–4 on row e, 8–5 on row f above them). Gears and loads have no footprint.

The model (`tools/circuit-lab-board-model.js`, one plain-JS copy that the browser and the routes
both load) derives **nets from the board** — pins on one strip share it, jumpers join strips — and
**nets from the schematic** — pins joined by electrical wires — and compares the two partitions.
The deck is a function of the parts and the net partition (net names are assigned in part order),
so equal partitions mean the same deck; `tests/board-model.test.js` proves it on every starter
example both ways, and the browser suite proves it on the actual page.

- `POST /designs/:id/board` lays a board out from the schematic (parts placed along row b, then
  row i, DIPs across the gap, grounds on the − rail; a jumper chain per net through its strips) —
  422 `board_capacity` when the circuit does not fit.
- `PUT /designs/:id/board { placements, jumpers }` validates the board (real holes, no two legs in
  one hole, existing parts), **derives the schematic's electrical wires from it** (a wire that
  still joins one net keeps its id; the rest are rebuilt as chains; mechanical wires are kept),
  stores both and solves; the reply carries `agree: true`.
- Every route that changes parts or wires **reconciles** a saved board: placements of removed
  parts go, new parts are placed, the jumpers are regenerated from the new nets, placements are
  kept. A board that can no longer place a part is marked `stale` with the reason.
- `DELETE /designs/:id/board` drops it.

**Turned footprints.** A placement may carry `rot` (90, 180 or 270 — clockwise; absent is 0). A
row part's legs then step down the rows from its anchor (90), back along the row (180) or up the
rows (270) through the order T+, T−, a … e, f … j, B+, B− — an upright resistor anchored on row c
lands in c and f, across the channel; a pull-down from row i lands on the bottom − rail. A DIP
always straddles the gap unturned (`board.placements.<id>.rot` refused), a bad turn is refused the
same way, and a leg off the board is "does not fit". Two legs of one part on one strip are a short
the board itself makes — an upright part inside one block of five, a flat part along a rail —
and the view names it (`R1 is shorted: a and b share strip t10`); the nets say the same.

**The physical board.** Every row sits where the BB830 830-point pattern puts it, in 0.1 inch
(2.54 mm) pitches from the top rail: the two rails 0 and 1, rows a–e 3–7, rows f–j 10–14, the
bottom rails 16 and 17 — so rows e and f are 0.3 inch apart (the DIP channel) and each inner rail
row sits two pitches from row a or j. Source: BusBoard's SB830 datasheet (BPS-MAR-(SB830)-001
Rev 4.00), "the same pattern as a standard 830 connection point BB830" for transferring a circuit
"without recutting wires", whose actual-size layout puts all 18 of its hole rows on the 0.1 inch
grid (its spare rows are where the plug-in board has none). The view is drawn to that scale (14 px
per pitch) and a jumper is drawn as the straight wire it is between its holes, at its span
(`jumperLengthMm`); the selected jumper reads its length in mm and the total and longest sit under
the board. The model keeps the 63 columns and treats a rail as one strip along all of them.

On the surface the *Breadboard* button opens the view: drag a part to another hole, click one
hole then another to add a jumper, click a jumper and Delete to remove it; each edit is PUT and the
schematic's wires follow. The concierge's tools edit the schematic; the board follows through the
reconciliation.

## 10. What is deliberately not here

No firmware input for more than one board at a time (§5b), no general
2-D linkage layer beyond the crank-slider
(no contacts, no wheel on the ground), no brushless motor as a three-phase element (the catalog
carries its DC equivalent) — each is a BACKLOG item
with done-when criteria. Positions are cosmetic. The board draws a jumper at its straight span; it
does not route wires around parts. The lab models lumped circuits and lumped mechanics; it does not model heat.

## 11. The assistant

Two rails, both the framework's, nothing bespoke.

**The surface-bridge** (`surface: ops: [context, custom, notify]` in the manifest — the cockpit
relay is fail-closed and forwards nothing for an app that does not declare its ops). The page loads
the shared client as an ES module, binds it to `circuit-lab` and hands it to the main script
through `window.__bridge`; without the module (an old cockpit, the browser fixture) the `import`
rejects inside a `try` and the lab behaves exactly as before. `publishContext()` emits a `context`
op — surface `schematic` or `breadboard`, the design title and id, a digest and fields — on every
adopt of a route result (create, edit, run, restore), on open, on selection, on a view switch and
on the poll that notices a run finishing, and again when the assistant asks `request_context`. The
digest is prose the model reads: the title, counts and run state; every part as `id type (props)`
(a sketch as its line count, never its text); every wire as `id from.pin-to.pin`; the readings the
inspector would show, the warnings, the selection — cut at 3,900 characters with a truncation mark,
because the contract drops a context op whose digest exceeds 4,000.

Edits arrive as one `custom` op, `circuit_action`, whose description (under the contract's
600-character cap) IS the vocabulary — the assistant is told the exact op name and the ten action
shapes, or it invents a plausible one and the edit is silently dropped. The handler applies the
actions in order through the routes the canvas already uses (`POST /parts`, `PATCH /parts/:id`,
`DELETE`, `POST /wires`, `DELETE /wires/:id`, `POST /run`, `POST /restore`, the example starters),
each with `run: false`, then one solve at the end when auto-run is on — so a five-action edit is
one transient, not five. A refused action (a 422 with its field, an unknown id) is reported in the
toast with the field and does not stop the rest. The page keeps its own optimistic state out of
it: every action's result is adopted like any other route result, so the canvas, the inspector,
the runs list and the next context publish all agree.

**Delegate mode** (`jarvisMode: delegate` on `circuit-lab-engineer`). The orchestrator's effective
routes read that flag, so a circuit question in the chat is handed to the concierge — which finds
the caller's designs through its route-backed tools and answers with numbers — instead of a
deep-link to the tile. The two rails compose: the surface digest tells the assistant which design
is open; the concierge's tools read that design's full readings.

Not here: briefings and background tasks. The lab has no events that happen while nobody is looking
— a run finishes seconds after it starts — so there is nothing to brief.
