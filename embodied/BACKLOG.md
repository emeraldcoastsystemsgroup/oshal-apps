# Embodied Swarm — backlog

Deferred work, each with done-when criteria. Nothing here is a hidden assumption in shipped code;
[docs/ARCHITECTURE.md §7](docs/ARCHITECTURE.md) lists what the simulation does not model.

## B1 — Swept-volume collision for arm motions — DONE 0.2.0

Every arm move interpolates the joint path at ≤ 0.1 rad with every link sampled every 5 cm;
proven by a move whose endpoints are clear and whose path crosses the island. Still a guard, not
a planner.

## B2 — Grasp geometry

**Today:** a grasp attaches any object within 5 cm of the tool; gripper width is set to the object's.
**Done when:** the grasp checks stroke against the discovered extent and approach direction and
refuses with a reason otherwise.

## B3 — More tasks — PARTLY DONE 0.3.0

**Today:** `explore`, `clear-surface` (discovered ids), `fetch-from-appliance` (taught door).
**Done when:** `fetch-object` (one discovered object to a discovered surface) and `tidy-floor`
(objects discovered on the floor back to a surface) ship with rehearsal tests.

## B4 — Scenarios — DONE 0.10.0

`engine/world/scenes`: a registry of named hidden scenes, each plain data in the `Scene` shape — the
kitchen and a studio (desk, two-shelf unit, bench) — with a validator (furniture inside the room,
surfaces over a solid, objects centred on their surface, standoffs and the pad clear of furniture).
`POST /world/reset {scenario}`, `/capabilities.scenarios`, the tile's Room selector. The studio is
explored drone-first to done on both sensor sets with no discovery code of its own; a scanner looking
down sees only the high shelf, the printed drone's camera sees under it — the map, not the scene.

## B5 — Real perception lane — PARTLY DONE 0.3.0

**Today:** simulated LiDAR sweeps and depth pictures from a hidden box scene feed the same map a
real sensor would.
**Done when:** `POST /scan` accepts an external sweep (`{origin, hits[], misses[]}` in the world
frame) or a depth image with a camera pose from a real node, integrates it through the same
`VoxelMap.integrateSweep`, and the Spaces scan import (ADR-111 `.ply`) can seed the map.

## B6 — The first real node — DONE 0.11.0 (a PX4 flight stack as the `drone` node), THE HARDWARE STILL OPEN

**Done (0.11.0):** `engine/container/embodied_px4_node.py` — a PX4 flight stack (the official
Dronecode SITL image `px4io/px4-sitl`, SIH physics, PX4 1.18.0) flown over MAVLink as a `drone`-kind
node on the rail the plant joins: `load` binds the scene to the one vehicle (for sensing and contacts
only), `step` streams the setpoint in OFFBOARD and reports the vehicle's own telemetry without sleeping
(a real body moves in wall time; the controller reads what it does now), `sense` casts the MuJoCo rays
from the reported pose, `clone` is refused (`cannot_clone` — the rehearsal runs on the kinematic twin),
`drop` lands. Phases map to PX4: takeoff = setpoint stream, OFFBOARD, arm; landing = LAND; landed =
disarmed. The pad frame comes from the vehicle at rest: its NED position at load is the pad and its
heading the room's +x. Installed with `install-engine.sh --with-px4` (compose profile `px4`,
`EMBODIED_PX4_ADDR`). **Proven end to end in the sandbox api on the platform's image (2026-09-14):**
`embodied-px4` online as kind `drone`, a world reset onto it, a drone-first exploration executed
through the api's own timer — PX4 logged `Armed by external command`, `Takeoff detected`, three
frontier scans with localisation tracking, the return above the pad, `Landing at current position`,
`Landing detected` — task done in 183 s, the belief within a few centimetres of the vehicle's own
estimate throughout.
**What the vehicle taught the seam, each with a test:** the image's entrypoint aims every MAVLink link
at `host.docker.internal` when that name resolves (Docker Desktop) — the compose service runs the px4
binary directly, the vehicle learns its partner from the first packet it hears, and the node sends and
receives on one socket bound to a fixed port (14540) so a restarted node process is still that partner;
stdin stays open or the pxh shell spins on EOF (80 MB of prompts in minutes). The setpoint's type mask
must leave yaw in use (bit 10 clear): with yaw ignored the vehicle kept its boot heading while the
belief yawed toward each leg, every sweep at altitude was placed 90° off and the map filled with
phantom walls. A sweep is expressed in the frame the plant reports *with* its frames (not a truth
snapshot taken before sensing) and hit points carry the pose's precision (5 decimals, not 4): a vehicle
resting a centimetre off its pad had its vertical ray placed beside the belief's voxel column and the
climb refused as unknown (`tests/engine-world.test.js`, `engine/tests/test_worker.py`,
`engine/tests/test_px4_node.py`). On touchdown the vehicle's own altitude read half a metre below the
pad for one step before PX4 reported landed; the landing completed.
**Still open:** on the box the rail is refused by the core ADR-149 gate (B20), so the PX4 node, like
the plant, is proven in the sandbox only; a hardware node behind the same envelopes with its own
link-loss failsafe, and the hardware e-stop chain proven on the bench first.

