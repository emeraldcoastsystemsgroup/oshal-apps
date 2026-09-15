# Embodied Swarm — the contract

This is the as-built description of the simulation environment. It is the reference the first
real node is built against: a hardware node that satisfies the same primitives and guards slots
in behind the same routes. The governing rule since 0.3.0: **the machine's guards and plans read
only the world it has mapped; the hidden scene answers sensor rays and physics, nothing else.**

## 1. Frames and units

- **World frame:** metres, X east, Y north, Z up, origin at the room's south-west floor corner.
  Headings are radians counter-clockwise from +X.
- **Base frame:** origin at the floor centre of the base footprint, x forward, y left, z up.
- **Arm base frame:** the base frame translated 0.20 m forward and up by the lift height.
- **Tool frame:** standard DH tool frame; "tool down" is roll π, "tool level" is roll −π/2 (the tool
  z then points along (−sin yaw, cos yaw)); rolling toward level from −π/2 tilts the tool up.
- **Camera frame:** OpenCV (z forward, x right, y down). The wrist camera sits at the tool and
  looks along the tool axis; the drone camera hangs under the drone with a gimbal pitch.
- **Map:** 5 cm voxels over the room, states UNKNOWN / FREE / OCCUPIED, plus one height per
  column (the highest downward-ray hit at or below 1.6 m).

## 1b. Scenarios (`engine/world/scenes`)

A world starts from a named hidden scene: `kitchen` (5 × 4 m, the counter run, the sink, the rack,
the island, the fridge with its taught door) or `studio` (4.5 × 3.5 m, a desk along the east wall,
a two-shelf unit, a bench at counter height, no door). Every scene is plain data in the `Scene`
shape; `validateScene` refuses one whose furniture leaves the room, whose surfaces have no solid
under them, whose objects do not rest centred on their surface, or whose standoffs, pad or park sit
inside furniture. `POST /world/reset {scenario}` picks one; `/capabilities.scenarios` lists them.
The discovery, the planners and every guard read the map, never the scene: nothing changes per scene.

## 2. Sensing (`engine/sense/raycast`)

| Sensor | Pattern | What it returns |
|---|---|---|
| Drone LiDAR | 240 azimuths × 64 elevation rings, −90° to +60°, 8 m, on a mast 8 cm above the body | hits (point, what was hit, the face normal) and misses (range points) |
| Drone upward ranger | one ray at the zenith plus eight within 10° of it, 4 m | same — it is what clears the column the drone climbs through |
| Base LiDAR | the ring pattern from 0.35 m at the machine's front | same |
| Wrist / drone / base camera | one ray per 4th pixel of a 640×480 pinhole (160×120), 2.5 m / 6 m | a depth picture: range, hit name and a flat colour per pixel shaded by range, plus the rays as a sweep |

Solids a ray can hit: the scene's fixed obstacles, appliance doors at their current swing, every
object not in the gripper, the floor, four walls and the ceiling. The machine and the drone are
never sensed. A hit is recorded 2 mm inside the face it struck so vertical faces never paint the
air column in front of them; the map extends one voxel beyond the room so the walls, floor and
ceiling are mapped solids and registration anchors, not the edge of the world.

## 2b. The drone's pose is an estimate (`engine/drone/quad-model`, `engine/sense/register`)

- **Belief and truth.** `sim.drone` is the pose the drone BELIEVES — its autopilot flies that onto
  every target and every guard reads it. `sim.truth` is where it really is: sensors cast from
  there, the hidden scene is struck there, nothing else reads it. On the pad they are equal.
- **Dead reckoning.** In flight the truth drifts from the belief by a deterministic odometry model
  per metre flown in the body frame: 2 % along track, 0.5 % sideways, 0.5 % vertical, 0.57° of
  heading. No randomness — a rehearsal drifts exactly as the live run will.
- **Scan-to-map registration.** Every drone sweep is measured in the sensor's own frame and, before
  it is integrated, registered against the map already built: each pass matches the sweep's points
  to the nearest map anchor (the exact first hit per occupied voxel, with its face normal) and solves
  the small z-rotation and translation that zero the point-to-plane residuals; ten passes with the
  match radius shrinking from 12 to 3 cm. Capture range is 12 cm. Measured: a 4.6 cm climb drift
  corrects to under 0.1 mm, a 10 cm / 2° injected error to under 1 mm.
- **Anchored, tracking, lost.** On the pad with an empty map the pose is anchored by definition.
  A converged registration is tracking. Too few matches (< 300), an unobservable direction (only
  floor and ceiling in view) or a pose that will not settle under 2 mm is LOST: the belief is left
  alone and flight is refused until the drone lands and re-anchors.
