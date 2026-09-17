# Animatronics — backlog

Each entry has done-when criteria. Nothing here is built; the README and ARCHITECTURE describe
only what is.

## B1 — The actual page in a browser — DONE 0.1.0

`tests/surface.core.spec.mjs` drives the packaged page in headless Chromium over the compiled
routes with a fake Web Serial port that answers like the reference firmware: a skull rig from the
template, a jog that moves the pupil, a captured pose, BLINK rehearsed to an ok verdict, connect,
arm (hello + seven clamps + the neutral frame written), TALK played (66 frame lines written),
E-STOP (`E*45` last, the rig disarmed on the server), zero page errors. It found two defects on
its first run (a stale animation reading replaced frames; the log not refreshing after Play).

Still open, done when: the look-at pad, the calibration table save (a rig change disarms) and the
scenario JSON editor each have a browser case, and one case runs with a real serial device
(B2's bench).

## B2 — Bench proof of the firmware

`firmware/esp32-pca9685/animatronics_controller.ino` is reference source: not compiled or
bench-run in the session that wrote it. The protocol it implements is proven by the Node
encoder / parser tests.

Done when: the sketch compiles under arduino-cli for an ESP32 DevKit, flashes, answers `H*48`
with the hello reply, refuses a bad checksum, applies a template scenario played from the page
with a scope on one output showing the pulse train (50 Hz, the expected widths), latches on `E`
and releases on `R`, and goes outputs-off after 3 s of silence. Then a Test Lab case with the
prerequisite `hardware:esp32-pca9685` is registered.

## B3 — Tracking: LOOK_AT from a camera

Look-at takes a bearing. Nothing produces one from an image.

Done when: the page (or a node) turns a detected face into a bearing in the prop's forward frame
— a pinned local detector the way Portrait Studio bundles its cascade, or the camera package's
frames — at a few Hz, with a dead-band and a rate limit so the prop does not chatter, and a
browser case proves a moving target moves the pupils then the neck.

## B4 — Fold `prop` into embodied's vocabulary — DONE (0.2.1, embodied 0.15.0)

`KIND_VOCABULARY.prop` lives in embodied's capability manifest with the agreed senses, acts and a
class-1 floor, and `disarm` joined its confirm-exempt set. `engine/kind.ts` no longer decides the
row and no longer copies it either: `loadPropVocabulary()` resolves embodied's compiled
`routes/engine/nodes/capability-manifest.js` beside this package and reads `KIND_VOCABULARY.prop`
and `CONFIRM_EXEMPT_ACTS` out of it, so one vocabulary is written down in one place. 0.2.0 kept a
frozen copy instead, on the argument that packages install one at a time into `deployed-apps/` and
a sibling `require` would take this package down with MODULE_NOT_FOUND wherever embodied is absent;
the guarded read answers that without a second declaration — no embodied means no vocabulary and no
capability manifest (503 on `GET /rigs/:id/manifest`, naming the owner), while the rig, the poses,
the rehearsal, the supply budget and the Web Serial stream are untouched. `engine-kind.test.js`
points the package at a fixture packages root whose embodied declares a different row and requires
its vocabulary and a real rig's manifest to change with it, pins the four unhappy shapes as
refusals with nothing invented in their place, and proves embodied's own `validateManifest` ACCEPTS
the skull rig's manifest unchanged. Still out of scope and still pinned as refused: a prop as a node
on the swarm rail, gated on the ADR-149 decision.

## B5 — Dynamics on the rehearsal

The servo sim is rate-limited tracking. Load, inertia, stall and a hobby servo's dead-band are not
modelled, so a heavy jaw on a small servo rehearses fine and stalls on the bench.

Done when: a channel carries an optional load (inertia, gravity torque at an angle) and the
rehearsal uses the servo's stall torque and speed-torque line to slow or stall it, with a case
that shows the skull's jaw on an SG90 refused and on an MG996R accepted, and Circuit Lab's servo
model (its `servo` part) named as the electrical companion.

## B6 — Sound and TALK from an envelope

`TALK` is a fixed chatter. Pumpkin lip-syncs speech in the browser.

Done when: a scenario step `talk {envelopeHz, envelope[]}` maps an amplitude envelope onto the
jaw axis within its limits, the page can compute the envelope from an audio file with WebAudio,
and a Pumpkin `speak` step can trigger a TALK on the prop (a cross-package browser hand-off,
never a server-to-server call).

## B7 — Bus servos as bus servos

A Feetech / Dynamixel-class servo is in the catalog as a pulse-equivalent so the same angle math
applies; the protocol speaks pulses.

Done when: the `serial-bus` controller board carries a second frame form (`P <seq> id=pos,…`) the
firmware turns into bus position words, the reference sketch gains a `serial-bus` variant, and a
rig on that board reads position / load / temperature back as `channel-state` senses.

## B8 — Wi-Fi transport

The page speaks Web Serial only.

Done when: an ESP32 running the sketch over Wi-Fi accepts the same lines on a TCP port and the
page (or a Pi-class node on the swarm rail, per embodied B6/B20) streams to it, with the
controller's hello carrying the transport.
