# Embodied Swarm

Drones are the eyes, a detached rolling six-axis arm is the hands, the swarm plans, you hold
command — and **the machine knows only what its sensors have seen.** This package is the
simulation environment for that machine. Everything in it is simulated and every view says so. It
exists so the controls and the integrations are built and proven before a motor turns
([ADR-151](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/151-eyes-and-hands-embodied-swarm.md),
[hardware design](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/architecture/embodied-mobile-manipulator-hardware.md)).

## The loop

1. **Explore.** The room starts entirely unknown. The base LiDAR sweeps, the drone scans from its
   pad, climbs, and flies frontier to frontier — only through space it has already seen free —
   scanning as it goes. Every ray carves free space into a 3-D occupancy map and marks what it hit;
   a 2.5-D height map rides on top so a 2 cm plate survives 5 cm voxels. **Drone first** sends the
   drone blind with the rover parked: its upward ranger clears the column it climbs through.
   The drone's pose is an *estimate*: it drifts in flight by a deterministic odometry model, and
   every sweep is registered against the map already built (point-to-plane, against the exact
   hit points the map kept) before it is integrated. A 10 cm error comes back under a millimetre;
   a registration that will not converge is "lost"; landing on the pad re-anchors it. A lost drone
   now **recovers on its own**: it climbs, runs a global search around its belief (every pose on a
   5 cm / 2° grid within 60 cm and 20°, scored by the wall returns that land in mapped voxels, spread
   evenly by direction; accepted only when the best pose stands clearly above the rest and refines to
   a converged, observable fit), failing that flies back along its registered trail to the pad, where
   the fix re-anchors it, and failing that too lands where it is and declares itself grounded. A
   registration also says when it could not measure a shift along one direction (one wall seen
   head-on) and leaves dead reckoning standing there. The 3-D view draws the believed pose, and the true one as a ghost when they
   differ (sim only). **Drone sensors** (header, applied on Reset world) chooses what the drone
   carries: the 3-D LiDAR we would buy, or the 2-D ring plus downward depth camera of the drone
   we print. The printed set flies in its own scan plane, holds altitude on a nadir ranger,
   registers in the plane against walls at any height, and explores by where its camera will learn
   the most; on this kitchen it sees 93 % of the column tops in 12 goals and finds every dish. Every
   flight guard keeps the fit's real hull (from the parts model) plus 5 cm from mapped voxels, the same
   hull the physics plant collides with.
   **Room** (header, applied on Reset world) picks the hidden scene the machine starts in: the
   kitchen, or a studio with a desk, a two-shelf unit and a bench — every scene is plain data and
   the discovery reads only the map, never the scene.
   **Truth model** (header, applied on Reset world) chooses what moves the drone's TRUE pose:
   the kinematic odometry drift model, or the **physics plant** — the package's MuJoCo engine
   container flies the printed drone's parts model (the MJCF is generated from it) toward the
   setpoint the autopilot ramps, under a seeded gust, with real contacts; its rays from the true
   pose are the sensor frames. The belief dead-reckons the commanded motion, holds a phase until
   the plant reports it has settled, and is corrected by the same registration; every guard, the
   map and the planners are unchanged. A drone-first exploration runs to done on MuJoCo. A **policy**
   trained in the engine container (hover, then one leg; PPO against the plant's own controller) may
   fly the plant only after its recorded flight has passed *this* world's guards — the certification
   gate — and then only through the same plan rails and confirm as everything else. The engine
   container is also a **node on the swarm rail** (ADR-099): it heartbeats into the package's
   `/api/embodied/nodes` mount under the swarm service secret exactly as the core drone and camera
   nodes do, and a world can run on it (the `rail node` truth model) — the plant then flies over the
   node's own command channel, every step an authenticated envelope, through the unchanged guards.
   A node belongs to one person (ADR-114): its heartbeats name the owner, and only that owner's
   worlds see it. A **PX4 flight stack** (the official SITL image, SIH physics) joins as that `drone`
   node — `install-engine.sh --with-px4` — flown over MAVLink in OFFBOARD, its own estimate the truth,
   the scene cast from that pose for rays and contacts, `clone` refused so the rehearsal runs on the
   kinematic twin (B6; a drone-first exploration ran to done on it in the sandbox). On a box whose
   app gate requires a person's identity for every package call (ADR-149 enforce) the api refuses a
   node's heartbeats today — a core decision recorded in BACKLOG B20; the dialled bridge still works.
2. **Discover.** From the map alone: a *surface* is a patch of columns at one height with clearance
   above it (the floor, counters, the sink basin, a shelf); an *object* is a bump standing on a
   surface, small enough to lift, its class guessed from its size only. Ids (`surf-N`, `obj-N`)
   stay stable across scans; you or the concierge can label them.
3. **Draft.** A clear-surface plan is drafted against discovered ids: standoffs are searched in the
   discovered grid, grasps are at mapped centroids, slots are free area on the discovered surface.
   The plan is rehearsed on a clone of the world before you see Execute.
4. **Execute.** You confirm; every kinetic step is re-validated live against the map. Unknown space
   blocks the base, the drone and the arm (except the machine's own bubble); a mapped voxel blocks
   the arm except the thing it is grasping or setting down; the tip budget must carry the load.
5. **Verify and re-draft.** The wrist camera looks before and after each grasp; the drone re-scans
   both surfaces at the end, and the plan fails if the map disagrees with its intent — for example
   an object the first survey missed. You draft again against the new map.

**The hands, designed the same way.** The arm is a parts model too (ADR-152 D1): a desk-class six-axis
arm on 12 V serial-bus servos, 0.415 m of reach and 0.15 kg of payload, sized by searching for each
joint's worst pose within its limits and giving it the simplest drive that holds it — one servo, two in
parallel, or a printed belt stage. `GET /build/arm` is the design, `design.md` is the document, each
part opens in CAD Studio, and `GET /physics/arm/mjcf` is the MuJoCo model generated from the same
numbers. **The design is checked against physics, not asserted:** `POST /physics/arm/check` has the
engine container hold the payload in each worst pose and run the taught pick-and-place, then reports
what it measured beside what the design expected (ADR-152 D5 task 3; a learned policy that must beat
that baseline is BACKLOG B21).

The machine's world is also the only thing the surface draws: a 3-D orbit view of the mapped
voxels, the discovered surfaces and objects, the rover with its arm model and the drone, plus the
simulated depth pictures from the drone and wrist cameras. The hidden scene is never shown.

Everything is **deterministic**: no model, no seed. Same room, same scans, same map, same plan. The
one inline concierge (`embodied-operator`) reads the discovered world, labels what is obvious, and
explains plans, rehearsals and refusals; it never moves a node.

Kept from earlier: **fetch from the fridge**, where the fridge door is a *taught fixture* (hinge,
handle, 60 N seal — the hardware design's tipping case). Its drives run on the discovered map and
the machine scans into the opening before reaching, but the door itself is declared, not discovered.

## Use it

Open the cockpit tile **Embodied Swarm** (`/cockpit/?app=embodied`).

- **Explore the room** (header button) drafts and executes the exploration after a confirm; tick
  **drone first (rover parked)** to send the drone alone.
- **Discovered world — 3-D**: drag to orbit, wheel to zoom. Mapped voxels by height, discovered
  surfaces (green) and objects (amber, with their guessed class), the rover and arm (blue/amber),
  the drone (purple), the last LiDAR sweep (white dots).
- **Pictures**: what the drone and wrist cameras see right now, rendered from the same rays the map
  integrates, watermarked SIMULATED.
- **Discovered surfaces & objects**: ids, heights, areas, guesses; type a label to name one.
- **Task**: *Explore*, *Clear a discovered surface* (from/to are discovered ids), or *Fetch from the
  fridge*. **Draft plan**, read the rehearsal verdict, **Execute** (confirm), **Abort**.
- **Manual control**: **Take command** first; scan with the base LiDAR, the wrist camera or the drone
  LiDAR; jog the base, lift, arm and gripper; **Recover** runs one global-search sweep for a drone that
  reports itself lost; every button goes through the same guards a plan does.
- **Command log**: every command by every actor with its outcome and refusal reason.
- **Physics engine** (header status): whether the engine container is reachable, with the install
  command when it is not. The kinematic truth model needs nothing; the physics one needs
  `engine/install-engine.sh` run once on the box (it builds the image locally and self-tests it).
  Beside it, the **rail**: which nodes have heartbeat in; every online node is a truth-model option,
  `rail node <id>`, applied on Reset world, and the node panel says which node flies the plant.
- **Policies**: the training reports the container wrote (both scores, the three-facet verdict),
  **Certify** replays a report's recorded flight through this world's fence and map guards — explore
  first, or it is refused as unknown space — and a certified policy appears in the controller
  selector next to the truth model; Reset world on physics with it, and the plant is flown by the
  policy through the same rails.
- **Build the drone**: the parts model behind the sim for either fit — layout, momentum-theory
  sizing at the summed mass budget, every printed part with its CAD Studio program, the bought
  parts. **Open in CAD Studio** turns a part into a real CAD model (STEP, STL, drawings) in the
  CAD Studio package; **design as markdown** is what the hardware design document pastes in.

## Package layout

| Path | What |
|---|---|
| `src-routes/engine/sense/` | ray/box casting, LiDAR sweeps, depth pictures |
| `src-routes/engine/world/` | voxel map + height map, discovery, the tracked world model, frontier exploration, the hidden scenes (`scene.ts` the shape and the kitchen, `scenes.ts` the registry, the studio and the validator), the 2-D grid |
| `src-routes/engine/{math,arm,base,drone,nodes,plan,control,sim}/` | kinematics, base and stability, drone, capability manifests, planners, executor, command authority, the simulation core |
| `src-routes/engine/design/` | the drone designer: propulsion sizing, airframe parts as CAD Studio programs, the parts model, the design tables |
| `src-routes/engine/design/{servos,arm-parts,arm-design,arm-markdown}.ts` | the arm we print: the servo class and its drive rules, the parts as CAD Studio programs, the sizing (worst-pose search, drives, budgets, the arm spec) and the design document |
| `src-routes/engine/medium/` | **the medium as a parameter (ADR-160 D7)**: `medium-properties.json` is ONE committed data row per medium — the values, with the foreign constant each came from — and `medium.ts` is the record, the three implementations (vacuum, air, seawater), the force-model declaration and the named refusals |
| `src-routes/engine/physics/hull-mjcf.ts` | the autonomous explorer's hull as ONE SOLID from the study's published envelope and all-up mass, dropped into a chosen medium: the analytic free fall, the MJCF the plant loads, and the flotation question refused by name |
| `src-routes/engine/physics/` | the physics lane's TypeScript half: MJCF from the parts model, the `PhysicsPlant` / `DroneNode` seam, the synchronous bridge client (a worker thread owns the socket, or POSTs command envelopes to a node on the rail) |
| `src-routes/engine/node/` | the node rail's api half: the fleet (nodes minted by heartbeat, liveness by staleness) and `RailDroneNode`, the sim's drone when a node on the rail flies it |
| `src-routes/embodied-node-routes.ts` | the `/api/embodied/nodes` mount (`auth: service`): heartbeat ingest and the machine listing |
| `engine/` | the physics engine container: `embodied_worker.py` (MuJoCo plant, cascaded controller, gust, ray sensors), `embodied_arm.py` (the printed arm's plant: inverse kinematics, the hold test, the taught pick-and-place), `tasks/reach_grasp.py` (task 3's baseline and environment), `container/` (the JSON-lines bridge, the node-rail front `embodied_engine_node.py`, the PX4 node `embodied_px4_node.py`, Dockerfile, compose), `tasks/` (the hover-and-leg Gymnasium task, PPO training and the PID baseline evaluation), `tests/` (pytest + the generated MJCF fixture), `install-engine.sh` |
| `routes/` | compiled JS the loader mounts |
| `tools/embodied.html`, `tools/embodied.js` | the cockpit surface (3-D view, pictures, world, tasks, manual control) |
| `migrations/001-embodied.sql` | two owner-RLS tables: `embodied_task`, `embodied_command_log` |
| `personas/embodied-operator.yaml` | the inline concierge |
| `tests/engine-*.test.js`, `tests/helpers.js` | dependency-free plain-node suites against the compiled engine |
| `tests/routes.core.test.js` | the routes over loopback HTTP (needs a framework checkout) |
| `tests/surface.core.spec.mjs`, `tests/surface.core.fixture.mjs`, `tests/routes.harness.js` | the tile in headless Chromium over the real routes on loopback (needs a framework checkout) |
| `tests/engine-physics.test.js`, `tests/fake-plant.js` | the physics lane without a container: MJCF = fixture, the plant seam on a plant double |
| `tests/engine-medium.test.js` | ADR-160 S1's guard: the real generators driven with each of the three media, the hull against the published study, the fall against h − g t²/2, each refusal raised by its own name, and an inventory of every medium-property literal left in package code |
| `engine/tests/test_hull_fall.py` | the same hull on the REAL MuJoCo plant: it falls at g and lands. Run on the box in `oshal-embodied-engine` (MuJoCo 3.3.5) — **3 cases, 3 passed**. It asserts a *discrete* trajectory: the fall is checked on `qvel`, which is `-g*t` exactly, while the bounds on `cvel` (one step stale, `g*dt`) and on height against `h - g t²/2` (leading it by `g*dt*t/2`) are derived from `model.opt.timestep` rather than chosen. The file drives its own three cases under `__main__`, because the engine image ships no pytest |
| `tests/engine-physics.live.test.js` | the simulation on the real MuJoCo plant behind a running engine bridge (`EMBODIED_ENGINE_ADDR`) |
| `tests/engine-node.test.js`, `tests/fake-node.js`, `tests/fake-node-worker.js` | the node rail without a container: the fleet, and a node double on loopback (a worker thread speaking exactly the Python front's rail) flown by the sim |
| `engine/tests/test_px4_node.py` | the PX4 node without a flight stack: the room frame from the vehicle at rest, the phase machine (takeoff arms and engages OFFBOARD, hover settles, LAND settles on the ground, a pose inside a solid is a contact, one vehicle only) against a link double, and the link itself over a real local UDP seam — one socket on a fixed port, the target system learned from the heartbeat, the setpoint on the wire commanding position and yaw; the real stack is proven by the sandbox recipe in the core runbook |
| `tests/engine-arm.test.js`, `engine/tests/test_arm.py` | the printed arm: the gravity torque a hand can check, the worst pose staying above the bench, every joint's drive, the parts against CAD Studio's contract, the model against its fixture — and in Python the plant itself: inverse kinematics that refuses a pose through the bench, a servo carrying what the design said, the taught pick-and-place placing the block, and the check's four verdicts |
| `tests/engine-node.live.test.js` | the real plant as a node: the Python bridge started as a node (`EMBODIED_PYTHON`) heartbeats into the real routes and the sim explores on it |
| `tests/test-lab.yaml` | the AI Test Lab catalog |
| `docs/ARCHITECTURE.md` | the contract — frames, sensing, mapping, discovery, primitives, guards, plan steps, what is not modelled |
| `BACKLOG.md` | deferred work with done-when criteria |

## Build and test

```bash
node C:/Projects/oshal/node_modules/typescript/bin/tsc -p embodied/src-routes/tsconfig.json && find embodied/routes -name '*.js.map' -delete
cd embodied && node --test "tests/engine-*.test.js"
OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js
OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/surface.core.spec.mjs
# the physics engine: its own tests, the bridge on loopback, the live suite against it
python -m venv .venv && .venv/Scripts/pip install -r engine/requirements.txt -c engine/requirements-lock.txt --extra-index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python -m pytest -q engine/tests/test_worker.py
# ADR-160 S1 on the REAL plant: the hull falls at g. NO pytest -- the engine image ships none, so the file
# drives its own three cases and exits non-zero on any failure. This is the run that proved it (3 passed,
# MuJoCo 3.3.5); stream the file and its fixture in, because docker cp cannot write to that container's tmpfs.
docker exec oshal-embodied-engine sh -c 'mkdir -p /tmp/s1/fixtures'
docker exec -i oshal-embodied-engine sh -c 'cat > /tmp/s1/fixtures/explorer-hull-air.xml' < engine/tests/fixtures/explorer-hull-air.xml
docker exec -i oshal-embodied-engine sh -c 'cat > /tmp/s1/test_hull_fall.py' < engine/tests/test_hull_fall.py
docker exec oshal-embodied-engine python /tmp/s1/test_hull_fall.py
.venv/Scripts/python engine/tests/test_hull_fall.py                # the same three cases in the venv above; mujoco is its only import
.venv/Scripts/python engine/container/embodied_engine_bridge.py --host 127.0.0.1 --port 7413 &
EMBODIED_ENGINE_ADDR=127.0.0.1:7413 node --test tests/engine-physics.live.test.js
EMBODIED_PYTHON=.venv/Scripts/python OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/engine-node.live.test.js   # the plant as a node on the rail
EMBODIED_RESIDUAL_SCALE=0.1 .venv/Scripts/python engine/tasks/train_hover.py --residual --timesteps 400000 --seed 0 --out ./reports   # a training experiment with a tighter residual bound
# the rail on the box's own api image, beside the stack: the sandbox recipe is in the core runbook docs/runbooks/embodied-tile.md
.venv/Scripts/python engine/tasks/train_hover.py --timesteps 80000 --seed 0 --out ./reports   # PPO vs the PID baseline → reports/hover-leg-seed0.json
# on the box: build and start the engine container beside the stack, self-tested
docker exec oshal-local-api sh /app/workspace-shared/deployed-apps/embodied/engine/install-engine.sh
```

## Routes (`/api/embodied`, OIDC)

| Method and path | What |
|---|---|
| `GET /app`, `GET /assets/embodied.js` | the surface |
| `GET /capabilities` | both nodes' validated capability manifests, tasks, sensors, limits |
| `GET /state` | the caller's machine snapshot + discovered world + control state (advances the world by wall-clock, ≤ 2 s per read) |
| `GET /world` | the discovered world: map statistics, surfaces, objects |
| `GET /world/voxels` | occupied voxel indices for the 3-D view |
| `GET /picture?sensor=drone\|rover\|wrist` | a simulated depth picture (RGB base64) from that camera, not integrated |
| `POST /scan {sensor}` | a manual sensor sweep while holding command; integrates into the map |
| `POST /world/label {id, label}` | name a discovered surface or object |
| `GET /camera` | the drone's detection frame (the scripted survey model) |
| `GET /build/drone?fit=recon-mini\|recon-3d` | the drone design: layout, sizing, printed parts with CAD programs, bought parts, mass budget, print rules (generated) |
| `GET /build/drone/parts/:id?fit=` | one part, with the exact body to `POST /api/cad-studio/models` |
| `GET /build/drone/design.md?fit=` | the design as markdown |
| `POST /world/reset {scenario?, sensorSet?, backend?, arm?, seed?}` | a fresh, unknown world in the named hidden scene (`kitchen` default, `studio`, or one of this owner's imported `scan:<scanId>` scenes; 400 `unknown_scenario` listing what this owner may choose; all of them in `/capabilities.scenarios`) with the chosen drone sensor set, `recon-3d` (default) or `recon-mini`, on the chosen truth model, `kinematic` (default) or `physics` with a gust seed (409 while a task executes; 400 for an unknown set or backend; 503 `physics_unavailable` with the install command when the engine container is down, stale or unreachable). `arm` chooses the ARM's truth model the same way (B22): `kinematic` (default) or `physics`, which stands the printed desk-6 arm up as a MuJoCo plant AT THE CARRIAGE POSE with the scene's own solids around it and gives the world the printed arm's kinematics, so the belief and the physics are the same machine — 422 `arm_mount_refused` when the base would stand outside the room or inside a solid, 400 `unknown_arm_backend`, and **501 `arm_node_unavailable`** for `arm:'node'`: an arm on the swarm rail is blocked by the core ADR-149 identity gate (see BACKLOG B20/B22), not by anything this package can change. |
| `POST /world/scenes/import-artifact {ref}` | **fly a scanned room** — the ADR-139 `accepts` destination for `application/vnd.oshal.embodied-scene+json`: redeems the handle through the kernel relay **as the caller**, holds the `{scene, stats, scanId, title}` envelope to the engine's bounds (span 1.5–20 m, ceiling 1.6–5 m, ≤ 400 m³, 1–2000 solids) and to `validateScene`, then registers it for this owner as scenario `scan:<scanId>` (201). Every refusal names the rule it broke — 415 `unsupported_type`, 400/422 `scene_refused` with `rule` and the issues — and registers nothing.
| `GET /physics/status` | the engine bridge's hello (engine, version, build hash) against the package's engine tree hash, the install command, the backends, the nodes on the rail (online, stale build, latest telemetry, last events) and whether the rail is configured |
| `POST /world/reset {backend: 'node', node: '<id>'}` | a physics world on a node that joined the rail — the plant (`embodied-plant`) or a vehicle (`embodied-px4`, kind `drone`: its own flight stack is the controller, `px4`) — (404 `unknown_node`; 503 `node_offline` after 15 s of silence; 503 `node_unavailable` with the reason when the node refuses the secret or its build is not this package's engine tree) |
| `POST /api/embodied/nodes/heartbeat` | **the rail** (its own mount, `auth: service`: the swarm service secret, a node identity, never a browser; the node's OWNER rides as the trusted service user sub, `X-Oshal-User-Sub-B64`, and only that person's worlds see or fly the node) — a node joins or refreshes: id, kind (`plant` accepts `load`; `drone` is one body), the endpoint the api dials back, protocol, engine, version, build hash, sessions, telemetry, events since the ack; answers the ack cursor (400 on a malformed body or a node that belongs to someone else) |
| `GET /api/embodied/nodes` | the fleet, for machines |
| `GET /physics/media` | **the medium as a parameter (ADR-160 D7)**: the three medium records this package implements (gravity vector, density, dynamic viscosity — kinematic is derived, never stored twice — speed of sound and temperature where the medium can answer and `null` where it cannot, its field, its free surface or none, the band it answers over and the provenance of every value), both force models with the properties they require and the media their authors declare them valid in, and the three named refusals |
| `GET /physics/hull?medium=&dropHeightM=` | **drop the explorer hull** as one solid built from the design study's published 300 mm envelope and 24.7 kg all-up mass: the medium that answered, the analytic free fall the plant reproduces, the MJCF it loads, what is not modelled, and the flotation question refused by name in the same answer. In **air** it falls at g. In **seawater** it is 422 `model_not_valid_in_medium: rigid-body-plant, seawater` — a refusal, never a plausible float, because nothing here models a free surface. Outside the medium's own band, 422 `medium_outside_validity`; a medium this package does not implement is 400 `unknown_medium` and is never substituted |
| `GET /physics/hull/mjcf?medium=&dropHeightM=` | the same scene as MuJoCo XML, with the chosen medium's gravity in its `<option>` and neither density nor viscosity — this plant makes no fluid claim |
| `GET /physics/mjcf?fit=` | the MuJoCo model generated from the parts model for a fit (what the container loads) |
| `GET /build/arm`, `GET /build/arm/design.md`, `GET /build/arm/parts/:partId` | the printed arm: its design (joints, drives, parts, budgets, the arm spec the sim flies), its document, and one part as a CAD Studio program (400 `unknown_fit`, 404 `unknown_part`) |
| `GET /physics/arm/mjcf?fit=` | the MuJoCo model of the arm, generated from the same design |
| `POST /physics/arm/check {fit?, seeds?}` | the container holds the payload in each joint's worst pose and runs the taught pick-and-place; the answer is what it measured beside what the design expected, with four verdicts (400 `bad_seeds` outside 1–5; 503 `physics_unavailable` with the install hint) |
| `GET /physics/reports` | the training reports the container's tasks wrote (PPO vs the PID baseline, the three-facet verdict), the policy files beside them, and this owner's certification verdict per report |
| `POST /physics/certify {file, which?}` | replay a report's recorded flight (`policy` default, or `baseline`) through this owner's fence and map guards; a passing policy is remembered for this owner (404 unknown report, 422 no path) |
| `POST /world/reset {..., controller: 'policy:<file>'}` | a physics world flown by a certified policy instead of the plant's controller (409 `policy_not_certified` otherwise; 400 on the kinematic backend) |
| `POST /tasks/draft` `{task:'explore', maxScans, droneFirst?}` · `{task:'clear-surface', from, to}` (discovered ids) · `{task:'fetch-from-appliance', appliance, object, to}` | plan + rehearsal → a task row (201; 422 when the planner refuses) |
| `GET /tasks`, `GET /tasks/:id` | the caller's tasks |
| `POST /tasks/:id/execute` `{confirm: true}` | fresh rehearsal on the live world, then run (428 without confirm; 409 when refused) |
| `POST /tasks/:id/abort` | stop the run |
| `POST /control/take`, `/release`, `/estop`, `/reset` | command authority |
| `POST /control/command` `{nodeId, command, params}` | a manual command while holding command (409 with the reason when refused; always logged) |
| `GET /log` | the caller's command log |

## What is real and what is not

Real: the sensing geometry, the map, the discovery, the drone's pose estimation and registration,
the kinematics, the stability budget, the guards, the plan shape, the command log, the rails, and —
on the physics truth model — rigid-body flight of the parts model's mass and estimated inertia,
a cascaded position and attitude controller, a seeded gust, contacts with the room; and — on the physics ARM — force-limited position servos whose measured angles (not their commands) are what every guard reads, the torque each servo exerts, and the arm's contacts with the room's solids. Not real: any
hardware; the sensors are exact (no noise); on the kinematic truth model the drone's drift is a
fixed bias per metre rather than a measured IMU and nothing has inertia; the rover's pose is exact;
the inertia is an estimate from where the parts sit (weigh and swing-test at assembly); the motor
curves are momentum theory until aero-lab's propeller work lands; the room is a hidden box scene the
rays bounce off; and on the physics arm the room has no free bodies — a grasped object still follows the tool in the simulation, so the physics carries the joints, not the object's own contact dynamics (BACKLOG B22). The world is in memory per signed-in
owner and resets on restart; tasks and the log persist. Read [BACKLOG.md](BACKLOG.md) for what the
first real node needs.
