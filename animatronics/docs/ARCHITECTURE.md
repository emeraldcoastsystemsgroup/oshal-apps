# Animatronics — architecture and contract

This is the contract the routes enforce, the surface reads and the director follows. Every
number here is asserted by a test named beside it.

## 1. The rig (`engine/rig-contract.ts`)

A **channel** is one servo output:

| field | meaning | default |
|---|---|---|
| `id` | kebab-case name (`eye-pan`) | — |
| `channel` | output number on the board (0…board outputs − 1) | — |
| `model` | servo catalog id (`sg90`) | — |
| `centerUs` | pulse at `neutralDeg` | 1500 |
| `usPerDeg` | microseconds per mechanism degree (1…40) | 10 |
| `reversed` | flips the direction | false |
| `neutralDeg` | rest angle, mechanism degrees | 0 |
| `minDeg`, `maxDeg` | **software limits**, mechanism degrees | −45, 45 |
| `minUs`, `maxUs` | **hard clamps** (400…2800) | 500, 2500 |
| `maxDegPerS` | the speed the rehearsal assumes (10…3000) | 400 |

`pulse(deg) = centerUs + (reversed ? −1 : 1) · (deg − neutralDeg) · usPerDeg`, rounded. A channel
is refused when the pulse at *either* software limit leaves the hard clamps — before any frame is
generated (`engine-contract.test.js`). Ids and outputs are unique; an output beyond the board is
refused.

A **mechanism** binds roles to channels: `eye-gimbal` (pan, tilt — both required), `eyelids`
(upper, lower, left, right), `neck` (yaw required; pitch, roll), `jaw` (open), `arm` and `custom`
(any role name). A channel belongs to at most one mechanism. The **axis key** is
`<mechanism>.<role>`; angles are mechanism degrees. Conventions: pan/yaw positive = the prop's
right, tilt/pitch positive = up, lids 0 = open, jaw 0 = closed.

**Supply** `{volts, amps, source: usb | bench | wall | battery}` — a USB source defaults to 5 V /
0.5 A. **Controller** `{board: pca9685 | pca9685-x2 | direct-pwm | serial-bus, transport:
web-serial | wifi-tcp, baud}`.

## 2. Poses and scenarios (`engine/scenario.ts`)

A **pose** maps axis keys to degrees within limits; ids are `^[A-Z][A-Z0-9_]{0,39}$`. Axes a pose
leaves out hold. A **scenario** is `{steps, description?}`:

| step | shape | meaning |
|---|---|---|
| move | `{kind:"move", pose? \| axes?, ms, ease?}` | to the pose (axes override it) over `ms` with `ease` (`linear`, `in`, `out`, `in-out` default, `snap`) |
| hold | `{kind:"hold", ms}` | wait |
| together | `{kind:"together", steps}` | children start at once; lasts as long as the longest; the same axis in two children is refused |
| run | `{kind:"run", scenario}` | inline another scenario (cycles refused) |
| repeat | `{kind:"repeat", times, steps}` | 1…100 times |

Caps: 400 steps, depth 8, 120 000 ms, 6000 frames, 200 poses, 200 scenarios.

Easing is cubic. **A cubic in-out peaks at three times the average speed**, `in` and `out` at
three times at one end, `linear` at one. A fast blink is commanded `linear`
(`engine-compile.test.js` proves every template scenario rehearses ok — the first BLINK, 80 ms
`in`, did not).

## 3. The compiler (`engine/compile.ts`)

Steps expand to per-axis eased **segments** on a time line (runs inlined, repeats unrolled,
`together` children overlapping), then sample at **50 Hz** (20 ms): mechanism degrees per channel
per frame, and the pulse each needs through the calibration. Channels bound to no mechanism sit
at neutral. Every target is re-checked against the software limits as it is placed. The result
is deterministic: same rig + library + steps + start pose → identical frames. `demandDegPerS` is
the peak commanded speed per channel — what the servo was *asked*.

## 4. The rehearsal (`engine/servo-sim.ts`)

Each channel tracks its command no faster than `maxDegPerS` (a hobby servo's *s per 60°* from the
catalog). Per channel: peak **lag**, **saturated frames**, whether it **settled** within 1° after
the last command change and how long that took, total travel. Verdict facets, all required:
`followed` (lag ≤ 5°), `settled`, no refusals. An SG90 (500°/s) asked for 30° in one frame lags
20°; over 400 ms it is fine (`engine-compile.test.js`).

**Not modelled:** load, inertia, stall, dead-band (BACKLOG B5). The rehearsal answers "can the
servo move that fast", not "can it move that load".

## 5. The supply budget (`engine/power.ts`)

From the catalog per channel: idle, moving, stall mA and the voltage range. **Idle** is the sum.
**Peak** is counted per frame — only the servos moving in that frame (Δ > 0.05°) draw moving
current, the rest idle — and reported with the frame and the channels. **Stall** is the
all-at-once worst case. Verdict: `refuse` when a USB source carries more than one servo, when a
servo is outside its voltage range, when a model is unknown, or when the peak exceeds the supply;
`warn` above 80 %; else `ok`. The stall worst case is a **note** (fuse the rail), not a refusal.
One MG996R moving on the seven-servo skull: 0.56 A (`engine-power.test.js`).

