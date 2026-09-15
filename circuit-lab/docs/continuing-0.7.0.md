# Continuing 0.7.0 — the sketch reads the circuit (2026-09-14)

0.7.0 closes BACKLOG B1: an Arduino sketch's `digitalRead` and `analogRead` now see the solver's
node voltages. This note is the hand-over for putting it on a box — nothing here is installed.

> **The branch has moved on to 0.8.0** (BACKLOG B2, B7, B9 — breadboard turns and jumper lengths,
> several bends per wire and group rotation, the solver knobs). Nothing below changes except the
> numbers: install 0.8.0 the same way (`App loaded … circuit-lab 0.8.0`), and expect **52** cases
> from `python -m unittest discover -s tests` in the rebuilt image — the two `HardSwitching` cases
> (BACKLOG B7) have never run anywhere, so a red one there is the first run's news, not a
> regression; B7 says what to do with it. 0.8.0 also changes `circuit_parts.py` and
> `circuit_worker.py`, so the engine build hash moves again and the image must be rebuilt.

## 1. Where things stand

| thing | state |
|---|---|
| package version on the branch | 0.7.0 (`oshal-app.yaml`, `marketplace.json`, README apps row, `audits/circuit-lab.json`, Test Lab catalog, ARCHITECTURE, BACKLOG) |
| version running on the reference box | **0.5.1** — neither 0.6.0 nor 0.7.0 is installed, and the box's engine image has no AVR toolchain and no libngspice |
| new in 0.7.0 | the closed loop (§2); `libngspice0` in the engine image; `sim.syncSeconds` in the contract on both sides; `firmware/cosim.py` in the engine build hash |
| verified | **45 / 45** real-solver cases inside `circuit-lab-engine` built from this tree (`python -m unittest discover -s tests`), the installer self-test green (`blinkRisingEdges: 3`, six checks true), 28 / 28 plain-node package cases on the host |
| **not verified** | the framework-coupled route suite (needs a core checkout) and the browser suite were not re-run — 0.7.0 changes no route behaviour and no page code, only the contract's `syncSeconds` bound and the engine; run both before installing |
| core docs | ADR-154 has no 0.7.0 addendum yet — write it when the box runs it, not before |

## 2. What the closed loop is

The design is ARCHITECTURE §5b; the short version. When a pin the sketch reads is wired to
something, the worker first solves the same circuit through **libngspice** (`libngspice.so.0`,
Debian `libngspice0`) with every driven pin as an ngspice `external` source, and the AVR runs
inside that transient: at each **accepted** solver point the node voltages on the read pins are
latched into avr8js, then the AVR is advanced until it is one sync step ahead. The source callback
is a pure lookup into edges the AVR has already produced — it never advances anything, because
ngspice asks about times it then rejects and an AVR cannot be rewound. The closed-loop timeline is
then emitted as ordinary PWL sources and solved by the batch path everything else uses, and the two
solves are compared (`cosim_disagreement` over 0.35 V on a read node).

`firmware/cosim.py` is a **separate process** — libngspice is a process singleton, and a deck it
refuses must not take the worker down. It holds one avr8js CPU alive on a pipe for the whole run.

The step is `sim.syncSeconds`: 100 µs by default, bounded 4 µs … 10 ms and to a quarter of the run,
refused by name at both the route and the engine. The OUTPUT path is edge-exact; the INPUT path is
sampled at that step, which is the real sample-and-hold a sketch already is.

## 3. Put it on a box

The engine image **must** be rebuilt: `libngspice0` is new in the Dockerfile and the build hash
changed (`firmware/cosim.py` joined `RUNTIME_FILES`), so the api will refuse the old container.

1. Stage LF-exact from the commit over the deployed tree (never the working tree):

   ```sh
   git -c core.autocrlf=false archive <sha> circuit-lab | docker exec -i oshal-local-api tar -x -C /tmp/stage
   docker exec oshal-local-api sh -c 'cp -a /tmp/stage/circuit-lab/. /app/workspace-shared/deployed-apps/circuit-lab/ && rm -rf /tmp/stage'
   ```

   then stamp `.oshal-install.json` (`sha`, `installedAt`, `version`) with node inside the api.
