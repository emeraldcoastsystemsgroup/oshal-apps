# Drone Relay — architecture and the contract

This document is the contract. It states exactly what the engine computes, in which frame, with
which limits, and how the chain behaves. Everything here is implemented in `src-routes/engine/` and
asserted by `tests/engine-*.test.js`; nothing is planned or aspirational. If a sentence here and
the code disagree, the code is wrong. The design decisions behind it are ADR-155 in the core repo.

## 1. Frames and units

- Local frame: **x east, y north, z up, metres**, the base station at the origin. A corridor is a
  polyline of 2 to 64 points, base first, legs ≥ 1 m, total ≤ 50 km (`engine/path`).
- Every drone is **one number**: its arc length `s` along the corridor from the base. A slot is the
  point at `s`, lifted to the role's altitude band (`altitudes.relayM` for relays, `tipM` for the
  tip, `returnM` for drones flying home; the return band must sit ≥ 10 m from the relay band —
  the fleet-mission separation rule).
- Link distances are Euclidean between corridor points; the guard works in `s`, which on a bent
  corridor is ≥ the Euclidean distance and therefore conservative.
- Time in seconds; radio in dBm / dBi / dB / MHz; data in kbps.

## 2. The link budget (`engine/transports`)

Seven transports, each a row of datasheet-class numbers with its `source`: ESP-NOW, ESP-NOW long
range, Wi-Fi Direct, Wi-Fi mesh, BLE coded PHY, LoRa 915, Wi-Fi HaLow. For a hop of `d` metres:

```
PL(d)     = 20·log10(4π·f/c) + 10·n·log10(max(1, d))        n = environment exponent (2.2 default)
Prx(d)    = Ptx + 2·G − PL(d)
margin(d) = Prx(d) − sensitivity − fade
range(m)  = 10^((Ptx + 2·G − sensitivity − fade − m − PL(1 m)) / (10·n))   (closed form)
```

Three ranges matter: the **design range** (margin = `requiredMarginDb`, default 10 dB), the
**degraded range** (margin = `degradedMarginDb`, default 5 dB) and the **modelled edge** (margin 0).
At 2.437 GHz the intercept is 40.2 dB; ESP-NOW (+20 dBm, −96 dBm, 10 dB fade) sizes to ≈ 344 m at
10 dB and ≈ 980 m at the edge with n = 2.2; long-range mode (−100 dBm, 2 dBi each side) to ≈ 796 m.
These are model numbers. Every row states its `source`; the ESP-NOW rows also quote Espressif's own
open-field test (ESP32-C6 dev boards near the ground: ESP-NOW close to 100 % to 150 m and about
60 % at 300 m; long-range mode close to 100 % to 450 m and about 40 % at 900 m), which fits an
exponent nearer 3 than 2.2. The hardware document's range test replaces the row before a flight.

## 3. The plan (`engine/chain`)

```
hop          = spacingFactor × designRange                 (0.2 ≤ spacingFactor ≤ 1, default 0.6)
anchors      = [0, …groundNodes, L]                         a ground node PINS a slot, so each stretch is sized alone
hops         = Σ over stretches of max(1, ceil(span / hop))  L = corridor length
relaysNeeded = hops − 1 − groundNodes.length                 the MOBILE relays; slot j of a stretch at from + j·span/segHops
spares       = fleetSize − relaysNeeded
endToEndKbps = throughput / hops                            one shared channel, every frame crosses every hop
flightBudget = endurance − 2·s/cruise − reserve             what a battery leaves at slot s after the flight out and home
station(s)   = flightBudget                                 posture hover
             = flightBudget / perchDrawFraction             posture perch (motors off; radio, companion, flight controller awake)
onStationS   = station(farthest slot)
cycle(s)     = 2·s/cruise + station(s) + reserve + turnaround      (= endurance + turnaround under hover)
sustainFleet = ceil( Σ over slots of cycle(s) / station(s) )
perchAntennaHeightM = 0.3·√(λ·hop)                          perch only: 60 % of the first Fresnel radius at mid-hop
```