## 6. Look-at (`engine/look-at.ts`)

A bearing `{azDeg (±180, right +), elDeg (±90, up +)}` splits between the eye gimbal and the
neck: eyes take `eyeShare` (0.6) first, clamped to their limits; the neck takes the remainder,
clamped; the eyes then take what the neck could not; whatever is left is the **residual**,
reported and never clamped away. Steps: a `together` of the eyes (120 ms) and the neck (350 ms).
60° / −20° on the six-servo face → eyes.pan 30, eyes.tilt −12, neck.yaw 30, neck.pitch −8,
residual 0; 100° leaves 25° (`engine-lookat.test.js`).

## 7. The controller protocol (`engine/protocol.ts`)

See [CONTROLLER-PROTOCOL.md](CONTROLLER-PROTOCOL.md). The browser loads the same compiled module
at `/assets/protocol.js` (the route wraps `routes/engine/protocol.js` as
`window.AnimatronicsProtocol`), so encoder and parser exist once (`routes.core.test.js` evaluates
the served module in a sandbox).

## 8. The authority rail (`rig-routes.ts`)

| step | route | gate | effect |
|---|---|---|---|
| draft | `POST /rigs`, `PATCH /rigs/:id`, `PUT/DELETE …/poses/:id`, `PUT/DELETE …/scenarios/:id` | owner | libraries validated against the rig; a rig change **disarms** and resets the believed pose to neutral |
| rehearse | `POST /rigs/:id/rehearse`, `POST /rigs/:id/look-at {rehearse:true}` | owner | compile + sim + budget from the believed pose (or `start`); report, frames, lines; logged; **nothing moves** |
| arm | `POST /rigs/:id/arm {confirm:true}` | 428 without confirm; 422 `supply_refused` | armed, believed pose neutral, answers hello + clamps + neutral frame |
| play / look-at / jog | `POST /rigs/:id/play \| look-at \| jog` | 409 `rig_not_armed`; 422 `<kind>_refused` on a refused budget | re-rehearsed from the believed pose; believed pose advances to the end; lines answered |
| disarm | `POST /rigs/:id/disarm` | always | armed false; answers `E*45`; the e-stop |

The server believes the pose it last commanded (`current_pose`); the next stream starts there.
Every step writes a row in `animatronic_run` (kind, scenario, report, frames) — the command log
ADR-151 D4 asks for. The concierge has tools for every draft and rehearse route and **none** for
arm, play or jog.

## 9. The surface (`tools/`)

`animatronics.html` + `animatronics.js` (behaviour), `animatronics-view.js` (a pure `layout()` and
an SVG `render()`), `animatronics-serial.js` (the Web Serial link; every browser object a
parameter, so `surface-serial.test.js` runs it under node against a fake port). The page never
composes a pulse: arm sends the server's bring-up lines; play, look-at and jog stream the server's
frame lines paced at the frame period while the drawing follows the *rehearsed* angles; E-STOP
sends `E` first and disarms after; a lost link, a rig change or a closed page disarm. Web Serial
needs a Chromium desktop browser; the cockpit iframe is same-origin, so the default `serial`
allowlist admits it (the same reasoning as Scan to Print's camera).

## 10. The `prop` kind (`engine/kind.ts`)

`{kind:'prop', senses:[channel-state, controller-hello, supply], acts:[pose, scenario, look-at,
jog, arm, disarm, e-stop], minSafetyClass:1}`; class 2 once any servo's stall torque reaches
10 kg·cm; `e-stop` and `disarm` confirm-exempt. `GET /rigs/:id/manifest` answers the ADR-151 D1
manifest. The row is **embodied's** (ADR-156 D6 folded in at 0.2.0): `KIND_VOCABULARY.prop` is
decided there, `GET /capabilities` names the owner, and since 0.2.1 `loadPropVocabulary()` READS
the row out of embodied's compiled `routes/engine/nodes/capability-manifest.js` beside this package
instead of holding a copy. The read is fail-closed: no embodied, no `prop` row, no
`CONFIRM_EXEMPT_ACTS`, or a module that throws each yields no vocabulary and a null manifest (503
on the manifest route), never a locally invented row. `engine-kind.test.js` proves it against a
fixture embodied whose row differs — while still pinning the refusal of a prop as a rail node.

## 11. Storage (`migrations/001-animatronics.sql`)

`animatronic_rig` (rig, poses, scenarios, armed, armed_at, current_pose, run_count, last_report,
source) and `animatronic_run` (the command log), both owner-RLS with the store policy. Nothing on
disk; frames are answered, not stored.

## 12. What is deliberately not modelled

- Servo dynamics: load, inertia, stall, dead-band (B5). The rehearsal is rate-limited tracking.
- Linkage geometry and collisions between mechanisms; the eye view is a drawing, not a model.
- Sound, lip-sync, an audio envelope on the jaw (B6).
- A bus servo's position / load readback (B7); Wi-Fi transport (B8); tracking from a camera (B3).
- The firmware is reference source, not bench-proven (B2).
