# Scan to Print — user guide (as-built)

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

## Scan to Print — photographs in, a measured mesh and a drawing out

Photograph an object from its six sides (or film it, or import a LiDAR point cloud), enter one ruler
measurement, and get an engineering drawing, a watertight 3D model, and — behind an explicit
confirmation — a print job on your own printer.

**Where:** rail tile **Scan to Print**, group **Engineering** — `/cockpit/?app=scan-to-print`.

### Try this first

1. **New object** and name it.
2. **Add photos** from files and assign each a view — front, top and right are the minimum for a
   solid. On a phone, **Use camera** gives a viewfinder with a framing line per view, and **Record
   six views** counts down through all six. **Import .ply** takes an iPhone/iPad Pro LiDAR capture
   instead and skips the photo logic entirely.
3. Enter at least one measured extent in millimetres (**Width X**, **Depth Y**, **Height Z**) and
   **Save scale**.
4. Choose **Resolution** and **Smoothing**, then **Reconstruct**.
5. Read the report: extents with their provenance (known / derived / assumed), volume, facets, the
   printable verdict, the **print checks** (thinnest wall, steepest overhang against a nozzle and
   layer height) and the warnings. Download STL, OBJ, the third-angle SVG sheet and the report.
6. **Open in CAD Studio →** hands the front / top / right outlines to CAD Studio in world
   millimetres, where they become a real CAD part with holes, fillets and a STEP export.
7. To print, open **Printers** at the top of the object list and **Register a printer**. That is
   either an OctoPrint, Moonraker/Klipper or PrusaLink host (label, base URL, API key), or a Bambu
   Lab printer on your home network (its address and 8-character LAN access code; the app reads its
   serial and model from the printer and slices for it in its OrcaSlicer engine). Then **Send to
   printer…** and confirm.
8. Agents can print too. Jarvis, or the app's Scan to Print bot, can list your printers and objects,
   read a printer's live state and send a printable object with the print tools. Every send asks you
   first. A print starts by itself only on a printer whose **auto-start** you turned on; otherwise the
   file waits on the printer for you to press Print. A Bambu Lab printer also needs **LAN Only** and
   **Developer Mode** on (Settings → Settings → LAN Only) before oshal can start it.

### Real vs simulated

The geometry is deterministic — same photos, same ruler number, same bytes — and there is no model in
the geometry path. The honest limits: the photo lane produces the **visual hull**, so cavities,
undercuts and holes that no view sees are filled solid (the depth/LiDAR lane is what recovers them);
photos are assumed square-on, and skew is reported as a residual rather than corrected; an extent no
view shows is assumed equal to the measured one and flagged; the print checks are advice, not a
slicer. Printing: the OctoPrint, Moonraker and PrusaLink hosts are proven against a fake network; a
Bambu Lab P2S is proven live for registration, status and upload; a print *started* by oshal has not
yet been proven on a real printer (the package's BACKLOG B19).

### Where the artifacts land

Jobs, images, printers and submissions are rows in Postgres scoped to you; printer API keys and Bambu
Lab access codes are stored as owner-key ciphertext, never plaintext. Slicing for a Bambu Lab printer
runs in the package's own engine container, `oshal-scan-to-print-engine`. The job files sit under the shared workspace at
`<workspace>/scan-to-print` (override with `SCAN_TO_PRINT_DATA_DIR`).

### What it needs that is not there yet

Your own printer host, registered in the app. G-code slicing needs a slicer command configured on the
deployment (`SCAN_TO_PRINT_SLICER_CMD`); without it, choose **STL (host slices)** and let OctoPrint
slice. The depth-image upload lane is API-only — there is no button for it on the page yet.

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