## B23 — Fly a scanned room: accept a Spaces scan as a scenario — DONE 0.13.0

The doorway is built. The manifest declares the ADR-139 `accepts` entry for
`application/vnd.oshal.embodied-scene+json` (`mode: post`, endpoint
`/api/embodied/world/scenes/import-artifact`), so the shared Send to… chip on any ready scan in
Spaces offers **Fly it in Embodied**. The endpoint redeems the `{ref}` through the kernel relay
**as the caller** (a handle minted for someone else is a 404 — it is never pulled in), refuses
anything but the scene MIME (415), and reads the `{scene, stats, scanId, title}` envelope through
`readSceneArtifact` (`engine/world/imported-scenes.ts`): the envelope, the `Scene` shape, then the
engine's own bounds — a span 1.5–20 m each way, a ceiling 1.6–5 m, a volume ≤ 400 m³ (what the 5 cm
`VoxelMap` and its clone hold) and 1–2000 solids — and finally `validateScene`. Every refusal is a
4xx carrying the **rule** it broke (`ref` / `type` / `malformed_json` / `envelope` / `scan_id` /
`scene_shape` / `extent` / `ceiling` / `volume` / `solids` / `scene_rules`) and the issues, and
nothing is registered on a refusal — there is no half-imported world. An accepted scene is kept
**per owner** under `scan:<scanId>` beside that owner's sessions as canonical JSON, so every reset
builds a fresh mutable scene exactly as a built-in scenario's `build()` does; `POST /world/reset
{scenario}` takes the id, `/capabilities.scenarios` lists it after the built-ins with its solid
count and room size, and the tile's **Room** selector is filled from that listing. The discovery
code is untouched — it reads the map, never the scene: a route test imports a hollow-shell fixture
capture, resets a world onto it and explores it to done.

**Watch for (unchanged):** a splat is a *surface*, so a scanned box is a hollow shell — solid faces,
empty interior. That is right for keep-out and wrong for anything that reasons about mass. Outdoor
captures need `scaleM` passed; the ceiling fit is for rooms, which is why the ceiling bound refuses
a capture that fits below 1.6 m rather than flying it.
## B21 — A learned grasp behind the same rails (ADR-152 D5 task 3's other half)

**Today (0.12.0):** the arm exists as a parts model, a MuJoCo model generated from it and a *taught*
pick-and-place that places a 30 mm block from seeded scenes 3 of 3 times, ~0.9 s an episode, with every
servo inside its continuous torque (`POST /physics/arm/check`). `ReachGraspEnv` (`engine/tasks/reach_grasp.py`)
is the Gymnasium environment beside it: 22 observations (joints, speeds, tool, block, the gap between
them, the jaw), 7 actions (six joint steps and the jaw), paid for closing, lifting and placing.
**Done when:** a policy trained in that environment places the block from unseen scenes at least as
often as the taught baseline and no slower, its report is reproducible in the container the way the
hover reports are, and it flies only behind the certification gate the drone policies pass (B19's rail,
`POST /physics/certify`), never around it.

## B22 — The arm on the rail, in the room — HALF (a) DONE 0.14.0; half (b) BLOCKED on core ADR-149

**Done (0.14.0), the plant in the room:** `WorldSim` takes an `armPlant` the way it takes a drone
plant. `armRoomMjcf(fit, solids, mount)` builds the SAME arm the sizing check measures — the body
chain, self-collision exclusions, force-limited actuators and the radian preamble are now shared
exports of `arm-mjcf.ts`, so the bench model and the room model cannot drift into two different arms
— standing at `sim.armMount()` (the carriage pose plus the lift) with the scene's own solids around
it through the shared `sceneGeoms`, and no bench plane or bench block. The `ArmPlant` seam
(`step(qTarget, grip, dt) → {q, torqueNm, grip, contact, settled}`, `clone`, `drop`) mirrors
`PhysicsPlant`; `RemoteArmPlant` speaks it over the existing bridge (`arm-load`, `arm-step`,
`arm-clone`, `arm-drop`, held as sessions beside the drone plants under the same lock and idle
sweep), and `RoomArmPlant` in `embodied_arm.py` is the container half. With a plant, the arm's joint
truth is the MEASUREMENT: a position servo settles short of its command by its load over its gain, so
`unit.q` is what the physics reported and the guards, the tool point and the tip budget all read it;
arrival is the plant's `settled` (inside tolerance AND stopped, not "the ramp finished"); a contact
with the room is one event; `unit.backend` says which body answered and `unit.servos` carries what
each servo exerted. A rehearsal clones the arm, and an arm that is one body returns no copy so the
rehearsal runs on the kinematic twin. `POST /world/reset {arm:'physics'}` stands it up, 422 on a
refused mount.
**Measured, not asserted (engine image `oshal-embodied-engine:local`, MuJoCo 3.3.5, 2026-09-14):** the
kitchen room model loads as 10 bodies / 47 geoms / 7 actuators at a 2 ms timestep; a shoulder
commanded to 1.6 rad settles at 1.595892 (4.1 mrad short) and the elbow 7.4 mrad short, carrying
0.479 and 0.432 N·m. The image was NOT rebuilt (the box was at load 14.87); the probe ran the repo's
engine tree on the existing image.
**The guard the probe bought:** the stock `SIM_ARM_6` is a DIFFERENT machine from the printed desk-6
(a 0.35 m upper arm against 0.16 m, ±2.2 rad shoulder against ±1.745). A belief computed from one
arm's link lengths over another arm's physics misses the tool point with no symptom at all, so a
plant carries the joint table its model was built from and `WorldSim` refuses a plant that is not its
arm before a single step; the route stands a physics world up on the printed arm's own spec.
**Not done, half (a):** the taught pick-and-place still runs as the container's own script
(`pick_and_place` in `embodied_arm.py`) on the bench, not as plan steps in the room. The room model
has no free bodies: a grasped object follows the tool in the simulation as it always has, and the
physics carries the joints, not the object's contact dynamics. Done when a scene object is a free
body in the room model, the grasp closes on it with friction, and `clear-surface` runs through the
unchanged rehearsal/confirm/tip-budget guards with the physics arm carrying it.
**Half (b) — a `drone`-kind arm NODE on the swarm rail — BLOCKED, and it is the operator's call:**
`POST /world/reset {arm:'node'}` is declared and answers **501 `arm_node_unavailable`** naming the
reason. On this box (ADR-149 enforce) core answers **401 `authorization_identity_required`** to an
`auth: service` node caller — with the secret alone and with the secret plus the trusted user-sub
header — so a package node in its own container cannot join, exactly as B20 records for the plant and
B6 for the PX4 vehicle. No package code can open that gate and none was written to try. It needs one
of: the core guard admitting a mounter-verified `service` caller as the owner it names, `auth:
service` mounts exempt from the per-app identity requirement, or the controller minting delegations
for enrolled nodes.

## B7 — Concierge tools for the world — PARTLY DONE 0.3.0

**Today:** read-only `embodied-world`, `embodied-label`, state, tasks, log.
**Done when:** the concierge can propose a draft as an approval-gated tool and the surface shows
the proposal with its rehearsal verdict before the person clicks Execute.

## B8 — A wider door swing

Unchanged: the taught door opens to 50°, the most the arm follows from its standoff.

## B9 — Discover the door

**Today:** the fridge door is a taught fixture.
**Done when:** a vertical panel discovered in the map with a handle-sized protrusion becomes a
`discovered door` with an estimated hinge line, and `fetch-from-appliance` can take a discovered
door id.

## B10 — Corner objects and a second look

**Today:** an object against a wall at the back of a basin can be missed by drone LiDAR from the
flight altitude; the plan's wrist survey finds most of these but not all; the final verification
then fails honestly and the person re-drafts.
**Done when:** the planner schedules a low, close look (wrist camera from two standoffs) over any
surface whose far edge is within 15 cm of a wall before drafting against it, and the perception
test includes a wall-adjacent object that is found.

## B12 — The rover's pose is an estimate too

**Today:** the drone dead-reckons and registers every sweep (0.4.0); the rover's pose is exact.
**Done when:** the rover has an odometry model (wheel slip, heading bias), its base LiDAR sweeps
register scan-to-map the same way, a lost rover refuses to drive, and the clear-surface loop still
lands the plates with both nodes estimating.

## B13 — Measured odometry, not a placeholder

**Today:** the drone's drift is a fixed bias per metre (2 % / 0.5 % / 0.5 % / 0.57°).
**Done when:** the model is fitted to a flight log from the drone actually bought (a random-walk
term and a bias term per axis), the sim's `DroneLimits.odometry` is loaded from that
characterisation, and the registration test reads its capture range from the fitted drift.

## B14 — Recover from lost — DONE 0.10.0

The executor splices a `drone.recover` step before a flight refused for a lost localisation (once
per step): climb to cruise, a **global search** around the belief (not a wider capture — measured, a
30 cm capture snaps to a wrong wall with 80 % of the points matched), then the registered trail back
to the pad, searching at each point; on the pad the fix re-anchors, anywhere else the drone lands and
declares itself grounded and the plan fails with that reason. Every position error up to 60 cm
recovers on both sensor sets; a yaw error beyond 20° is outside the window and takes the trail.
Building it exposed two registration truths now in the code: a fit reports when it could not measure
a shift along one direction and leaves dead reckoning there, and `coverage` is a statistic, not a gate
(a true pose in a half-mapped room leaves the unmapped part unmatched too). The manual **Recover**
button is one search sweep.

## B15 — The buildable sensor set: a single scan plane — DONE 0.5.0

`DroneSensorSet` (`recon-3d` | `recon-mini`) chosen on world reset. For the printed drone: the
ring flies in its own voxel layer at a voxel-centre altitude 20 cm under the ceiling (a ring cannot
see a fridge just under its plane); the body sits on a 3 cm pad plate on the ground; a nadir ranger
holds altitude every step against the discovered top under the drone (gated: only a top with known
free air above it, and only the candidate that moves the belief least); registration is planar
(x, y, yaw) against vertical-face anchors at any height, every ring point used, 100 matches enough;
a sweep with nothing to match is *dead-reckoned*, never lost; the height map comes from the depth
camera; exploration chases the columns the camera has not seen, choosing the goal by gain over
distance and never scanning twice from the same spot (a cabinet's shadow is unseen from above the
cabinet). Measured on the kitchen, drone first, one scan plane: **93.1 % of column tops seen in 13
goals and 15 registrations, the basin and three counters discovered, both plates within 2 cm and
the mug within 1 cm, home anchored with zero error** (re-measured at the fit's hull clearance in 0.7.1,
B18: 92.7 % in 12 goals and 14 registrations, the same surfaces and dishes, plates 1.0 / 2.0 cm, mug 0.0 cm). The 3-D set is unchanged. Eight defects the
single plane exposed in the shared code were fixed on the way (see the 0.5.0 commit).

## B16 — The drone designer: spec → parts → CAD — DONE 0.6.0

`engine/design/`: `propulsion` (momentum-theory sizing), `airframe` (each printed part as a CAD Studio
program — base plus ordered features in its contract and frame), `parts-model` (two fits, printed and
bought parts with masses and approximate prices, the mass budget summed from them, the sizing at that
mass, print rules; sensor poses from the same sensor set the sim flies), `design-markdown` (the
hardware document's tables). `GET /build/drone?fit=`, `/build/drone/parts/:id` (the body to post to
`/api/cad-studio/models`), `/build/drone/design.md`; the surface's **Build the drone** panel with
**Open in CAD Studio** per part. STL and STEP come from the real kernel, not from a mesh writer here;
that is the deliberate change from the original done-when. Inertias and motor curves stay open: the
parts model carries masses, and aero-lab's propeller curves will replace the figure of merit (B13).

## B17 — Physics and training lane (ADR-152) — PARTLY DONE 0.7.0

**Done (0.7.0):** the `embodied` engine container runs MuJoCo 3.3.5 + Gymnasium with MJCF generated
from the B16 parts model (`engine/physics/mjcf`, fixture-pinned); `WorldSim` takes a `PhysicsPlant`
(`kinematic` default | `physics`) chosen on `POST /world/reset`, and every guard, the map, the
registration and the planners run unchanged on both (the live suite runs a drone-first exploration
to done on MuJoCo; the plant double runs it without a container); the plant's sensor frames enter
the unchanged TypeScript map and registration; the first task (hover + one leg) trains with PPO and
is scored against the plant's own controller on seeded episodes with one report for both.
**Not done:** the frames travel over a package-owned synchronous TCP bridge (`embodied-engine:7413`),
not the swarm node rail a real drone will use — that is B20; a passing policy is not yet a provider
behind the confirm rail, and the kinematic sim does not yet certify a policy's flight — B19; the
trained PPO policy (80 000 steps, CPU) does not beat the PID baseline yet — also B19.

## B18 — One body radius for both truth models — DONE 0.7.1

`WorldSim.droneRadiusM` / `droneClearanceM` / `droneClearanceZM` come from the parts model of the fit
that carries the chosen sensor set (`fitForSensorSet`): hull half-width 0.178 m (printed) / 0.205 m
(3-D fit) plus a 5 cm margin laterally; the hull's height plus the sensor mast plus the margin
vertically (a quad is wide and flat — the first cut used the half-width for both and refused the
mission altitude 22.5 cm under the ceiling). The flight grid, `droneClear` and the kinematic strike
all read them; the physics hull is the same number. Re-measured (B15 note above); every suite passes
on both sets. `DRONE_BODY_RADIUS` and `DRONE_CLEARANCE_M` are gone.

## B19 — A learned policy behind the confirm rail — GATE AND CONTROLLER DONE 0.8.0, ONE SEED WINS (0.11.0), THREE STILL OPEN

**Done (0.8.0):** the certification gate (`certifyFlight`, `POST /physics/certify`: a report's recorded
flight replayed point by point through this owner's fence and map guards, unknown space refusing) and
the policy as the plant's flight controller behind it (`POST /world/reset {controller:'policy:<file>'}`,
409 until certified; inference in the container as decided in ADR-152 Q3; the setpoint ramp, belief,
map guards, `drone.goto`, rehearsal and confirm untouched). The form changed from the original
done-when: a hover-and-leg policy is a *controller*, so it flies the legs the rails give it rather
than proposing legs — proposing belongs to the exploration policy (ADR-152 D5.2, open). The verdict
has three facets (mean error, endpoints, crashes) and residual training exists.
**Still open — the win:** absolute PPO at 400 000 steps on two seeds wins the mean-error facet and
loses the endpoints (1.8–4.1 cm vs the controller's 0.6 cm). Tried 2026-09-13: residual PPO with the
correction bound cut to 0.10 (`EMBODIED_RESIDUAL_SCALE`, 400 000 steps, seeds 0–2, 858 s each) is worse
on every facet than the 0.25 bound — mean 0.126–0.152 m against 0.125 m, endpoints 0.6–5.9 cm — so a
tighter leash is not the recipe. Residual PPO at 200 000 steps on one seed: mean 0.119 m vs 0.125 m,
endpoints 0.8 / 1.0 cm vs 0.6 / 0.6 cm — closest so far, still not a win.
**The ctbr recipe (0.11.0) — the first seed that wins:** the SimpleFlight shape on this plant. The
policy commands collective thrust and body rates through the plant's own rate loop
(`Controller.rate_motors`; `--interface ctbr`), sees a reference look-ahead (10 points, 50 ms apart),
pays a smoothness penalty on its command changes, trains against thrust jitter, 8 environments,
1 000 000 steps (`train_hover.py --interface ctbr --envs 8 --timesteps 1000000`, about 10–13 min each
on this CPU). Against the controller evaluated in the same environment (mean 0.035 m, hold end 2.3 cm,
leg end 2.4 cm): seed 1 **beats it on every facet** — mean 0.026 m, hold end 0.9 cm, leg end 1.4 cm,
no crashes (`policyBeatsBaseline: true`, 694 s); seeds 0 and 2 win the endpoints (1.0–1.4 cm) and lose
the mean (0.067 m, 0.050 m). One seed of three; the done-when stands.
**Done when:** a training recipe (mode, budget, reward) gives `policyBeatsBaseline` true on three
seeds, recorded in reports the container can reproduce.

## B20 — The plant over the node rail — DONE 0.9.0 (the plant); the real body is B6

**Done (0.9.0):** the engine container joins the swarm as a node the way the core drone and camera
nodes do — heartbeats every two seconds into `/api/embodied/nodes/heartbeat` (an `auth: service`
mount: the swarm service secret, a node identity) with its id, kind, endpoint, hello, telemetry and
events; command envelopes `{id, command, args}` at `POST <endpoint>/api/drone-node/command` under the
same secret. `DroneNode` is the seam (`PhysicsPlant` + nodeId, link, endpoint); `RemotePlant` (the
container we dial) and `RailDroneNode` (a node that dialled us by heartbeat) are its two
implementations, and the sim flies either through the unchanged guards. The fleet mints nodes on
heartbeat and refuses one gone quiet; a node that is one body refuses `clone` and the rehearsal runs
on the kinematic twin. `POST /world/reset {backend:'node', node}`; the tile lists the fleet. Proven
without a container on a node double over a real socket (unit, routes, browser), and with the real
MuJoCo plant started as a node against the real routes (`tests/engine-node.live.test.js`).
A node belongs to one person (ADR-114): its heartbeats carry the owner as the trusted service user
sub (`EMBODIED_NODE_OWNER_SUB`), the fleet records the owner on first contact, and only that owner's
worlds see or fly it (another owner's node is 404 `unknown_node`).
**On the box (dev, ADR-149 enforce) the rail is refused by core, 2026-09-13:** the api mounts
`/api/embodied/nodes` under `auth: service` and the mounter's secret guard passes, but the core
application-authorization guard then answers **401 `authorization_identity_required`** — with the
secret alone, and with the secret plus the trusted user-sub header (`X-Oshal-User-Sub-B64`, the
owner). Its actor resolver (`src/app/middleware/application-authorization-identity.ts`, the
`delegated?.sub ?? getCaller(req).sub` line) admits only a browser/PAT session or a controller-minted
**workload delegation** (`x-oshal-delegation-token`, TTL 15–30 min, minted for bot-node dispatch), which
a package node in its own container cannot obtain. The drone and camera packages' node heartbeats sit
behind the same gate on an enforce box. This is a core decision, not a package fix: either the guard
admits a mounter-verified `service` caller as the owner it names, or `auth: service` mounts are exempt
from the per-app identity requirement (the secret is their gate), or the controller mints delegations
for enrolled nodes. Until then the container is reachable only over the dialled bridge (`physics
(MuJoCo)`); its node front runs, carries its owner, and logs the refusal once and then every 30th.
Proven on the platform's own image regardless: a sandbox api beside the stack (own database and
redis, mock identity, `legacy` mode; the recipe is in the core runbook `docs/runbooks/embodied-tile.md`)
acknowledged the container node, reset a world onto it and ran a drone-first exploration to done through
the api's own timer (2026-09-13).
**Done when (the box):** a heartbeat from the engine container is acknowledged by the api under
ADR-149 enforce and `GET /physics/status` lists `embodied-plant` online — after the core decision above.
**B6 (0.11.0):** a PX4 flight stack joins as that `drone` node (refusing `load` and `clone`), proven in
the same sandbox — see B6.

## B11 — Semantic labels from pictures

**Today:** classes are size guesses; labels are typed by a person or attached by the concierge
from geometry hints.
**Done when:** the concierge receives the simulated pictures as images and labels discovered
entities through `embodied-label`, with its guesses marked as guesses.

## B24 — Run the surface browser case in the Test Lab

The `surface-browser` Test Lab case is registered but stays pending with the reason
`Additional prerequisites require verification: harness:core-test-fixtures.` Its fixture imports
`isolated-browser.ts` from the framework checkout's `tests/fixtures/`, and the runner image ships no `tests/`
tree (checked 2026-09-14 in `oshal-local-api`: `ls /app/tests` — no such directory). Declaring only
`harness:oshal-core-root` would make the Lab run it straight into a module-not-found failure, so
the case names the missing capability instead.

It is not unguarded: `tests/surface.core.spec.mjs` runs in the manual framework-coupled gate
(`scripts/security/run-framework-coupled-tests.mjs`), green on 2026-09-14 (5 pass).

**Done when:** core's Test Lab runner image carries the shared browser fixtures behind a
probe-verified prerequisite (a core change that needs operator approval), this case declares that
prerequisite in place of `harness:core-test-fixtures`, and one Lab run of it passes on the box — a
real run of a few seconds, not a sub-second decline under load.

When it can run: the runner image's Chromium requests `/favicon.ico` and logs a 404 as a console error, so the fixture server must answer it (204), as animatronics' and circuit-lab's fixtures do - otherwise every "no page errors" assertion fails in the sandbox and passes on a host browser.

## B25 — Fly the explorer hull on the real plant, not just the prediction — DONE 0.16.0; ONE THING LEFT

**The hull has been flown.** `engine/tests/test_hull_fall.py` ran in `oshal-embodied-engine` on
2026-09-14 (MuJoCo 3.3.5, NumPy 2.3.3, Python 3.11.16): **3 cases, 3 passed, exit 0**. The file is
named in the `engine-plant-python` Test Lab case's `files` list, and its command is recorded in the
case's `expected` and in README "Build and test".

The first run is what the entry was for, and it found a defect — in the test, not in the plant. The
scene was right: `model.opt.gravity` is the air row's vector, the hull is one 300 mm / 24.7 kg solid,
and `qvel[2]` is `-g*t` to 7.2e-15. The *assertions* were written against the continuous solution and
had never been executed:

- `data.cvel[1][5]` trails the integrator's own velocity by exactly one update — a **constant**
  `g*dt` = 1.962e-2 m/s at the fixture's 2 ms step, identical at every sample and identical to
  `mj_objectVelocity`. The assertion allowed `abs_tol=5e-3`, so it could never have passed at this
  timestep. The index was right; the quantity and the bound were not.
- The discrete height **leads** `h - g t²/2` by exactly `g*dt*t/2` (measured 4.68918e-3 m at
  t = 0.478 s, against a predicted 4.689180e-3). Its `abs_tol=2e-3` cleared a quarter of the fall
  and would have failed at three quarters; it escaped notice only because the velocity assert fired
  first.

Both bounds are now derived from `model.opt.timestep` with the derivation written beside them, the
fall itself is asserted on `qvel` (no discretization error at all), and the landing assertion — on
the ground, not hovering, not through it — was reached for the first time and passes at 5.7e-5 m of
contact penetration. Mutation-proved on the real plant the same day: green at dt = 1, 2 and 5 ms, and
red on a gravity drift as small as 9.808 vs 9.81 (-0.02%), on a wrong release height, and on a floor
the hull cannot reach.

**What is left — the OTHER five Python suites have no runner in the shipped image.** The
`engine-plant-python` case still says the rest run under `python -m pytest -q engine/tests` in
`oshal-embodied-engine`, and that image has no pytest (`python -m pytest --version` ->
`No module named pytest`, checked 2026-09-14); `engine/requirements.txt` and `requirements-lock.txt`
do not pin one either. `test_hull_fall.py` is unaffected because it imports no pytest and carries its
own `__main__` runner, but `test_worker.py`, `test_hover_leg.py`, `test_node.py`, `test_px4_node.py`
and `test_arm.py` all `import pytest` and use its fixtures, so that registered command runs none of
them there.

**Done when:** those five suites have one command that actually executes them on a box — either a
pytest pin added to the engine requirements and image, or the same dependency-free runner shape — the
`engine-plant-python` case's `expected` names that command instead of one that cannot run, and a run
of it is recorded here with its pass count.

## B26 — The medium-property literals still in this package

ADR-160 S1 put the plant's gravity and the three media behind one committed data row
(`src-routes/engine/medium/medium-properties.json`). Four medium-property literals in package code
survived it, deliberately unfixed because they are outside S1 and touching them would have widened a
slice the ADR sized as small. They are PINNED, not hidden: `tests/engine-medium.test.js` holds them
as a named inventory and goes red the moment a fifth appears anywhere in `src-routes/`.

- `engine/base/stability.ts` — `export const G = 9.81`, the tip-budget model's own gravity.
- `engine/design/propulsion.ts` — `const G = 9.81`, and `airDensity: 1.225` in `DEFAULT_SIZING_ASSUMPTIONS`.
- `engine/physics/arm-mjcf.ts` — a literal `gravity="0 0 -9.81"` in `ARM_PREAMBLE`'s `<option>`: the
  arm's room generator is not fed from a medium the way `mjcf.ts` and `hull-mjcf.ts` now are.

The arm case is the one that matters, because it is a second MJCF generator writing a second answer
into a second scene. The other two are model inputs rather than scene parameters, and a momentum-theory
sizing that silently took seawater's density would be a worse bug than the duplication is — so each
should take a medium explicitly rather than simply read the row.

**Done when:** each of the three modules takes its gravity (and, for `propulsion.ts`, its density) from
a `Medium` passed in by its caller rather than from a file-local literal, `ARM_PREAMBLE` is generated
from that medium, the arm fixtures are regenerated, `KNOWN` in `tests/engine-medium.test.js` is empty,
and the arm suites stay green.