- **The pad fix.** Landing within 30 cm (true) of the pad reads its fiducial: the belief snaps to
  the truth. Landing elsewhere keeps whatever the last registration left.
- **Strikes are real.** The true drone inside a hidden solid (body radius 10 cm, above the minimum
  flying height) puts the drone DOWN: the executor fails the plan, every drone command is refused,
  the event names the true and the believed position. Odometry that lies by a third reaches this.
- **Pictures.** Camera images form at the true pose; detections are back-projected with the
  believed camera. That is why every scripted vantage scans (registers) before it observes.
- **Never outrun the capture range.** The executor flies any `drone.goto` longer than 2 m in
  sub-legs with a registration sweep between them, registers after every climb unless the plan
  sweeps next anyway, and registers during exploration once its legs have flown 2 m. These sweeps
  are logged as `drone.register` commands; they are not plan steps.
- **Flight clearance.** In flight the drone keeps 15 cm (its 10 cm body plus drift margin) from
  every mapped voxel, horizontally and vertically, and does not pass beside air it has never seen
  within 10 cm at its own altitude; the flight grid is built to the same rule, so a planned leg is
  a legal leg. Takeoff checks only the column the upward ranger cleared.
- The rover's pose stays exact (§7).

- **What a registration will not claim.** A settled fit reports `coverage` (the final pass's
  matches over the sweep's usable returns) as a statistic, never as a gate: in a half-mapped room a
  true pose leaves the unmapped part unmatched too. It does report `observable`: when the matched
  face normals span one direction only (a single wall seen head-on, the weak-direction weight under
  40 returns) the shift along `weakAxisRad` was not measured, that component of the correction is
  dropped and dead reckoning stands there — the belief is never pulled sideways by a fit that could
  not see sideways. A dead-reckoned sweep is still integrated at the belief; a lost one never is.
- **Recovery (B14).** A drone that reports itself lost is not re-registered by a wider capture — a
  30 cm capture in this kitchen snaps to a wrong wall with 80 % of the points matched, indistinguishable
  from a fit. It runs a **global search** instead (`relocalize`): every pose on a 5 cm / 2° grid within
  60 cm and 20° of the belief is scored by the fraction of wall returns (spread evenly by direction, so
  a dense camera view of one face cannot outvote the ring) whose point 2 cm inside the struck face lies
  in an occupied voxel of the map; the best pose is refined by the usual registration and accepted only
  when it scores at least 50 %, stands above every pose more than two cells away by a factor 0.85,
  refines to a converged and observable fit, and stays inside the window. Measured: every position
  error up to 60 cm on both sensor sets recovers to under 2 cm (3-D) / 5 cm (single ring); a yaw error
  of 34° is outside the window and stays lost — a sweep is not a fiducial. The executor then flies the
  **registered trail** back (the believed positions of every converged registration, in reverse, then
  the column above the pad), searching at each point, and lands: on the pad the fix re-anchors the
  belief; anywhere else the drone declares itself **grounded** and the plan fails with that reason.

## 2c. Sensor sets — the drone we would buy and the drone we print (`engine/drone/sensor-set`)

The drone carries one of two sets, chosen on world reset (`POST /world/reset {sensorSet}`):

| | `recon-3d` (default) | `recon-mini` (the printed drone) |
|---|---|---|
| Sensing | 64-ring LiDAR on an 8 cm mast + zenith ranger | 2-D ring (450 points, 12 m) in the flight plane + downward ToF depth camera (70° × 50°, 4 m) + zenith and nadir rangers |
| Altitude | mission altitude 1.925 m; z from full registration | mission altitude 2.075 m (a ring cannot see a fridge just under its plane); a nadir ranger holds altitude every step: the reading plus the discovered top under the drone, taking only a top with known free air above it and only the candidate that moves the belief least |
| Registration | full: x, y, z, yaw | planar: x, y, yaw against vertical-face anchors at any height (a wall seen from the pad is the wall seen at altitude); every ring point used; 100 matches enough; floor and top returns skipped |
| No overlap | dead-reckoned | dead-reckoned (the first sweep at a new altitude); *lost* only on a contradiction |
| Exploration | frontier of unknown air in the flight layer | columns whose top the camera has not seen, chosen by gain (unseen columns under the footprint) over distance, never twice from the same spot |
| Ground | mast 8 cm | body on a 3 cm pad plate; the sensors ride up with it |

Both sets fly at a voxel-centre altitude: 1.9 m sat exactly on a layer boundary and the guards read a
different layer than the sweeps carved. A ray's "air voxel" is found by stepping 2 mm out of the
struck face, not by flooring the hit point (a face on a voxel boundary floored into the solid).
Registration matches need normal agreement (query · anchor ≥ 0.7). A drone that finds itself inside
a clearance violation because the map grew under it may back out 30 cm. Every `drone.goto` is routed
through the flight grid before it is flown, and exploration keeps a 10 cm drift buffer inside the
fence.

## 3. The map and discovery (`engine/world/{voxel-map,discover,world-model,explore}`)

- **Integration.** Each ray carves FREE along its length (Amanatides–Woo), sets the hit voxel
  OCCUPIED, frees the voxel it stopped in unless already occupied, and — for downward rays — raises
  the column's height. A miss frees out to its range. Rays never read the scene.
- **Height field.** Per column: the top with clearance (the voxel above not occupied, free space
  seen within three voxels), holes filled from agreeing neighbours only (a plate/basin edge is a
  real edge and stays unfilled).
- **Surfaces.** 4-connected patches whose tops agree within 3 cm, area ≥ 0.06 m²; the plane height
  is the lowest 1 cm level holding ≥ 15 % of the patch (dishes raise columns, never lower them).
  Small non-surface patches attach to the neighbouring surface whose plane is nearest below them.
- **Objects.** 8-connected bump patches ≥ 1.2 cm above their surface's plane, ≥ 3 columns, ≥ 2
  columns wide, ≤ 0.45 m extent, ≤ 0.4 m tall; class guessed from extent and height.
- **Tracking.** Surfaces match by height ± 1.5 voxels and ≥ 30 % overlap; objects by centroid
  within 8 cm. Ids are first-seen order and never reused. An object whose box reads mostly FREE is
  dropped (moved or lifted). `lift(id)` frees an object's voxels when the gripper takes it;
  `markBox` records what the machine set down (a later scan confirms it).
- **Derived grids.** `navGrid`: a column is blocked when any voxel in the machine's height band is
  OCCUPIED or too little of the band is known free, inflated by the base half-width + margin.
  `flightGrid(alt)`: the voxel at the altitude is FREE and nothing occupied within ±15 cm.
- **Exploration.** A frontier is a flyable cell next to an unknown one at the flight altitude;
  the next goal is the nearest reachable frontier (breadth-first through flyable cells, outside
  the wall margin), pulled back three cells into known space; the drone flies the simplified path
  leg by leg, scans, repeats until no frontier remains or the scan budget is spent.

## 4. The guarded primitives (`engine/sim/world-sim`) — what any real node must also refuse

| Primitive | Refuses when |
|---|---|
| `driveTo(goal)` | e-stop latched; goal cell blocked in the discovered grid (unknown counts as blocked); straight leg crosses a blocked cell; speed for the lift state fails the energy rule |
| `jog(v, w, s)` | as above for the predicted end point; ≤ 2 s; speed clamped by lift state |
| `setLift(z)` | e-stop; clamps to travel |
| `moveArmToWorldPose(pose, F, contact)` | unreachable; every IK branch either passes a link (sampled every 5 cm) through a mapped voxel or through unknown space beyond 0.45 m of the arm base, or sweeps through one on the joint path; the tip budget fails the wrench check. Voxels within `contact` of the target pose are exempt — that is the thing being grasped or set down. A held door's panel is exempt while held |
| `moveArmJoints(q)` | e-stop; wrong count; configuration or sweep collides |
| `grasp()` | already holding; no unheld object within 5 cm of the tool. On success the nearest mapped object within 12 cm is lifted out of the world |
| `release()` | never; rests on the highest solid top under the tool within 35 cm (declared or not) or drops to the floor (warn); the placed box is marked in the map |
| `graspHandle(id)` / `releaseHandle()` | as before; while held, the door follows the tool and its panel is re-rasterised in the map at every angle change |
| `droneTakeoff()` | the column above is not known clear; the drone is down |
| `droneGoto(p)` | any 5 cm sample of the straight path is unknown, occupied, or has something occupied within 5 cm sideways / 15 cm vertically; or leaves the room margin; localisation lost (a recovery leg may fly while lost — the map guard still applies); the drone is on the ground; the drone is down |
| `droneLand()` | a mapped obstacle below (abort/e-stop land regardless) |
| `scanDrone()` | the drone is down. Otherwise never: it registers the sweep against the map (§2b), then integrates it and refreshes discovery; `scanDrone({wide: true})` runs the global search of §2b instead of the capture-bounded fit (the manual **Recover** command) |
| `scanRover()` / `scanWrist()` | never; they integrate into the map and refresh discovery |

## 5. Plan steps (`engine/plan`)

`drone.takeoff` · `drone.goto` · `drone.scan` · `drone.explore {maxScans}` · `drone.recover` (never
planned; the executor splices it in before a flight refused for a lost localisation, once per step:
climb, global search, the registered trail back, the pad — then the refused step is issued again) ·
`drone.observe` (the
scripted projection detector) · `drone.land` · `rover.scan` · `wrist.scan` · `base.drive {legs}` ·
`base.lift` · `arm.move {target, expectedForceN, contactRadius?}` · `arm.joints` · `arm.grasp`
(`objectId: '*'` = whatever is under the tool) · `arm.release` (`surfaceId: '*'` = anywhere but
the floor) · `arm.grasp-handle` · `arm.release-handle` · `world.expect {surfaceId, min?, max?}`.

**`explore`** — base sweep, drone sweep from the pad, take off, sweep, frontier exploration,
return, land. **`explore {droneFirst}`** — the rover stays parked: no base sweep; the drone's
upward ranger clears its own climb and the rest is the same, every sweep registered before it is
integrated. **`clear-surface(fromId, toId)`** — against discovered ids: stow; for each object
with a reachable standoff (searched in the discovered grid, reach 0.25–0.56 m from the arm base,
comfortable reach first): drive, base sweep, lift, survey the surface with the wrist (first object
only), look at the object, wrist scan, approach, descend with contact, grasp, lift, tuck, drive to
a slot on the destination (free columns, two clear columns from anything), lower, release, retract
with contact, wrist scan, tuck, stow; then the drone verifies both surfaces by scan and
`world.expect`. Objects without a standoff are skipped and expected to remain.
**`fetch-from-appliance`** — the taught door: as in 0.2.0, plus a base sweep at the opening and
wrist pictures into and up the opening before the shelf reach.

## 6. Rehearsal, authority, routes

Unchanged in shape from 0.2.0: `validatePlan` rehearses on a clone (the map included); the
control authority owns idle/auto/manual/estop; the routes keep one world per owner, advance it by
wall-clock, and expose the discovered world (`/world`, `/world/voxels`, `/picture`, `/scan`,
`/world/label`) beside the tasks and the log.

## 6b. The drone designer (`engine/design`)

The drone the sim flies is also a parts model, so a number lives in one place:

- `propulsion`: momentum theory — `P_ideal = W^1.5 / sqrt(2 ρ A)`, `P_electrical = P_ideal / (FM · η)`
  with FM 0.60 and η 0.75, hover time from 80 % of nominal energy at 3.7 V per cell; tip speed.
- `airframe`: every printed part as a **CAD Studio program** — a base (box, cylinder or sketch) plus an
  ordered feature list in CAD Studio's contract and frame (mm, Z up, footprint centred, Z from 0):
  centre plate, arm, prop-guard quarter ring, mast, ToF mount, battery tray, landing foot, landing pad.
  Nothing here triangulates; STEP and STL come from the real kernel.
- `parts-model`: two fits on one frame — `recon-mini` (6 in, 4S 1500 mAh, the 2-D ring + ToF set) and
  `recon-3d` (7 in, 6S 2200 mAh, the Mid-360 class set) — printed parts with masses, bought parts with
  masses and approximate prices, the mass budget summed from them, the sizing computed at that mass,
  the mast height taken from the sensor set the fit names.
- `design-markdown`: the tables the hardware design document carries.

Routes: `GET /build/drone?fit=`, `GET /build/drone/parts/:id` (the part and the exact body for
`POST /api/cad-studio/models`), `GET /build/drone/design.md`. The surface's **Open in CAD Studio**
posts that body with the signed-in person's identity and opens the studio — the scan-to-print
hand-off pattern; no server-side call between packages.

## 6c. The physics plant (`engine/physics`, `engine/`) — ADR-152

The drone's TRUTH can come from a physics engine instead of the odometry model; nothing else moves.

- **One parts model, one MJCF.** `physics/mjcf` generates the MuJoCo model from the designer's parts
  model and the hidden scene: every solid a sensor can strike as a named box (door slices get `.N`
  suffixes the worker strips), the drone as one free body — mass = the summed mass budget, inertia
  estimated from where the parts sit (motors, props, arms, guards and feet at the arm radius on the
  diagonals, the rest a disc of the plate's radius), four `motor` actuators on the rotor sites with a
  reaction torque of 0.012 N·m per newton (a placeholder for aero-lab's curves), sensor sites at the
  same mast, pad plate and under-drop the kinematic sensors use, the body placed at rest on its pad
  plate. Timestep 2 ms, `implicitfast`. The generated model for the printed drone is committed as the
  engine's test fixture and a test asserts the two cannot drift.
- **The plant.** `engine/embodied_worker.py`: a cascaded controller (position → desired acceleration
  → thrust vector and attitude → torques → motor mixing with yaw last and desaturated; the yaw
  setpoint slewed at 2.5 rad/s because a quad's reaction torque is small), setpoint-velocity
  feed-forward so a 1 m/s ramp is tracked with a lag under 25 cm, a seeded Ornstein–Uhlenbeck gust
  in the horizontal plane, the floor not a strike while landed, taking off or landing, `settled`
  when the controller has converged (or the hull is down), and sensors by `mj_multiRay` from the
  true pose with exactly the kinematic raycaster's ray geometry (ring azimuths and elevations, the
  zenith cone, the depth camera's pinhole through pixel centres, the nadir ray) and the nearest-face
  normal rule. Deterministic for a seed; snapshot/restore exact, so a rehearsal clone is its own
  session copied from its parent.
- **The seam.** `PhysicsPlant` (`physics/plant`): `step(setpoint, phase, dt)`, `sense(spec)`,
  `clone()`, `drop()`. In `WorldSim`, with a plant: the autopilot ramps a **setpoint** (`cmd`) the
  plant chases; the belief dead-reckons the commanded motion and is corrected by the altitude hold,
  registration and the pad fix, each of which re-syncs the setpoint to the belief (a corrected belief
  must not pull the setpoint back, or a lagging plant crawls); a finished phase (arrived, climbed,
  landed) is held until the plant reports settled — the node says when it has arrived; a strike is a
  contact the plant reports; every sensor frame is the plant's, painted by the solid's name through
  the unchanged map and registration. Without a plant nothing changes.
- **The bridge.** The simulation steps synchronously and must stay deterministic, so the client to
  the container is synchronous: a worker thread (`physics/bridge-worker`) owns the TCP socket and the
  main thread blocks on `Atomics.wait` for each JSON-line reply (`physics/bridge-client`). The hello
  carries the protocol, the MuJoCo version and the engine tree's build hash, checked against the
  package's own tree before the first request; a down, stale or slow bridge is a typed failure the
  routes turn into a 503 naming the install command. Ops: `load`, `clone`, `drop`, `step`, `sense`,
  `status`, `reports`.
- **The container.** `engine/container/`: the bridge, a Dockerfile (python:3.11-slim, the
  requirements pins, CPU-only PyTorch), a compose file in its own project on the stack network
  (alias `embodied-engine`, port 7413, no host port), `install-engine.sh` (build, start, self-test:
  rest, climb, hover, ring sweep). The tile reports `GET /physics/status`.
- **Two guards the plant exposed in the shared code**, fixed for both truth models: a simplified
  flight leg could clip the corner of a cell Bresenham had skipped and the point-by-point guard then
  refused the route planner's own leg (flight legs now use a supercover line test); a drone that
  overshoots a climb by centimetres past the fence ceiling (2.5 cm above the mission altitude) had
  every next leg refused (the path is now judged from the nearest in-fence point within 30 cm; where
  the drone is cannot be refused, where it goes still is).
- **The first training task** (`engine/tasks/hover_leg.py`, ADR-152 D5.1): a Gymnasium environment
  over the same plant — hold position at the mission altitude for 3 s, then one 1.4 m leg, 50 Hz,
  observation = position error, velocity, rotation matrix, body rates, last action; action = four
  thrust fractions; reward = closeness minus body-rate and action-change penalties plus a bonus in
  the 5 cm success radius; a contact, a 70° tilt or a 2.5 m error ends the episode. The plant's own
  controller is the baseline every policy is scored against on the same seeded episodes;
  `train_hover.py` trains PPO (Stable-Baselines3, CPU) and writes one report with both scores.
  The verdict has three facets and needs all three: a lower mean error over the episode, endpoints
  (end of the hold, end of the leg) no worse, no more crashes — a policy that reaches the leg sooner
  but settles worse has not beaten the controller. **Residual mode** (`--residual`) learns a bounded
  correction (±25 % of a motor's range) on top of the controller, so a zero output is the controller
  and training starts from it. Measured here (the current controller as baseline: 0.6 cm at the end
  of the hold, 0.6 cm at the end of the leg, no crashes over 10 seeded episodes): absolute PPO at
  400 000 steps wins the mean-error facet (0.100–0.114 m vs 0.125 m, it reaches the leg sooner) and
  loses the endpoints (1.8–4.1 cm and 2.0–3.6 cm) on both seeds — not a win. Residual PPO at 200 000 steps comes closest — mean 0.119 m,
  endpoints 0.8 cm and 1.0 cm against the controller's 0.6 cm — and still loses the endpoints facet.
  Every report says so; nothing here rounds a near miss up to a win.
- **The certification gate and the policy as the plant's controller** (`physics/certify`, BACKLOG B19,
  ADR-152 D4 and Q3/Q4): every evaluation records the first episode's flight path at 10 Hz;
  `POST /physics/certify` replays it point by point through THIS owner's fence and `droneClear`
  against the owner's discovered map (unknown space refuses — a map certifies nothing it has not
  seen; each hop between points must stay inside the fence) and remembers a passing policy for the
  owner; `POST /world/reset {backend:'physics', controller:'policy:<file>'}` then loads the plant
  with that policy as its flight controller — inference stays in the container
  (`PolicyController`: the same observation the task showed it, every 20 ms, absolute or residual
  on the cascaded controller; snapshot/restore carry its state, a rehearsal clone keeps it). The
  autopilot's setpoint ramp, the belief, the map guards, `drone.goto`, the rehearsal and the confirm
  are untouched: the policy flies, the rails decide. An uncertified policy is 409; a policy on the
  kinematic backend is 400.

## 6d. The node rail (`engine/node`, `embodied-node-routes`, `engine/container/embodied_engine_node.py`) — ADR-099, B20

The plant speaks the rail a real drone node speaks; the sim cannot tell them apart.

- **The rail.** A node joins by heartbeat — `POST /api/embodied/nodes/heartbeat` every two seconds
  under the swarm service secret (`X-Service-Secret`), the mount declared `auth: service` so the
  mounter admits a node identity and never a browser (the drone and camera packages' posture) — with
  its id, kind (`plant`: a simulator that accepts `load`; `drone`: one body), the endpoint the api
  dials back, the bridge hello (protocol, engine, version, build hash), the sessions it holds, its
  latest telemetry and the events since the api's ack. The api commands it at
  `POST <endpoint>/api/drone-node/command` under the same secret with `{id, command, args}` envelopes
  answered `{id, ok, result | error, reason}` — the core drone node's command channel, carrying the
  bridge's ops (`load`, `step`, `sense`, `clone`, `drop`, `status`, `reports`).
- **The fleet** (`node/node-fleet`): nodes minted on first heartbeat, refreshed after, events merged
  by seq; ids, endpoints, sizes and telemetry bounded fail-closed; liveness is staleness — no
  heartbeat for 15 s and the node is offline and the fleet refuses to hand it out (`get` throws
  `NodeOffline`, a 404 for a node never seen, a 503 for one gone quiet). A plant node whose build hash
  is not this package's engine tree is flagged `stale`. One fleet per process, shared by the mount and
  the world routes.
- **`RailDroneNode`** (`node/rail-node`): the `DroneNode` a node on the rail is, beside `RemotePlant`
  (the container we dial): the same `SyncBridge` over an `http` transport (the worker thread POSTs
  each request as an envelope), the hello the node heartbeat in checked exactly as a dialled one
  (protocol; the build hash for a plant node), the secret required (`SWARM_SERVICE_SECRET`, or the
  rail cannot be used), one bridge per world closed on drop. `clone()` is a session on the node — or
  `null` when the node answers `cannot_clone` (one body): `WorldSim.clone()` then copies the world
  without a plant and the rehearsal runs on the kinematic twin from the plant's last reported truth,
  the flight itself on the node. `load` is what a plant accepts and a body refuses (`cannot_load`).
- **The container as a node** (`embodied_engine_node.py`): with `SWARM_SERVICE_SECRET` in its
  environment (passed by `install-engine.sh` from the api container's own, never written to a file)
  the bridge process also serves the command endpoint on 7414 and heartbeats into the api
  (`OSHAL_API_URL`, default the stack alias) as `embodied-plant`; without the secret only the
  JSON-lines bridge serves and the log says so. Both fronts share one `Sessions` under one lock.
- **A node belongs to one person** (ADR-114): `EMBODIED_NODE_OWNER_SUB` rides on every heartbeat as
  the trusted service user sub (`X-Oshal-User-Sub-B64`, base64url) — the platform's way for a machine
  to say whom it acts for; the mounter resolves it and the fleet records it on first contact. A
  heartbeat for that node from another owner is refused, an owned node is unknown to anyone else, an
  unowned one (a loopback development case) is visible to all. On a box whose app gate requires a
  person's identity for every package call, the core gate today refuses even the owned heartbeat
  (it admits only sessions and controller-minted workload delegations) — BACKLOG B20 records the
  evidence and the core decision it needs.
- **The routes:** `POST /world/reset {backend:'node', node}` gives the owner's world the node (the
  fleet refuses an offline one before any command); `GET /physics/status` lists the fleet; the tile
  offers every online node as a truth model. After the world has the node, every step is an envelope
  and a failed one is an engine failure exactly as with the dialled bridge.
- **What a real node must answer** (B6): the same envelopes — `step {setpoint, phase, dt}` returning
  its pose, tilt, speed, contact and `settled`; `sense {spec}` returning the compact frames; `status`;
  refusing `load` and `clone` — plus the heartbeat above, kind `drone`, and its own link-loss failsafe
  the way the core drone node has one. The node double in `tests/fake-node-worker.js` is that shape.

## 6e. A flight stack as the node (`engine/container/embodied_px4_node.py`) — B6

The first body that is not the plant: a PX4 flight stack (the official Dronecode SITL image, SIH
physics — no simulator dependencies, no GPU) flown over MAVLink as a `drone`-kind node. The sim cannot
tell it from the plant; PX4 cannot tell the sim from a ground station.

- **The envelopes.** `load` binds the scene to the one vehicle — the generated MJCF is loaded for
  sensing and contacts only, never stepped; `step {setpoint, phase, dt}` commands the phase and the
  setpoint and returns what the vehicle does *now* (no sleeping: a real body moves in wall time and
  the controller reads it each step); `sense {spec}` places the body at the reported pose and casts
  the same ring, zenith, depth and nadir rays the plant casts; `clone` is refused (`cannot_clone`, one
  vehicle — the rehearsal runs on the kinematic twin); `drop` lands. A contact is the hull overlapping
  a scene solid at the reported pose — the flight stack itself would not know.
- **Phases to PX4.** `takeoff`, `hover`, `moving`: the setpoint streams at 10 Hz
  (`SET_POSITION_TARGET_LOCAL_NED`, position and yaw commanded — the type mask leaves yaw in use, bit
  10 clear; with yaw ignored the vehicle keeps its boot heading while the belief yaws toward each leg
  and every sweep at altitude is placed 90° off), OFFBOARD is requested once the stream runs, then arm;
  `landing` sends LAND once and reports settled when PX4 says landed on the ground; `landed` disarms.
  `settled` at altitude is within 6 cm and under 0.15 m/s of the setpoint, by the vehicle's own
  estimate.
- **Frames.** PX4's local NED at its boot position; the room is x east, y north, z up, yaw from +x —
  except that the pad frame comes from the vehicle at rest: its NED position at load is the pad
  (`home`, where the generated model rests) and its resting heading is the room's +x (a SIH vehicle
  boots facing north; the room's drone home faces +x), so belief and truth agree from the first sweep.
- **The link.** One pymavlink socket bound to a fixed port (`EMBODIED_PX4_LISTEN`, 14540) does both
  directions: PX4 learns its partner — address *and* port — from the first packet it hears on a link
  and answers there for the rest of its life, so the node heartbeats from the moment the link exists
  (whichever came up first, PX4 learns the node) and a restarted node process is still that partner;
  the vehicle's name is resolved again every ten beats. The reader keeps the latest position, velocity,
  attitude, landed state and armed flag, logs COMMAND_ACK refusals and PX4's STATUSTEXT warnings, and a
  vehicle never heard from is called out once with the remedy. `AUTOPILOT_VERSION` comes via
  REQUEST_MESSAGE (the older capabilities request is refused by recent PX4).
- **The image's entrypoint, and why the compose service bypasses it:** `px4io/px4-sitl`'s entrypoint
  rewrites every `mavlink start` to `-t <host.docker.internal>` when that name resolves (Docker
  Desktop) — every link then talks to the host, not to a container beside it. The service runs
  `/opt/px4/bin/px4` directly and keeps stdin open (the pxh shell spins on EOF). The vehicle is
  recreated with the engine (`install-engine.sh --with-px4`, compose profile `px4`).
- **What the vehicle found in the sim (fixed with tests):** a sweep is expressed in the body frame of
  the pose the plant reports *with* its frames — not a truth snapshot taken before sensing (a real
  vehicle's estimate moves between steps) — and hit points carry the pose's precision: at 4 decimals
  against a 5-decimal pose the vertical zenith ray of a vehicle resting a centimetre off its pad
  landed beside the belief's voxel column and the climb was refused as unknown.
- **Proven** in the sandbox recipe (core runbook): `embodied-px4` online, a reset onto it, a
  drone-first exploration to done through the api's own timer — armed by external command, takeoff
  detected, tracking throughout, landing detected (2026-09-14). Unit: `engine/tests/test_px4_node.py`.

## 6f. The arm we print (`engine/design/{servos,arm-parts,arm-design,arm-markdown}`, `engine/physics/arm-mjcf`, `engine/embodied_arm.py`) — ADR-152 D1/D5 task 3

The hands, designed the way the drone was: one parts model, three consumers — the document a person
prints from, the CAD Studio programs the parts are cut from, and the MuJoCo model the physics checks.

- **The servo is the unit of design** (`design/servos`). One class: a 12 V STS3215-type serial-bus
  servo — 30 kg·cm rated stall, 0.222 s per 60°, 55 g, a 12-bit magnetic encoder over 360° with a
  multi-turn mode. Two rules come from a published bench test rather than a catalogue: a servo holds
  half its rated stall continuously (stable at 15 kg·cm for ten minutes, overload protection at 20),
  and its output plays by about 0.87°. The spline offset and the horn disc are measured on the servo
  in hand, not published, and the print rules say so.
- **A joint takes the simplest drive that holds it.** The requirement is the worst gravity torque
  over the poses the limits allow — searched, not assumed, and never a pose that reaches through the
  bench — times a dynamic allowance, plus (on the vertical axis) the stretched arm's inertia times the
  acceleration it is designed for. The options in order: one servo, two in parallel (only the shoulder
  bracket has two cheeks), then a printed belt stage. The desk-6 arm comes out with two direct servos
  at the shoulder, one everywhere else, 0.415 m of reach and 0.15 kg of payload; the design document's
  sweep shows what longer links would have cost (a belt stage at 180 mm).
- **The parts are programs** (`design/arm-parts`): base with the turntable bearing seat, turntable,
  shoulder bracket, upper arm, elbow bracket, forearm, wrist bracket, gripper body, moving jaw, pads.
  Every servo pocket is the case plus 0.3 mm a side and every hub is the horn disc — read from the
  servo spec, so one measured number changes every part. Each validates against CAD Studio's own
  contract in `tests/engine-arm.test.js` and opens there from the tile.
- **The model is generated from the same design** (`physics/arm-mjcf`): the body chain follows the
  joint table exactly, each link's mass sits where the sizing lumps it (so physics and sizing can be
  compared), each joint is a position servo limited to its drive's stall torque with the gearbox's
  reflected inertia, and its damping is the motor's own torque-speed line — stall over no-load speed.
  An invented damping ratio, tried first, had the elbow at its stall torque carrying nothing.
- **The plant and the task** (`embodied_arm.py`, `tasks/reach_grasp.py`): damped least-squares inverse
  kinematics on the tool site from several seeds — one seed walks into a joint limit and stops — and
  never a solution that collides; a move ramps on a trapezoidal profile and then trims out the servos'
  sag (a position servo stands off its command by its torque over its gain), with anti-wind-up so a
  blocked tool is reported rather than pushed; the taught pick-and-place is task 3's deterministic
  baseline, and `ReachGraspEnv` is the environment a policy would learn in (BACKLOG B21).
- **The check** (`POST /physics/arm/check`, the tile's *Check on physics*): the container holds the
  payload in each joint's worst pose and reports the torque it measured beside the torque the design
  expected, then runs the taught task over seeded scenes. Four verdicts: it holds its payload, the
  physics agrees with the sizing, the task succeeds, and the duty cycle is inside the continuous
  rating. It measures; it never restates the design — a wrong design figure comes back as a
  disagreement, which is what `engine/tests/test_arm.py` asserts. The check runs in the container
  under its own lock and reaches the api over the bridge's non-blocking call, so a drone world
  stepping on the same container is not held up.
- **What it found.** The tool point must sit where the jaws close, the jaws must not reach past it
  (a tip below the tool point digs into the bench), the elbow's zero is square to the upper arm so its
  limits have to allow a 150° fold either side of straight, and a two-jaw grasp is free to choose its
  approach yaw modulo π — at yaw 0 this arm's tool roll runs out 10° short.

## 7. What is deliberately not modelled

- Sensor noise, reflectivity, multi-path, motion blur: rays are exact. The drone's POSE is not
  exact (§2b); the rover's still is — its odometry and a base-LiDAR registration are BACKLOG B12.
- The odometry model is a fixed bias per metre, not a random walk; the numbers are a placeholder
  for a measured IMU/flow characterisation (B13).
- Occlusion between objects in the picture detector (`drone.observe`); the map-based discovery has
  true line-of-sight.
- Semantic recognition: classes are size guesses; a bot or person labels.
- The fridge door is taught, not discovered; opening it relocates its panel in the map by
  proprioception.
- Contact physics on the kinematic truth model; a held door follows the hand without inertia. The
  physics truth model (§6c) has rigid-body flight and contacts for the drone only; the arm and the
  rover stay kinematic (ADR-152 D5.3–5.4 are later tasks).
- The arm's swept volume is a straight joint interpolation sampled every 0.1 rad — a guard, not a
  planner; the planner keeps transitions short and straight.

Each of these is a BACKLOG entry with done-when criteria, not a hidden assumption.
