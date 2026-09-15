# Continuing 0.6.0 — firmware outputs and the assistant rail (2026-09-14)

The 0.6.0 package is complete in the tree and on the branch; this note is the hand-over for
finishing its verification on the real toolchain and putting it on a box. Read it top to bottom
before touching anything — every step names the command, the expected result and the failure to
look for.

## 1. Where things stand

| thing | state |
|---|---|
| package version on the branch | 0.6.0 (`oshal-app.yaml`, ledgers, Test Lab catalog, docs) |
| version running on the reference box | **0.5.1** — 0.6.0 is NOT installed; the box's engine image has no AVR toolchain |
| contents new in 0.6.0 | the `arduino` part and its firmware runner (§2); the assistant rail (§3); the 0.5.1 catalog fix folded in |
| verified on a host checkout | contract 6 / transport 7 / gear 4 / catalog 3 / board 5 / assistant-rail 3 (plain node); routes 11/11 (the catalog through the framework's own loader); browser 11/11 in headless Chromium with the real core bridge client served by the fixture |
| **not verified** | the 39-case real-solver suite (`engine/tests/test_circuit_worker.py`) and the installer self-test (`circuit_engine_bridge.py --selftest`) inside the rebuilt engine image — the image build completed all seven Dockerfile steps on the reference box (the Arduino core compile took 245 s) but the Docker daemon was saturated and the client session was dropped before the image was exported and the suite could run |
| core docs | ADR-154 carries as-built addenda through 0.5.1; the 0.6.0 addendum, the ADR index row and the BACKLOG pointer say "on the branch, not installed" until the suite is green |

The four firmware cases (class `Firmware`) are the ones with no run on record: a blink sketch's LED
at the sketch period with its serial captured, `analogWrite(9, 64)`'s RC average at the duty, a
sketch that does not compile refused naming `parts[0].props.sketch`, and a 12 s transient warning
`firmware_truncated`. The other 35 cases passed at 0.5.1 on the previous worker and the worker's
changes since then are additive (`emit_arduino`, the `firmware` hello flag, `MAX_PWL_POINTS`).

## 2. What the firmware half is

`engine/firmware/arduino_build.py` compiles a sketch for the ATmega328P with Debian's `gcc-avr`
against the Arduino AVR core (`arduino-core-avr` 1.8.7, precompiled into `core.a` at image build —
that core needs `-DDECIMAL_DIG=9` under avr-gcc 5.4 or `WString.cpp` fails), links, and runs the
HEX in `engine/firmware/avr8js_run.js` (avr8js 0.21.1, the npm tarball pinned by sha512 in the
Dockerfile) for the transient, at most 10 s, capturing every OUTPUT pin's edges, pin modes and the
USART. `circuit_worker.py::emit_arduino` turns each driven pin into a PWL source through 25 Ω and
the readings carry flash bytes, pins driven, edges and serial. INPUT pins are loads; the sketch
cannot read the circuit back (BACKLOG B1, the input half). Contract, symbol, inspector textarea,
starter `arduino-blink` and readings are in place and browser-tested.

## 3. What the assistant rail is

`oshal-app.yaml` declares `surface: ops: [context, custom, notify]` (the cockpit relay forwards
nothing for an app without it) and `jarvisMode: delegate` on `circuit-lab-engineer`. The page
loads `/shared/ui/js/surface-bridge-client.js` as an ES module inside a `try` (absent on an old
cockpit → the lab behaves as before), publishes a `context` op (surface `schematic` or
`breadboard`, the design id, a digest capped under the contract's 4,000 characters) on every open,
save, run, selection and view change and on `request_context`, and applies `circuit_action` edits
through the routes the canvas uses with one solve at the end. ARCHITECTURE §11 has the design;
`tests/surface-bridge.test.js` and the eleventh browser case guard it. Nothing here needs the
engine image.

## 4. Finish the verification

Run on any machine with Docker (the reference box only when its VM is calm — `docker exec
<redis> cat /proc/loadavg` under 12 on 8 CPUs, and no image build from anyone else in flight).

1. **Build from an LF-exact tree.** A Windows checkout is CRLF on disk; the blobs are LF. Build
   from `git archive` output so the layers match what the installer builds inside the api later:

   ```sh
   git -c core.autocrlf=false archive <sha> circuit-lab/engine | tar -x -C /tmp/cl
   docker build -t circuit-lab-engine:b1 -f /tmp/cl/circuit-lab/engine/container/Dockerfile /tmp/cl/circuit-lab/engine
   ```

   The first build downloads about 250 MB of apt packages and compiles the core (four to five
   minutes on an idle box). `ERROR: failed to build: NotFound: forwarding Ping: no such job` is
   the daemon dropping the BuildKit session under load, not a Dockerfile fault — retry when calm;
   the layer cache survives the drop.

2. **Run the suite and the self-test inside the image** (the image copies the engine tree to its
   workdir, so no mount is needed):

   ```sh
   docker run --rm --network none circuit-lab-engine:b1 python -m unittest discover -s tests
   docker run --rm --network none circuit-lab-engine:b1 python container/circuit_engine_bridge.py --selftest
   ```

   Expected: `Ran 39 tests … OK`, and the self-test's fourth request reporting `firmware: true`
   with the blink LED rising at least twice. If a `Firmware` case is red, the places to look in
   order: the compile step (`MCU_FLAGS` in `arduino_build.py`; the compiler's words are in the
   refusal), the avr8js run (`avr8js_run.js` — pin numbering is Uno digital 0–13 on port D/B, the
   USART capture, the 200k-edge truncation), then `emit_arduino` (PWL continuation lines, the
   `firmware_truncated` warning). Re-run the single class with
   `python -m unittest tests.test_circuit_worker.Firmware -v`.

3. **Commit + push.** The shared checkout rule applies (CLAUDE.md Rule 0a): a private index on the
   branch tip, `hash-object` for every changed `circuit-lab/**` path, and the three shared ledgers
   (`marketplace.json`, `README.md`'s apps row, `audits/circuit-lab.json`) get ONLY the circuit-lab
   version hunk applied to the tip blob — never commit the working-tree ledgers, which lack rows
   other lanes committed from blobs. Push by SHA, then move the shared branch ref path by path.
   Run the store gates on an export of the tip (`scripts/check-catalog.mjs`,
   `scripts/security/check-store-test-discovery.mjs`, `check-store-security.mjs`,
   `scripts/check-store-separation.mjs`, `scripts/security/validate-package-audits.mjs`, the
   `security-ci-contract` and `package-audit` test files), never on the working tree.

## 5. Put it on a box

Announce in the core COLLABORATE thread first (one api restart), then:

1. Stage LF-exact from the commit and copy over the deployed tree (never the working tree):

   ```sh
   git -c core.autocrlf=false archive <sha> circuit-lab | docker exec -i oshal-local-api tar -x -C /tmp/stage
   docker exec oshal-local-api sh -c 'cp -a /tmp/stage/circuit-lab/. /app/workspace-shared/deployed-apps/circuit-lab/ && rm -rf /tmp/stage'
   ```

   then stamp `.oshal-install.json` (`sha`, `installedAt`, `version`) with node inside the api.
2. Rebuild and restart the engine container from inside the api — the worker and the image
   changed, and the api refuses an engine whose build hash differs:

   ```sh
   docker exec oshal-local-api sh /app/workspace-shared/deployed-apps/circuit-lab/engine/install-engine.sh
   ```

   Its self-test compiles and runs the blink sketch; a failure here is the same triage as §4.2.
3. Check no `pg_dump` is running in the api, then ONE `docker restart oshal-local-api`. Wait for
   `App loaded … circuit-lab 0.6.0` in its log; the Test Lab catalog must load (every `expected`
   line is under the loader's 500-character cap — the route suite proves it on the host).
4. Verify from inside the api: `GET /api/circuit-lab/capabilities` reports the engine connected
   with `firmware: true`; open the Arduino Blink starter and confirm `MCU1 (arduino) compiled`
   with D13 driven and the LED at 3–4 mA half the time; open the cockpit's floating assistant on
   the lab page and ask what is on screen — the answer names the open design and its parts
   (that is the `context` op arriving).
5. Post releases in both COLLABORATE threads, then land the core docs: the ADR-154 0.6.0
   addendum flips from "on the branch, not installed" to "as built", the ADR index row and the
   BACKLOG pointer follow (docs only, private index on the core tip, push by SHA).

## 6. Hazards this version taught

- The Test Lab loader refuses a WHOLE manifest for one `expected` line over 500 characters, and
  the app silently stays on its old row (0.5.1's lesson; guarded in `tests/routes.core.test.js`).
- The browser spec counts console errors: a shared asset answered with a 204 breaks a module
  import with a MIME error. The fixture serves the real core bridge client for that one path.
- `arduino-core-avr` 1.8.7 under avr-gcc 5.4 needs `-DDECIMAL_DIG=9`; there is no automatic
  prototype generation (declare a function above its first call).
- A PWL source with thousands of points needs continuation lines (`+`) and 12-digit times;
  `MAX_PWL_POINTS` caps it and the reading says `firmware_edges` when it was cut.
- The Bash tool's working directory leaks between parallel calls; every git command names its
  repo with `git -C`.

## 7. What stays open

BACKLOG B1 (the input half — a per-tick co-simulation through libngspice so a sketch can read a
button or a sensor), B3 (printed gear fit), B7 (convergence knobs), B8 (store-side execution of
the framework-coupled and real-solver suites), B9 (multi-bend wires), B12–B16 (the evaluated
external tools). Each carries its done-when in [BACKLOG.md](../BACKLOG.md).