With no ground node there is one stretch and every line above is what it always was: `hops =
max(1, ceil(L/hop))`, slot k at `k·L/hops`. A **ground node** (`groundNodes`, arc lengths strictly
inside the corridor, at most 16, at least 1 m apart) is a relay that never flew: it holds its slot
for days, so `relaysNeeded`, `sparesAvailable` and `sustainFleet` count only the MOBILE relays, and
`station(s)` is evaluated at the farthest mobile slot. It still relays, so it still costs the shared
channel a hop. Given k mobile relays to place, the elastic rule hands each in turn to whichever
stretch currently has the longest hop (`elasticTargetsAround`, `spreadAround`) — which for a single
stretch is the even spread, position for position.

`sustainFleet` is the relays the chain needs **in rotation**: each slot consumes one drone cycle
per stretch on station. The reserve stays in the cycle deliberately: on the defaults the hover
figure is 15, and 30-minute runs with 13 or 14 relays still force battery returns while 15 force
none; a 900 s battery needs 8 and holds an hour with none. Perched at the default 3 % the far
slot holds 4111 s, the figure is 5, and six perched relays hold thirty minutes with no forced
return and no swap (`tests/engine-sim.test.js`).

**Control plane** (`controlChannel` ≠ `in-band`; any catalog radio but the chain's):

```
directRangeM     = range(controlRadio, requiredMarginDb, exponent)     from the base
reachesTipDirect = directRangeM ≥ L
nodesOnAir       = relaysNeeded + 1
frameS           = max(latencyMs / 1000, 64 B · 8 / throughput)        one packed heartbeat on the air
G                = nodesOnAir · frameS / heartbeatS                     offered load
dutyPct          = 100·G;   alohaDeliveryPct = 100·e^(−2G)             scheduled share; unscheduled first-try delivery
ok               = reachesTipDirect ∧ dutyPct ≤ 50
```

When `reachesTipDirect` the simulation runs the chain **with** that plane rather than beside it:
the controller's known-window is `heartbeatS` instead of `staleS` (a node that stops heartbeating
is gone that fast, and a node that keeps heartbeating reports where it really is — there are no
ghosts to steer around), and the segment beyond a gap is **commanded** to the meeting point (the
whole segment slides inward keeping its spacing, the innermost landing on the anchor, at cruise)
instead of each node walking in blind at recovery speed on its own detect timer. A commanded node
keeps only the decision that is its own — the battery. A channel that does **not** reach the tip
changes nothing: those heartbeats ride the chain again, and the run is the in-band run byte for
byte (`tests/engine-ground-control.test.js`). On the tight-margin chain the commanded reconnect is
7.0 s sooner (30.5 s against 37.5 s) and the outage 0.5 s against 7.5 s.

**Courier** (`courierMB` > 0; lands beside the tip, loads over `courierTransport`):

```
loadS     = MB · 8000 / throughput(courierTransport)
tripS     = 2·L/cruise + loadS + turnaround
feasible  = 2·L/cruise + loadS · perchDrawFraction + reserve ≤ endurance
mbPerHour = MB · 3600 / tripS;   equivalentKbps = MB · 8000 / tripS
```

A plan is **infeasible** (and says why) when spares < 0, the tip's data rate exceeds the end-to-end
throughput, or `onStationS ≤ 0`. Warnings name: no spare; a transport that is awkward beyond one
hop; a point-to-point radio; a single loss opening a gap beyond the modelled edge
(`2·hop > edge`); a fleet below `sustainFleet`; a perch planned on an air-to-air exponent (with
the antenna height that would justify it and the design range at exponent 3); a control channel
that does not reach the tip, or that the heartbeats occupy beyond half; a courier that cannot make
its trip on one battery, or that carries no more than the chain does.

Two pure rules the simulation and a controller share:

- `elasticTargets(tipS, k)` — `k` relays at `i·tipS/(k+1)`; `spread(endS, k)` — `k` relays at
  `i·endS/k` with the last **at** `endS` (the gap-midpoint case).
- `allowedTipS(k)` — `min(L, (k+1)·allowedHop)` with `allowedHop = hop` under `retreat` and
  `max(hop, degradedRange)` under `hold-degraded`.
- `guardMove(to, inner, outer, edge)` — clamps a commanded position so neither neighbouring link
  that is good now exceeds the edge.

**Trees** (`branches`: 2–4 polylines, each continuing from the path's last point — the **fork** —
to one work point; the path is then the **trunk**). Every drone on a tree is still one number on one
**lane**: lane 0 is the trunk, lane *i* the trunk continued along branch *i*; slots and tips on a
branch carry `branch: i`, and the roster names one tip per branch (`tip1…tipK`).

