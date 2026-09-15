# Drone Relay — backlog

Each entry has done-when criteria. An entry marked DONE names the version that closed it; the rest
are not built, and the README and ARCHITECTURE describe only what is.

## B1 — The relay role on the real drone node

The core drone node (`src/app/drone-node-server.ts`, ADR-099) serves `POST /api/drone-node/command`
under the swarm service secret and heartbeats into the controller. A relay-capable node adds the
envelope endpoint this package specifies (`engine/envelope`): accept a `RelayEnvelope`, decide from
the route alone, forward to the next id over the drone-to-drone transport, or deliver locally by
handing the payload to the existing command handler; forward heartbeats inward with a `via` stamp.

Done when: a node double speaking the envelope endpoint over loopback HTTP (the shape
`tests/engine-envelope.test.js` proves in memory) relays a command from a controller double to a
second node double and the reply comes back the reverse route — the same test run against a
`drone:node` process on the host with `DRONE_RELAY_ROLE=relay`, once the core exposes that role
under a core PR (the package never patches core).

Progress (0.4.0): the first half exists in the package — `engine/relay-role` behind node doubles over
loopback HTTP relays a command base → r1 → r2 → tip and the tip's reply comes back the reverse route
(`tests/relay-loopback.test.js`). Still open: the role on `drone-node-server.ts` (core PR), the `via`
stamp on heartbeats forwarded inward (the role forwards them unstamped), and the same test against a
`drone:node` process.

## B2 — A transport adapter behind one interface

The transports are catalog rows here. A companion process needs a `LinkTransport` (send, receive,
probe → RSSI / loss / latency) with one implementation per radio: ESP-NOW over a serial bridge
to an ESP32 module (the first, per the hardware document), Wi-Fi mesh over the companion's own
802.11s interface, BLE over a serial bridge, LoRa over SPI.

Done when: the ESP-NOW adapter carries fragmented envelopes between two ESP32 dev boards on a
bench, the probe reports RSSI the link budget can be compared against, and the bench numbers replace
the `esp-now` catalog row's sensitivity and exponent with a measured `source`.

## B3 — Frames below the modelled edge

