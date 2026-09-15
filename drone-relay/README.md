# Drone Relay

A chain of mini drones that relays commands and telemetry **drone to drone** so that one drone —
the *tip*, the one collecting data — can work beyond the base station's own radio reach. This
package **designs and rehearses** that chain before a radio is soldered: it sizes the hop from a
link budget on a chosen transport, places the relay slots and counts the spares, fails relays in a
simulated scenario and reports how long the tip was out of reach, when the chain detected the gap,
reconnected and was restored, and the worst hop margin seen. The two rules the chain runs on — the
one **on board every relay** and the one **at the controller** — are implemented here exactly as a
companion firmware and the swarm controller will carry them, and the **source-routed, signed
envelope** a relay forwards is shown hop by hop.

Nothing here flies. A vehicle is commanded only through the swarm drone rail (ADR-099) behind its
human confirm. The design this package implements is [ADR-155](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/adr/155-drone-relay-chains.md);
the radio module and what not to fork in the flight stack are in
[drone-relay-link-hardware](https://github.com/emeraldcoastsystemsgroup/oshal/blob/main/docs/architecture/drone-relay-link-hardware.md).

## Use it

Open `/cockpit/?app=drone-relay`.

1. **Size** — pick a transport (ESP-NOW is the default; the table at the bottom compares all seven at
   one hop distance), a corridor length, a design margin and a spacing factor, the relays you have,
   what the tip must push inward and how long a battery lasts. *Preview* sizes the chain without
   saving; *Save* keeps it. Choose the **posture** (relays hover at their slots, or perch there
   with the motors off and the radio awake), whether heartbeats ride the chain or a second radio
   (the **control channel**), whether any slots are held by **ground nodes** (`groundNodes`: arc
   lengths along the corridor held by a relay that never flew — an ESP32 on a battery with a short
   mast, placed by hand or dropped there — which cut the corridor into stretches the flying relays
   fill and cost the fleet and the rotation nothing), and whether a **courier** carries bulk data
   home. A **tree** — one trunk to a fork and two to four branches, a tip at the end of each — is
   sized through the API or the concierge (`branches` on the spec); the tile draws it, runs it and
   reports every tip. A **lattice** — an `area` (a polygon) the tip surveys instead of a corridor —
   is tiled with relay slots on a grid at the design hop, joined to the base by feeder slots, and
   run with the tip sweeping the area; also through the API or the concierge. The facts card
   shows the design range, the hop, how many relays and spares, the margin at the hop, the
   end-to-end throughput, how long the farthest relay can hold its slot and how many relays the
   rotation needs, the antenna height a perch needs, the control plane's reach and air time,
   and the courier's trip. An infeasible chain says why.
2. **Break it** — add failures (which drone, at what second), choose whether the chain starts on
   station or launches from the base, and *Run*. Scrub or play the frames on the corridor map: slots
   dashed, drones coloured by reachability, hops coloured by margin.
3. **Read the numbers** — verdict (held / restored / degraded / lost), the tip's outage seconds,
   when the controller detected the gap, when the chain reconnected, when it was restored, the
   worst margin, spares launched, swaps, forced returns, the buffer the longest outage costs a tip
   that keeps collecting and how long the chain takes to drain it, and the timeline.
4. **Write it up** — *Design write-up* opens the generated Markdown (budget, chain table, the rules
   as implemented, the last run). *Trace a command to the tip* walks one signed envelope through
   the chain and shows every relay's decision.
5. **Draft it for Drone Ops** — `POST /api/drone-relay/plans/:id/fleet-mission` with the base's
   latitude and longitude (the concierge's `relay-fleet-mission-draft`) returns the formation as a
   Drone Ops fleet-mission draft: every relay and tip to its slot, holding together for one hovering
   sortie, then home. It is returned, not sent: nothing here can execute it, and getting it into
   Drone Ops as a draft is still backlog (B6).

The **relay-designer** concierge in the right rail does the same through route-backed tools:
"I need a drone 1.2 km out on ESP32 radios with six relays — how many hops, and what happens if the
third one dies?"

## What is modelled, and what is not

- Ranges come from a **log-distance link budget on vendor and standard numbers** (transmit power,
  antenna gain, sensitivity, a fade allowance, an environment exponent), each row stating its
  source. They size a chain; they do not certify one. The default exponent (2.2) is an
  air-to-air assumption: Espressif's own open-field ESP-NOW test between dev boards near the ground
  delivered close to 100 % only to 150 m and about 60 % at 300 m — the catalog quotes it, and the
  range test in the hardware document replaces the row before a flight.
- **Endurance** is two numbers: how long the farthest relay holds its slot on one battery, and
  how many relays the chain needs **in rotation** to hold every slot through battery swaps. With
  the defaults (8 minutes, 1 km, 4 slots) that is about 15; with 6 the simulation shows relays
  leaving on battery before a spare takes over, the tip still reachable on stretched hops.
- The simulation moves drones along the corridor at constant speeds with a **hard link edge** at
  the modelled zero-margin range. No wind, no antenna pattern, no frame loss below the edge, no
  terrain. Its value is comparative: two designs run on the same model (BACKLOG B3 adds loss).
- The tip's battery is reported, not acted on: the chain is sized so relays never leave before
  their swap arrives; the tip's endurance bounds the mission.
- A **perched** relay drains its battery at `perchDrawFraction` of hover draw while it holds still
  and at the full rate the moment it moves. Its radio is on the ground unless the perch lifts it:
  the plan states the antenna height that keeps 60 % of the first Fresnel zone clear at the hop,
  and warns to plan on exponent 3 otherwise (Espressif's ground-level test).
- The **control channel** is sized on the plan (direct reach at the design margin, the share of
  the air the heartbeat cadence costs, first-try delivery if nobody schedules the heartbeats);
  the simulation still runs the chain in band. The **courier** is arithmetic on the corridor, the
  courier radio's planning rate and the battery: load time, trip time, MB per hour.

## The two rules (as implemented — `engine/node-policy`, `engine/relay-sim`)

**On board every relay, without the controller:** battery first (fly home while the flight home
plus the reserve still fit); inner link silent past the detect window → shift one hop inward along
the corridor and hold; silent past the RTL window → fly home along the corridor; the outer link is
never chased.

**At the controller, over whatever is reachable:** a silent node stays on the roster until stale;
connected relays are spread evenly to the tip (elastic spacing); when the tip is out of reach the
connected prefix stretches to the gap's midpoint while the outer segment shifts inward — they meet
in the middle; the tip retreats (`retreat`) or holds at a lower margin (`hold-degraded`); a spare
launches to replace a lost relay or to swap a tiring one before it must leave, joining at the inner
end so the whole chain shifts outward one slot as it arrives; no commanded move breaks a link that
is good now.

**At the relay, when the next hop is out of reach** (`engine/relay-role`): a status query for the
tip is answered by the outermost reachable relay — its own signed reply, stamped `proxy: {for,
ageS}`, carrying the tip's last heartbeat untouched; a command for the tip waits in a bounded queue
and goes out on its original signature the moment the tip is heard again, or is dropped naming why
once it is older than the tip's replay window would accept.

## Tests

| Suite | What it proves | Run |
|---|---|---|
| `engine-transports` | catalog, intercept, closed-form range, ok flag, pure engine | `node --test tests/engine-transports.test.js` |
| `engine-chain` | spec refusals by field, sizing, infeasibility, elastic targets, guard | `node --test tests/engine-chain.test.js` |
| `engine-node-policy` | the on-board rule | `node --test tests/engine-node-policy.test.js` |
| `engine-envelope` | routes, MAC, forwarding decisions, replay, fragments | `node --test tests/engine-envelope.test.js` |
| `engine-sim` | held / mid-chain loss / true gap / formation / swaps / determinism | `node --test tests/engine-sim.test.js` |
| `engine-ground-control` | ground nodes (segments, rotation, refusals, immovability) and the control plane in the run | `node --test tests/engine-ground-control.test.js` |
| `engine-tree` | trees: a trunk to a relay at the fork and a branch to each tip, the refusals, the elastic rule at every relay count, retreat, a trunk loss met in the middle, a branch loss, a build from the base | `node --test tests/engine-tree.test.js` |
| `engine-lattice` | lattices: the grid over an area at the design hop, feeders, refusals, the assignment rule's reach from every point, the tip's sweep, a loss routed around, the feeder loss it cannot close | `node --test tests/engine-lattice.test.js` |
| `engine-fleet-draft` | the formation as a Drone Ops fleet-mission draft: geo placement, holds, fleet ids, refusals, nothing sent | `node --test tests/engine-fleet-draft.test.js` |
| `engine-proxy` | the proxy stamp under the MAC, the command queue bounded by the replay window, the relay role in memory | `node --test tests/engine-proxy.test.js` |
| `relay-loopback` | the relay role between four node doubles over loopback HTTP: proxy answer, queued command released on link return, stale command dropped | `node --test tests/relay-loopback.test.js` |
| `surface-parse` | the tile's script parses, ids exist, no markup interpolation | `node --test tests/surface-parse.test.js` |
| `routes.core` | the compiled routes over loopback HTTP (framework checkout) | `OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/routes.core.test.js` |
| `fleetmission.core` | the draft through the drone package's own fleet-mission gate (framework checkout) | `OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/fleetmission.core.test.js` |

Store CI runs `node --test "tests/*-*.test.js"` (every plain-node suite); the two framework-coupled
suites are registered in `tests/test-lab.yaml` with their checkout prerequisite.

## Layout

```
oshal-app.yaml            manifest: one inline concierge, twelve route-backed tools, one tile
src-routes/engine/        transports + link budget, corridor, chain planner, on-board rule,
                          envelope protocol, proxy queue + relay role, simulation (a chain,
                          a tree's and a lattice's rules and runs), design write-up, the
                          Drone Ops formation draft (pure TypeScript)
src-routes/*.ts           routes: plans / simulate / design.md / trace, capabilities, Home, smoke
routes/                   the compiled modules the loader mounts
tools/                    the tile (drone-relay.html + drone-relay.js)
personas/                 relay-designer
migrations/               drone_relay_plan with owner RLS
docs/ARCHITECTURE.md      the contract: frames, the budget, the plan, the rules, the envelope
```