```
trunkHops    = max(1, ceil(T / hop))                 T = trunk length; relay j at j·T/trunkHops — the last AT the fork
branchHops_i = max(1, ceil(B_i / hop))               B_i = branch i beyond the fork; relays at T + j·B_i/branchHops_i
relaysNeeded = trunkHops + Σ (branchHops_i − 1)      the tip of branch i at T + B_i
hops         = trunkHops + Σ branchHops_i            the tree's links
endToEndKbps = throughput / Σ (trunkHops + branchHops_i)     every tip sending at once; every frame crosses the trunk
latency      = max_i (trunkHops + branchHops_i) · latencyMs
```

The relay AT the fork is the **junction** every branch hangs off. `onStationS` and `sustainFleet`
are the formulas above over every slot; `pathLengthM` is the farthest tip; the plan carries `tree:
{forkS, trunkHops, branches: [{index, lengthM, hops, relays, tipS, tip}]}`. Ground nodes, a control
channel and a courier are chain-only and refused on a tree naming the field. A spec without
`branches` carries neither field and plans exactly as before.

The tree's elastic rule (`engine/tree-rules`), with `k` relays and the allowed hop `h`:

- `treeTipReach(k)` — `nT = max(1, ceil(T/h))` relays hold the junction. Fewer: the tree is a chain
  up the trunk and every tip waits at `min(T, (k+1)·h)`. Otherwise each relay beyond `nT` goes to the
  branch whose tip is farthest short of its work point (ties to the lower branch), and tip *i* is at
  `T + min(B_i, (take_i + 1)·h)`.
- `treeSpread(tips, k)` — one relay AT the fork whenever a tip is beyond it, the rest handed one at a
  time to the stretch (the trunk, or a branch out to its tip) with the longest hop; `treeSpreadTo`
  also holds a relay AT a branch's meeting point. Every hop stays within `h` for every `k`, the tips
  reach their work points exactly when `k ≥ relaysNeeded`, and at `k = relaysNeeded` the layout is
  the plan's slots (`tests/engine-tree.test.js`).

**Lattices** (`area`: a polygon of 3–64 points in order, edges ≥ 1 m that never cross, ≥ 1 m², at
most 20 km across — instead of a path; branches, ground nodes, a control channel and a courier are
refused beside it). The area is tiled by `engine/lattice` on a square grid anchored at the base:

```
g      = hop = spacingFactor × designRange          the grid spacing: neighbouring slots are one hop apart
slots  = every grid node within g·√2/2 of the area   (the node nearest any point of the area is within that cover)
       + feeder nodes                                the shortest grid run joining each part not reached from the base
depth  = hops from the base, breadth-first; parent = the neighbour one hop nearer; slots numbered in that order
relaysNeeded = slots;  s(slot) = depth · g            the rotation counts every slot at its lattice distance
hops         = maxDepth + 1;  endToEndKbps = throughput / hops     the deepest route plus the tip's own hop
```

Each slot carries its `cell: {i, j, depth, parent, feeder?}`; the plan carries `lattice: {spacingM,
coverM, areaM2, slots, feederSlots, maxDepth, survey, surveyM}` and `tip` is where the sweep starts.
At most 40 000 grid cells are examined and 256 slots kept, refused naming `area`. The tip's
**sweep** runs back and forth across the area one spacing apart, each pass the part of its line
inside the polygon, and loops. The **assignment rule** (`latticeAssign(k, tip)`) is the elastic
rule's generalisation: with `k` relays, hold the route of parents from the base to the slot nearest
the tip first, then every other slot breadth-first (inner first). With every slot held — and with
only as many relays as the deepest route — a tip anywhere in the area is in reach with every hop
within the design hop (`tests/engine-lattice.test.js`, sampled every 10 m). A plan whose hop is more
than half the modelled edge warns that a relay lost where the lattice has no second route (a feeder,
a corner) opens a gap beyond the edge.

## 4. The on-board rule (`engine/node-policy`)

Applied by every relay on its own, with no controller, in this priority:

1. `remaining ≤ flightHome + reserve` → **rtl** (battery).
2. Inner link ok → **hold**.
3. Inner link silent ≥ `rtlAfterS` → **rtl** (inner-link-timeout).
4. Inner link silent < `detectS` → **hold** (still nominal).
5. Moved inward < one hop → **shift-in** (`recoverMps` along the corridor).
6. Otherwise **hold** (shifted-one-hop).