The simulation has a hard link edge: a hop is ok up to the modelled zero-margin range and dead
beyond it. Real radios lose frames well before that. A per-hop delivery probability from the
margin (a logistic on margin, its width measured in B2's range test) would make the heartbeat
staleness and the detect windows meaningful rather than sharp.

Done when: `simulate` takes a `lossModel` (off by default so existing runs stay byte-identical),
a lossy run of the mid-chain-loss scenario shows staleness firing on a marginal hop before any drone
fails, and a test pins one run's outage to a value within a stated tolerance across seeds.

## B4 — Corridors that are not lines, and a map

The corridor is a polyline the person types as points; the tile draws it in plan view. A designer
wants to draw it on the same map the drone package flies over, with terrain and the base's
own antenna height feeding the exponent per leg.

Done when: the tile takes a corridor from the drone package's map (an integration receiver), each leg
carries its own path-loss exponent, and the plan's slots come back as latitude / longitude the
fleet-mission validator accepts.

Progress (0.4.0): the third clause holds — `toGeo` in `engine/fleet-draft` places the plan's local
frame from the base's latitude and longitude with the drone package's own metres per degree, and the
framework's real fleet-mission gate accepts the drafted slots (`tests/fleetmission.core.test.js`,
which also measures two drafted slots the plan's 200 m apart with the gate's distance function).
Still open: per-leg exponents — the budget, the planner's hop, the elastic rule and the simulation's
link margin all read one `pathLossExponent` per spec, so this is a planner change, not started; and
the corridor from the drone package's map, which needs the drone package to offer a drawn line to a
drone-relay receiver (a change in that package, not this one). Integration receivers carry text
fields of at most 2,000 characters (`contextFor` in the cockpit's `app-handoff.js`), so a corridor
would travel as a JSON string field.

## B5 — Two tips, one chain (a tree)

**DONE in 0.4.0** — a spec takes `branches` (2–4 polylines continuing from the path's last point, the
fork, to one work point each); the planner sizes the trunk so its last relay sits AT the fork (the
junction) and each branch on its own from there (`plan.tree`; branch slots carry `branch`; the
roster names `tip1…tipK`), with every tip's frames crossing the trunk (`endToEndKbps = throughput /
Σ(trunkHops + branchHops)`). The tree's elastic rule (`engine/tree-rules`) keeps every hop within
the allowed hop for every relay count from 0 to past the plan's, and reproduces the plan's slots at
full strength; the simulation runs the same rules on lanes (`engine/tree-sim`). On the tight test
tree a trunk loss at 30 s cuts both branches and is met in the middle — the connected relay
stretches out 60 m while the junction walks in 22 m — both tips are back at 41 s and one spare
restores the tree at 158.5 s; a branch loss costs its tip 25.5 s and the other tip nothing.
`tests/engine-tree.test.js` (7 cases) and a tree end to end in `tests/routes.core.test.js`. That
test tree uses `staleS` 20: at the default 6 s the same 11 s outage outlasts the staleness window,
the controller drops the stranded junction and branch relay from its roster and launches both
spares, and the run ends `degraded` with five relays for four slots — the chain's controller rule,
unchanged, pinned in the same suite. A tree
carries no ground node, control channel or courier (refused naming the field); the tile draws and
runs a tree, its form stays a straight corridor.

A chain serves one tip. Two data-collection drones in different directions want a tree: a shared
trunk of relays and two branches. The envelope's source routing already allows it; the planner and
the elastic rule do not.

Done when: a spec with two work points sizes a trunk and two branches, the elastic targets keep every
branch's hop under the design hop, and the failure scenario shows a trunk loss reconnecting both
branches through the meet-in-the-middle rule.

## B6 — The formation lands in the drone package

The plan's slots are positions and altitudes; the drone package's fleet missions are the rail that
flies formations behind a human confirm. A "send to Drone Ops" hand-off would draft a fleet mission
from the plan — draft only, never executed here.

Done when: a saved plan produces a fleet-mission draft the drone package's validator accepts
(altitude bands ≥ 10 m apart, horizontal separation ≥ 20 m), the draft appears in Drone Ops as a
draft, and nothing in this package can execute it.

Progress (0.4.0): the first and third clauses hold. `engine/fleet-draft` drafts a saved plan as a
fleet mission (`POST /plans/:id/fleet-mission`, the `relay-fleet-mission-draft` tool): one
assignment per flying relay and tip, one waypoint at its slot, holds that end together after the
farthest relay's hovering station time, return to launch. `tests/fleetmission.core.test.js` runs
the framework's own `fleet-mission.ts` on it — the default chain, a named formation and a tree
normalise with no error and pass the separation check, the eight-assignment cap is shared, and a
draft with two relays on one slot is refused, so the check is live. Nothing here executes it: the
route returns JSON and stores nothing, and the module imports nothing that sends
(`tests/engine-fleet-draft.test.js`). Still open: the draft appearing in Drone Ops as a draft. The
drone package declares no receiver today (its manifest offers `prepare-document` only, and its
`POST /missions` saves a hand-built fleet plan as `ready`, not `draft`), so the hand-off needs a
receiver in that package — an `integrations.accepts` on its surface that fills a reviewable draft —
and the matching offer here. The draft is checked for separation only; Drone Ops re-validates the
geofence at execution.

## B7 — Ground nodes: a relay that is not a drone

**DONE in 0.3.0** — `groundNodes` on the spec, the corridor cut into stretches the mobile
relays fill, `relaysNeeded` / `sparesAvailable` / `sustainFleet` counting the mobile ones alone, an
immovable member with no flight budget in the run, and `tests/engine-ground-control.test.js`.

A perched relay is a drone that landed. The limit of that idea is a relay that never flew: an ESP32
on a battery with a short mast, placed by hand along the corridor or dropped by a drone, holding
an inner slot for days. The chain math changes in two ways the engine does not yet express — a
ground node cannot move (so the elastic rule must spread the *mobile* relays over the slots the
static ones leave) and it does not count against the fleet or the rotation.

Done when: a spec takes `groundNodes` as slot positions; the plan spreads the mobile relays over
the remaining corridor and reports the rotation for those alone; the simulation treats a ground
node as an immovable relay with no battery (it can still be failed by an event); a scenario that
loses a mobile relay beside a ground node shows the mobile ones closing the gap around it.

## B8 — The control plane in the simulation

**DONE in 0.3.0** — `simulate` reads the plan's control channel: with one that reaches the tip the
known-window is the heartbeat period, live nodes report their real positions and the outer segment
is commanded to the meeting point; the tight chain reconnects 7.0 s sooner and the in-band run is
byte for byte the 0.2.0 one. Proven in `tests/engine-ground-control.test.js`.

The plan sizes an out-of-band control channel; the simulation still runs the chain in band. With
heartbeats arriving direct, the controller has no ghosts (a lost relay is known the moment its
heartbeat stops), the gap is detected at the heartbeat period rather than after the staleness
window, and the outer segment can be *commanded* to the meeting point instead of walking in blind.

Done when: `simulate` reads `spec.controlChannel`; with a channel that reaches the tip, the roster
comes from direct heartbeats (staleness = the heartbeat period), the outer segment moves on
commanded targets, and the tight-margin scenario's reconnect time is shorter than the in-band
run's by an amount a test pins; the in-band run stays byte-identical.

## B9 — A lattice: the tip roams inside an area

**DONE in 0.4.0** — a spec takes `area` (a polygon) and `engine/lattice` tiles it with slots on a
square grid anchored at the base at the design hop — every point of the area within half a cell
diagonal of a slot, neighbours one hop apart, feeder slots joining an area the grid does not reach
from the base — counting every slot as a relay, the rotation at each slot's lattice distance and
the shared channel over the deepest route plus the tip's hop (`plan.lattice`, each slot's `cell`).
The assignment rule (`latticeAssign`) holds the route of parents from the base to the slot nearest
the tip first, then every other slot inner first: with every slot held, and with only as many
relays as the deepest route, a tip at any of 2,000-plus points sampled every 10 m inside the test
area is in reach with every hop within the design hop. `engine/lattice-sim` flies the tip round
its sweep with reachability on the link graph and reports the chain's metrics: on a 600 × 400 m
area 200 m east of the base (12 slots, 5 hops deep) it holds 600 s with no outage and a 14.9 dB
worst margin, and losing r1 costs no outage — routed around — with one spare restoring it at
207.5 s. `tests/engine-lattice.test.js` (7 cases) and a lattice end to end in
`tests/routes.core.test.js`. The lattice's controller holds slots and does not stretch toward a
gap the way a chain's connected prefix does: on a tight lattice (2 dB, spacing 0.9) a lost feeder
opens a 1432 m gap the far side cannot walk in before its RTL window closes, and the run is lost
(the plan warns; pinned in the suite). The tip flies its sweep and does not retreat.

A corridor serves one work point. A survey wants an area: relay slots on a grid (or along a set
of corridors sharing a trunk — B5's tree) so the tip roams and always has a neighbour within a
hop. The elastic rule generalises to an assignment — connected relays to the slots that keep every
occupied cell within reach, inner slots first.

Done when: a spec takes a polygon and the plan tiles it with slots at the design hop, counting the
relays and the rotation; the assignment rule keeps the tip reachable from any point inside the
polygon with every hop under the design hop; the simulation moves the tip on a survey path and
reports the same metrics.

## B10 — Two radios per relay

Every frame on a one-channel chain crosses every hop, so the tip gets `throughput / hops`. A relay
with two ESP32-C6 modules — one facing in, one facing out, on different channels — removes that
division on paper. Whether it does in the air depends on how far the interference reaches, which
the model cannot say.

Done when: the bench (B2) measures a three-hop chain's end-to-end throughput with one radio per
relay and with two on alternating channels; the catalog gains the measured factor; the plan takes
`radiosPerRelay` and applies it.

## B11 — Proxy replies and the command queue in the relay role

**DONE in 0.4.0** — `engine/envelope` carries `proxy: {for, ageS}` under the MAC as a ninth covered
element (an envelope without it signs byte for byte as before — pinned by an HMAC recomputed by hand)
and a `query` kind, and `decideForward` is unchanged; `engine/proxy-queue` is the `ProxyQueue` (1–64
commands, oldest first, the hold measured from the command's own `ts` and refused at construction
above the replay window); `engine/relay-role` answers a query for a node it cannot reach with its own
signed reply carrying that node's last heartbeat untouched, holds commands and releases them on their
original MAC when it hears the next hop again. Proven in memory (`tests/engine-proxy.test.js`, 8
cases) and between four node doubles over loopback HTTP with the test's clock
(`tests/relay-loopback.test.js`, 4 cases): the proxy answer aged 12 s, a queued command run at the tip
after the link returns and its reply back at the base, and a command held 31 s dropped at the relay
naming the 30 s window. The role runs in the package; carrying it on the real drone node is B1.

While the tip is out of reach, the outermost reachable relay stands in for it (ADR-155 D10): it
answers a status query from the tip's last heartbeat stamped with its age — an ordinary `reply`
signed with the relay's own pair key carrying `proxy: { for, ageS }` — and queues commands for the
tip, forwarding them when the link returns. The relay cannot re-sign, so a queued command must
still verify at the tip on its original MAC and timestamp: the queue's hold time is bounded by the
tip's replay window and an older command is dropped naming the reason.

Done when: `engine/envelope` carries the `proxy` field under the MAC and `decideForward` still
forwards from the route alone; a `ProxyQueue` (bounded, oldest first, hold ≤ the replay window)
is a pure module with tests; the relay role of B1 answers a controller's status query for a stale
tip by proxy and delivers a queued command after a simulated link return, over loopback node
doubles; a queued command older than the window is dropped naming the reason.