2. Rebuild the engine container from inside the api:

   ```sh
   docker exec oshal-local-api sh /app/workspace-shared/deployed-apps/circuit-lab/engine/install-engine.sh
   ```

   The apt layer is invalidated by `libngspice0`, so this re-downloads about 250 MB and recompiles
   the Arduino core (four to five minutes on an idle box). `ERROR: failed to build: NotFound:
   forwarding Ping: no such job` is the daemon dropping the BuildKit session under load — retry
   when calm; the layer cache survives it.
3. Check no `pg_dump` is running in the api, then ONE `docker restart oshal-local-api`. Wait for
   `App loaded … circuit-lab 0.7.0`; the Test Lab catalog must load (every `expected` line is
   under the loader's 500-character cap — the longest is 353).
4. Prove it from inside the api. `GET /api/circuit-lab/capabilities` reports the engine connected
   with `firmware: true`. Then solve a board with a button: an Uno with
   `pinMode(2, INPUT_PULLUP); pinMode(13, OUTPUT);` and
   `digitalWrite(13, digitalRead(2) == LOW ? HIGH : LOW);`, a switch from D2 to GND with
   `toggleAtSeconds: 0.02`, and an LED with 220 Ω on D13, over `stopSeconds: 0.04`. The LED must be
   dark before 18 ms and lit after 25 ms, and the Uno's reading must carry
   `closedLoop: true` with `readsPins: ["D2"]`. That is the whole feature in one run.
5. Post releases in both COLLABORATE threads, then write the ADR-154 0.7.0 addendum.

## 4. Triage if a `Cosim` case goes red

In this order. **The compile** (`MCU_FLAGS` in `arduino_build.py`; the compiler's words are in the
refusal). **The AVR half alone** — drive `avr8js_run.js --serve <hex>` by hand with a few
`{"t":..,"digital":{"D2":1}}` lines and watch the edges come back; that isolates avr8js's
`setPin` / ADC from the solver entirely. **The solver half** — `cosim.py` refuses loudly when the
solver does not report a node it was told the sketch reads, naming the vectors it did report;
that guard exists because a missing node would otherwise feed the sketch a silent zero.
**The comparison** — `cosim_disagreement` names the node, the volts and the time; the two solves
pick their own time points, so the check already allows three output steps of slack.

## 5. Hazards this version taught

- avr8js input pins default to LOW, not to their pull-up. A sketch that reads an unwired
  `INPUT_PULLUP` pin used to see LOW, which is not what a real board does; the runner now sets
  those pins high unless the co-simulation is driving them.
- Do not advance the AVR from the source callback. ngspice asks for source values at candidate
  times it then rejects; only `SendData` is monotonic, which is why the AVR is advanced there and
  the solver's maximum internal step is pinned to the sync step.
- The AVR must not run before the solver's first accepted point. It did at first — one slice
  against a circuit still at 0 V — and the sketch's very first read was wrong for 100 µs, which
  showed up as a startup glitch on the LED. It now starts on the first latch, which is also what a
  real board does while it is still in reset.
- The contract lives twice (`src-routes/circuit-contract.ts` and the compiled
  `routes/circuit-contract.js`) and `describeContract()` spells its `sim.limits` out by hand: a new
  limit has to be added in **three** places or `contract-parts.test.js` goes red comparing the Node
  library with the Python one.

## 6. What stays open

B1's remaining edges (more than one board per run; Nano / Mega / Pico), B3 (printed gear fit),
B7 (convergence knobs), B8 (store-side execution of the framework-coupled and real-solver suites),
B9 (multi-bend wires), B12–B16. Each carries its done-when in [BACKLOG.md](../BACKLOG.md).

Not attempted here and deliberately so: the surface does not expose `sim.syncSeconds` — the
contract accepts and bounds it, the engine honours it, and every run without it uses the default.
Adding a control for it is a surface change with its own browser case.