The outer link never moves a relay. A shifting relay stops the moment its inner link is back.

## 5. The controller rule (`engine/relay-sim`, `engine/tree-sim`, `engine/lattice-sim` — the part a swarm controller runs)

Every tick, over the nodes it can reach:

1. **Roster.** A node is on the roster while reachable, and for `staleS` after its last heartbeat
   (a ghost at its last position). A failed node therefore keeps its slot on the roster for
   `staleS` before the controller acts — exactly the heartbeat truth a real controller has.
2. **Targets.** Tip reachable → `tipTarget = allowedTipS(inChain)` where `inChain` counts reachable
   relays at least half a hop out (a spare on the pad does not extend the reach yet), and the
   roster spreads by `elasticTargets`. Tip not reachable → the connected prefix spreads to the
   midpoint between its outermost node and the innermost lost node's last position
   (`spread(midpoint, k)`); the outer segment is meanwhile shifting in on its own — they meet.
3. **Dispatch** (one launch per 5 s): roster shorter than `relaysNeeded` → launch a spare
   (`deploy` before any disturbance, `replace` after). A reachable relay with
   `remaining < 2·flight + reserve + 5·(relaysNeeded+1) + staleS` → launch a spare marked as its
   **swap**; when the swap is within 5 m of its elastic slot the tired relay is released home.
4. **Motion.** Reachable nodes step toward their targets at `cruiseMps`, clamped by `guardMove`
   against neighbours whose link is good; unreachable nodes run §4; returning nodes fly home at
   `cruiseMps` in the return band; landed relays become spares again after `turnaroundS`. A
   perched relay that did not move this tick drains `perchDrawFraction` of a second per second;
   one that moved (an elastic target, a shift inward, the flight home) drains a full second.
5. **Accounting.** Tip reachable / outage seconds and intervals; `gap-detected` when an outage has
   lasted `staleS`; `reconnected`; `restored` when — after any failure, launch or release — the
   tip is within 2 m of `L`, every hop ≤ `hop + 1 m`, exactly `relaysNeeded` relays are active,
   reachable and none is a pending swap. Worst hop margin over reachable hops. **Verdict:** `held`
   (nothing disturbed it), `restored` (last restore after the last disturbance), `degraded`
   (reachable, not restored), `lost` (tip unreachable at the end). **Store and forward:**
   `longestOutageS`, `tipBufferKB = tipDataKbps · longestOutage / 8`, and `drainS =
   tipDataKbps · longestOutage / (endToEndKbps − tipDataKbps)` (null when nothing is spare).

The tick is 0.5 s (0.1–5), the run 10–7200 s, frames sampled every 1 s (0.5–60). Same inputs, same
bytes — `JSON.stringify` of two runs is equal.

**On a tree** (`engine/tree-sim`) the same rules run on lanes. Links walk out from the base up the
trunk (the relays at or inside the fork, whatever their lane, in order) and then out every branch
(its relays beyond the fork and its tip) from the trunk's outermost relay. With every tip reachable
the layout is `treeTipReach(inTree)` spread over the roster by `treeSpread`, and the slots are handed
out so relays already out a branch keep to it (outermost to outermost), a branch short of relays
takes the ones nearest the fork, and the rest fill the trunk in order — a spare joining at the base
shifts the whole tree outward one slot. With a tip out of reach the cut decides: a **trunk** cut
(a trunk relay unreachable) cuts every branch, and the connected relays stretch along the trunk to
the midpoint between the outermost of them and the innermost lost relay while the junction and the
branches behind it walk in on §4; a **branch** cut keeps every reachable tip's target, holds a relay
AT that branch's meeting point (the midpoint between its outermost connected node and its innermost
lost one, never short of the fork) and spreads the rest. A relay changes branch only back through
the fork; the guard is by distance against the inner neighbour and every outer one; and a relay
leaves the trunk for a branch only while every other branch's first node stays inside the edge of
the relay left outermost on the trunk. "The tip reachable" means every tip; `metrics.branches` gives
each tip's own outages and reconnections; `restored` needs every tip on its work point; frames carry
each drone's `lane` and every tip's target. On the tight test tree a trunk loss at 30 s is met in the
middle — the connected relay out 60 m, the junction in 22 m — both tips are back at 41 s and one spare
restores the tree at 158.5 s; a branch loss costs its tip 25.5 s and the other tip nothing.

