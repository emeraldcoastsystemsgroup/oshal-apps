# Aero Lab — user guide (as-built)

> This guide ships with the package (it moved out of the oshal kernel's core help, which documents only core screens).

This lab is one of eight maker labs; the sections after its own are shared by all of them.

Eight installed apps let you design a thing and look at it: a robot arm, a drone, a printed part, a
circuit, an animatronic prop, a relay chain, an aircraft, a turbine blade. They live on the cockpit's
left ribbon in two groups — **Robotics & Space** and **Engineering** — and each one also opens at its
own `/cockpit/?app=<name>` URL, which is the address to bookmark.

Every lab is **per person**: what you make is scoped to your login and nobody else on the install
sees it. Most of them carry a concierge in the right chat rail that edits the same thing you are
looking at by talking to it.

**Read this first.** Nothing on this shelf drives hardware except Animatronics, and that one only
after you connect a real controller and arm it. The Embodied Swarm lab is a **simulation** — there is
no arm and no drone; every view on it says SIMULATED. Where a lab needs something that is not there
yet — a container to install, a sensor to buy, a decision to make — its section says so.

## Aero Lab — the persistent-flight design lab

Shape a solar-endurance aircraft with real sliders — span, area, aspect ratio, battery mass, cell
efficiency, buoyancy fraction, site, season — run it through a real flight-physics engine, and read
the verdict with plots.

**Where:** rail tile **Aero Lab**, group **Engineering** — `/cockpit/?app=aero-lab`.

### Try this first

Pick one of the **Proven starting points**, adjust the **Design vector** sliders, then **Run Polar**,
**Run 24 h Energy Loop** and **Run Screen**. Read the **Verdict** card against the plots — wing polar,
state-of-charge trace, drag buildup, mass ledger, generation vs load. **Export Build Files** writes
the build package: wing panel STLs, rib and hull-gore DXF, the airfoil dat, a BOM and a build sheet.
There is no chat rail on this tile; **Draft with AI** in the page turns plain language into a design
vector draft, and every number still comes from the engine.

### Real vs simulated, and what is open

The engine is a vendored snapshot of a validated flight simulator and the surface always shows its
fingerprint, so which tree answered is never a guess. Two honest caveats the package states itself:
the low-Reynolds section data is a surrogate model, so single-digit-percent margins are design
guidance rather than flight certification; and the recorded headline energy numbers come from the
*ideal* propulsion path, with the real-chain promotion gate still open in the package's backlog. If no
engine is reachable, every capability reports false and the surface says exactly why nothing ran — it
never fabricates a number.

## Where they are

| Rail tile | Group | URL |
|---|---|---|
| **Embodied Swarm** | Robotics & Space | `/cockpit/?app=embodied` |
| **Animatronics** | Robotics & Space | `/cockpit/?app=animatronics` |
| **Drone Relay** | Robotics & Space | `/cockpit/?app=drone-relay` |
| **CAD Studio** | Engineering | `/cockpit/?app=cad-studio` |
| **Circuit Lab** | Engineering | `/cockpit/?app=circuit-lab` |
| **Scan to Print** | Engineering | `/cockpit/?app=scan-to-print` |
| **Aero Lab** | Engineering | `/cockpit/?app=aero-lab` |
| **Harvest Console** and **Blade Studio** | Engineering | `/cockpit/?app=ocean-lab` |

The rail hover-expands to show the labels; pin it from the toggle at its top-right if you want the
names to stay put. Ocean Lab is one app with two tiles.

## How they connect

Four hand-offs are wired, and each one is a button rather than a download-and-re-upload:

- **Scan → CAD → print.** Scan to Print's **Open in CAD Studio →** sends the front / top / right
  outlines to CAD Studio as a `contours` base, where they become an editable part with a STEP export.
  Printing goes the other way: CAD Studio does not print — download the STL and send it from Scan to
  Print, which talks to your own printer behind a confirmation.
- **Circuit gears → CAD.** Select a gear in Circuit Lab and press **Open in CAD Studio**: its involute
  outline arrives as a printable part.
- **Embodied parts → CAD.** Every printed part of the drone and of the Desk-6 arm has **Open in CAD
  Studio** beside it in the **Build the drone** and **Build the arm** tables. That is how the robot
  arm design becomes actual CAD drawings.
- **Spaces scan → the simulated room.** A room you scanned in Spaces is offered through *Send to…* as
  **Fly it in Embodied**. Accept it and the scan appears in Embodied Swarm's **Room** selector beside
  the built-in Kitchen and Studio, with its solid count; **Reset world** starts the drone in it. A
  scene the engine's bounds refuse is rejected naming the rule it broke.

The general mechanism behind the last one — and behind sending an STL into CAD Studio or an image
into Scan to Print from anywhere — is the platform's **Send to…** registry. How it works and what
always appears in the menu is in Send to… (oshal help: `/api/help/send-to`).

## When a lab says its engine is not answering

Four labs run their heavy compute in a container the package owns rather than inside the api: **CAD
Studio**, **Circuit Lab**, **Aero Lab**, and **Embodied Swarm** (for its physics truth model and the
arm's **Check on physics** only — the kinematic model needs nothing).

The api checks the container's build hash before the first request, so a container built from an older
version of the package answers with the install command instead of a wrong number. When that happens
the page shows a banner — "The CAD engine container is not answering." or "The circuit engine
container is not answering." — followed by **Install or rebuild it from the host:** and the exact
command. Run it from the host shell, not from inside a container:

```sh
docker exec oshal-local-api sh /app/workspace-shared/deployed-apps/cad-studio/engine/install-engine.sh
```

The banner fills in your own api container name, and the same command with the package name swapped
(`circuit-lab`, `aero-lab`, `embodied`) installs the others. It builds the image locally, starts it on
the stack network under its own compose project with no host port, and **self-tests it** before
reporting ready — the circuit engine solves an LED circuit and a geared motor to known numbers, the
CAD engine builds a part on the real kernel. Re-run the same command whenever a page reports the
engine is out of date.

## What you cannot do yet

Specific, and worth knowing before you go looking for a button that is not there:

- **Nothing on this shelf moves hardware except Animatronics**, and only with a real controller
  connected over Web Serial from desktop Chromium and the rig explicitly armed.
- **Embodied Swarm never touches hardware.** There is no arm, no drone, and nothing has been bought.
  The parts model, the flight and the pick-and-place are all simulated; the conditions that must hold
  before anything is purchased are written down in the package's buy-decision document.
- **Embodied's world is not saved.** It lives in memory per person and resets when the api restarts —
  explore again. Tasks and the command log survive.
- **Drone Relay does not fly anything.** It sizes and rehearses; the fleet-mission draft is returned
  to you rather than sent to Drone Ops.
- **A prop or an arm cannot join the swarm rail as a node.** That is blocked on a core
  application-authorization decision, not on these packages; both record the refusal rather than
  hiding it.
- **Circuit Lab's Arduino sketch drives the circuit but cannot read it back** — `digitalRead` and
  `analogRead` see the AVR's defaults.
- **Scan to Print's photo lane cannot see inside anything.** Cavities and undercuts no view reaches
  are filled solid; the depth and LiDAR lanes are what recover them, and the depth upload has no
  button on the page yet.
- **Aero Lab's headline numbers come from the ideal propulsion path** and the real-chain promotion
  gate is still open; the surface shows the engine fingerprint so you always know which tree answered.
- **Ocean Lab's sites, soils and tides are illustrative parameter sets**, not survey data. No hardware
  was built.
- **Nothing here certifies manufacturing.** A valid solid, a passing print check and a clean solver
  run are design evidence, not a guarantee that a part prints, machines or survives a load.

## If something looks wrong

| What you see | What it means |
|---|---|
| A tile is dimmed with a lock glyph | The app is installed but your login is not provisioned for it. Clicking follows the link to the access page rather than opening a dead frame |
| A lab's page says the engine container is not answering | Run the install command the banner prints — see the section above |
| **Explore the room** does nothing visible for a while | The drone is flying frontier to frontier; the 3-D panel fills as sweeps are integrated. The map starts entirely unknown on purpose |
| A drafted plan is refused with a reason | The planner or the live re-validation rejected a step — unknown space, a keep-out, reach, the tip budget. The reason names which one |
| CAD Studio shows a feature "skipped" | The kernel refused it (a fillet radius larger than the edge allows). The part stays at its last good build — fix the number and it rebuilds |
| Scan to Print's downloads disappeared after an edit | Changing measurements, settings, photos or view assignments retires the old report. **Reconstruct** again |
| The Animatronics rig will not play | It is not armed, or the supply budget refused that motion. Rehearse first — rehearsal never needs arming |

Design rationale for the shelf lives in the ADRs: ADR-150 (oshal repository: `docs/adr/150-deterministic-object-reconstruction-scan-to-print.md`)
(Scan to Print), ADR-151 (oshal repository: `docs/adr/151-eyes-and-hands-embodied-swarm.md`) and
ADR-152 (oshal repository: `docs/adr/152-embodied-physics-and-training-lab.md`) (Embodied Swarm),
ADR-153 (oshal repository: `docs/adr/153-iterative-cad-kernel-cad-studio.md`) (CAD Studio),
ADR-154 (oshal repository: `docs/adr/154-local-electromechanical-lab-circuit-lab.md`) (Circuit Lab),
ADR-155 (oshal repository: `docs/adr/155-drone-relay-chains.md`) (Drone Relay) and
ADR-156 (oshal repository: `docs/adr/156-animatronic-props-as-a-peripheral-kind.md`) (Animatronics).