**On a lattice** (`engine/lattice-sim`) drones are points. Reachability is the graph: the
controller routes over the minimum spanning tree of links inside the modelled edge from the base (the
route with the shortest longest link to every node — the frames' `hops` and the worst margin come
from it), a relay is reachable when that tree reaches it, the tip when any reachable relay or the
base is in its reach — so a lost relay is routed around wherever a neighbour still reaches. The
controller keeps the roster as on a chain and hands out `latticeAssign(roster, tip)`: a swap takes
its tired relay's slot, a relay keeps a slot it holds while that slot is wanted, and every wanted
slot still open takes the nearest free relay; a relay flies straight to its slot and no commanded
move may cut off a node that is reachable now (checked on the graph, bisected). A relay's inner link
(§4) is its own traffic from the base, or any link to the base or to a relay nearer the base than
the slot nearest where it is; shifting in is toward its slot's parent. The tip flies its sweep and
does not retreat; returning drones fly straight home. **The lattice controller holds slots — it
does not stretch toward a gap**: a lost feeder whose gap the far side cannot walk in before its RTL
window closes is lost (pinned in the suite). On the 600 × 400 m test area the sweep holds 600 s with
a 14.9 dB worst margin; losing r1 costs no outage and one spare restores it at 207.5 s.

## 6. The envelope (`engine/envelope`) — the protocol the chain carries

```
{ v: 1, id, kind: command | query | reply | heartbeat, src, dst, route: [src, …, dst], hop, ttl, ts, payload, via?, proxy?, mac? }
```

- **Source-routed.** `routeThrough(chainOrder, dst, outward|inward)` builds `[base, r1, …, dst]` or
  its reverse from the order the controller knows; 2–16 ids, no repeats.
- **A relay decides from the route alone** (`decideForward`): not the version → drop; malformed
  route → drop; `ttl ≤ 0` → drop; `hop` off the route → drop; `route[hop] ≠ self` → drop (naming
  the node and hop); self earlier on the route → drop (loop); last hop → deliver if `dst === self`
  else drop; otherwise forward to `route[hop+1]`. `advance` = hop + 1, ttl − 1.
- **End-to-end authenticated.** `mac` = HMAC-SHA256 over `[v, id, kind, src, dst, route, ts,
  payload]`, truncated to 32 hex, keyed by the pair key the destination holds from enrolment.
  `hop`, `ttl` and `via` are not covered — a relay may change them and nothing else. Verification
  is constant-time. A `proxy` stamp, when present, is covered as a ninth element `[for, ageS]`;
  an envelope without one signs exactly as it did before the stamp existed.
- **Replay.** `ReplayWindow(windowMs).accept(env, now)` refuses a timestamp outside the window and
  a `(src, id)` seen inside it.
- **Signal record.** `viaAppend(env, self, rssiDbm)` on an inward heartbeat — the controller learns
  every hop's health without a separate protocol.
- **Fragments.** `fragment(bytes, mtu, id)` / `reassemble(frags)` for radios whose frame is smaller
  than a command (ESP-NOW 250 B, BLE 244 B, LoRa 222 B); any order; null until complete.

The payload is the core drone node's `{id, command, args}` or its heartbeat body, untouched.

**Proxy and the command queue** (`engine/proxy-queue`, `engine/relay-role`; ADR-155 D10). A `query`
asks a node for its status. The relay role runs `decideForward` first — the kind and the stamp
never change a forwarding decision — and forwards when its transport says the next hop answers
(`LinkView.up`). When the next hop is out of reach it stands in for what lies beyond, by kind only:

- a **query** is answered with the relay's own `reply` back along the route the query came by,
  signed with the relay's own pair key, stamped `proxy: {for: dst, ageS}` (seconds since the relay
  last heard `dst`, to 0.1 s), carrying `dst`'s last heartbeat envelope untouched as the payload —
  so the controller checks the answer with the relay's key and the heartbeat with `dst`'s own; a
  relay that has heard no heartbeat from `dst` drops the query naming that;
- a **command** waits in a `ProxyQueue` (1–64 held, default 8; oldest first; a duplicate `(src,
  id)` or a full queue is refused naming why). The hold is measured from the command's OWN `ts`
  and may not exceed the destination's replay window (`holdMs ≤ replayWindowMs`, refused at
  construction otherwise): the relay cannot re-sign, so a command the far end would refuse as stale
  is dropped at the relay instead — `held N ms since it was signed, past the W ms the destination's
  replay window allows`. Hearing any frame from a neighbour releases what waits for it, oldest
  first, on the original MAC and timestamp;
- a **reply** or **heartbeat** with no next hop is dropped naming it (the next one supersedes it).

The same lines run in memory (`tests/engine-proxy.test.js`) and between four node doubles over
loopback HTTP with the test's clock and link switches (`tests/relay-loopback.test.js`).

## 6a. The formation for Drone Ops (`engine/fleet-draft`)

`formationDraft(spec, plan, home, drones?)` turns a feasible plan into the `{name, assignments}`
fleet-mission shape the drone package's gate normalises. The local frame is placed on the map from
the base's `home: {lat, lon}` (|lat| ≤ 80°) with the drone package's own flat-earth scale:

```
lat = home.lat + y / 111320            lon = home.lon + x / (111320 · cos(home.lat))        alt = the slot's z
```

One assignment per flying relay (`r1…rN`; a ground node is placed by hand and flies in none) and
per tip, each ONE waypoint at its slot, the plan's `cruiseMps`, `rtlAfterMission: true`. The holds
end together: `formationHoldS = endurance − 2·s_far/cruise − reserve` (the farthest relay's
HOVERING station time — Drone Ops holds a waypoint in the air, so a perched plan's station time
does not apply, and the notes say so) and every drone holds `s_far/cruise + formationHoldS −
s/cruise`. `drones` renames roster ids to Drone Ops fleet ids (1–32 of letters, digits, `_`, `-`;
unique). Refused naming the field: an infeasible plan (`plan`), a formation of more than
`FLEET_MISSION_MAX_DRONES` = 8 drones — one fleet mission's cap (`drones`) — and a bad home or name.
It is the predefined formation at full strength for one sortie, not the dynamic chain. The module
builds JSON and nothing else; the real drone-package gate accepting it is
`tests/fleetmission.core.test.js`.

## 7. The write-up (`engine/design-doc`)

`designMarkdown(spec, plan, lastRun)` renders the budget, the chain table, the rules of §4–§6 as
prose, the last run's timeline and verdict, and an honesty section — from the stored plan, so the
document and the numbers cannot disagree.

## 8. Routes (`src-routes/`)

Under `/api/drone-relay` (oidc; every plan handler re-derives the caller):
`GET /app`, `GET /assets/drone-relay.js`, `GET /capabilities` (transports, limits, defaults, gap
policies, postures, control-channel choices, the heartbeat size, the branch and area limits), `GET /transports?distanceM&requiredMarginDb&exponent`,
`POST /link-budget`, `POST /plan-preview`, `GET|POST /plans`, `GET|PATCH|DELETE /plans/:id`,
`POST /plans/:id/simulate` (409 on an infeasible plan; stored as the last run),
`GET /plans/:id/design.md`, `POST /plans/:id/trace` (on a tree it walks the trunk and the branch its
destination lies on — `chainOrderTo` — and defaults to `tip1`; on a lattice it walks the parents out
to the destination's slot), `POST /plans/:id/fleet-mission`
(`{home, drones?}` → `{draft, formationHoldS, notes, target: 'drone', executes: false}`; computed,
never stored or sent; 409 on an infeasible plan). A refusal is `400 {error, field, message}`;
a foreign or unknown plan is 404. `/home-summary` (import-free) and `/_smoke` (service) beside it.
Plans live in `drone_relay_plan` (owner RLS; a spec change clears `last_sim`).

## 9. What is deliberately not modelled

Wind, antenna patterns and nulls, frame loss below the modelled edge (BACKLOG B3), terrain and
obstacles, the tip's own battery, radios sharing a channel with other traffic, a real transport
(B2), the relay role on the real drone node (B1). The relay role itself (proxy replies, the command
queue) is engine code proven over loopback node doubles; carrying it on the drone node is B1.
Two radios per relay (B10), per-leg exponents and corridors from the drone package's map (B4), and
the draft actually arriving in Drone Ops (B6) are backlog; a tree and a lattice carry no ground
node, control channel or courier, and a lattice's controller does not stretch toward a gap.
Nothing here commands a vehicle.
