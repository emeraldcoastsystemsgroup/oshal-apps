# Scan to Print — printer and slicer setup (runbook)

Everything in this runbook is a person-typed setting or an environment variable. Nothing in the
package hard-codes a printer, a host, a slicer or a model.

## 1. Register a printer (in the app)

Open `/cockpit/?app=scan-to-print`, expand **Printers** at the top of the list of objects (no object
needs to be open; on a narrow screen the list sits above the steps), and under **Register a printer**
enter:

| Field | Value |
|---|---|
| label | anything you like |
| kind | `OctoPrint`, `Moonraker (Klipper)`, `PrusaLink`, or `Bambu Lab (home network)` (next section) |
| base URL | `http://<host>[:port]` — the host the swarm's api container can reach on your network. Loopback (`localhost`, `127.x`) and the cloud-metadata address are refused; credentials in the URL are refused. |
| API key | the host's API key (see below). Stored **only** as owner-key ciphertext through the personal-data vault; never shown again; never in a log or a URL. |

Click **status** next to the printer to prove the swarm reaches it. `offline` means the host did
not answer at all; `unknown` means it answered without a recognisable state.

### Where the API key comes from

- **OctoPrint** — Settings → API → *Global API key* (or an Application key). Upload endpoint used:
  `POST /api/files/local`; STL and G-code accepted; a print is started only for G-code.
- **Moonraker / Klipper** (Mainsail, Fluidd) — enable API-key auth in `moonraker.conf`
  (`[authorization]`) and read the key from the web UI's *API key* page. Endpoint used:
  `POST /server/files/upload` with `print=true` when you tick *start printing*; G-code only.
- **PrusaLink** (Prusa MK4/XL/MINI+) — Printer settings → Network → PrusaLink → *API key*.
  Endpoint used: `PUT /api/v1/files/usb/<name>` with `Print-After-Upload` when starting; G-code
  (`.gcode`, `.bgcode`) only.

### Bambu Lab printers (home network)

Choose **Bambu Lab (home network)** and enter only:

| Field | Value |
|---|---|
| printer address | the printer's IP (or host name) on your network. On a P2S or an H2 printer: Settings → Settings → LAN Only (the *IP* row); other Bambu Lab printers show it on their LAN Only (LAN mode) settings page. No `http://`, no port. |
| LAN access code | the 8-character *Access Code* on the same screen. Stored only as owner-key ciphertext, never shown again. |

The package does the rest, before anything is stored: it reads the printer's **serial** and **model**
from the printer's own TLS certificate (the serial is the certificate's name; the issuing device
CA names the model code, e.g. `N7` = P2S), **pins that certificate** (its SHA-256 fingerprint — the
printer presents the same one for status and for uploads), proves the access code with a real
status session, and starts the slice profile from the nozzle the printer reports. Every later
connection refuses, before the access code is sent, any device that does not present the pinned
certificate — the serial alone is public on the LAN, so it is not treated as proof. If the printer
is replaced or factory-reset, remove it and add it again.

What the printer needs:

- **Storage.** Files go to the printer's USB stick or SD card (P2S: the USB-A port on the top left).
  With none inserted the upload is refused and the reply says so.
- **To let oshal START prints** (not just upload them): LAN-only mode with **Developer Mode** on the
  printer. Until then the printer accepts start commands only when they are signed by the vendor's
  own apps; the package reads that from the printer and never sends a start it would refuse — the
  file is uploaded and you press Print on the printer. **status** shows which mode the printer is in.
  On a P2S (and the H2 series): Settings → Settings → scroll to **LAN Only** → turn on *LAN Only*,
  confirm, then turn on *Developer Mode*. While LAN Only is on, Bambu Handy and the vendor cloud no
  longer reach the printer, and firmware updates come from Settings → Firmware with an offline
  package on a USB drive, or after switching LAN Only off for a while. Turning Developer Mode on
  changed neither the access code nor the certificate of the P2S it was tried on (firmware
  01.01.02.00, 2026-10-06), so its registration kept working.
- **Firmware.** Every connection to the printer, broker (:8883) and file server (:990), offers TLS
  1.2 at most. A P2S on firmware 01.02.00.00 was reported never to answer a TLS 1.3 hello on :8883
  (the handshake hangs; ha-bambulab #2072) while answering TLS 1.2 at once; the file server speaks
  only TLS 1.2 in any case. Not yet tried against a printer on 01.02.00.00 or later.
- **Material.** A start feeds the AMS slot holding the sliced filament type; if every slot reports a
  different material, nothing is started and the reply says what is loaded. Slots whose material the
  printer does not know (no RFID tag) are used as they are.
- **Slice settings** (per printer, *slice settings* in the list): build plate (`Textured PEI Plate`,
  `High Temp Plate`, `Cool Plate`, …), filament profile (`Bambu PLA Basic`, `Bambu PETG HF`, …) and
  nozzle. A printer checks the plate it sees against the file and stops on a mismatch, so set the
  plate you actually use; unset, each model's own default plate is used.

## 2. Slicing: STL → G-code

Moonraker and PrusaLink accept only G-code. Three ways to get it:

1. **Configure a slicer on the swarm** (recommended). On the machine running the api container
   set, in the swarm's env file:

   ```
   SCAN_TO_PRINT_SLICER_CMD="/usr/bin/prusa-slicer --export-gcode --load /config/printer.ini -o {output} {input}"
   SCAN_TO_PRINT_SLICER_TIMEOUT_MS=300000
   ```

   `{input}` and `{output}` must appear as whole arguments (they are substituted as argv tokens,
   never through a shell). Any slicer CLI works — PrusaSlicer, OrcaSlicer, CuraEngine — as long as
   it reads an STL and writes a G-code file to the path you give it. The slicer binary must exist
   **inside the api container** (or on the host if the api runs on the host); the stock image does
   not ship one. Then choose **G-code (sliced)** in step 4: the package slices on demand and caches
   `model.gcode` in the job until the next reconstruction.
2. **Let OctoPrint slice.** Choose **STL (host slices)** — OctoPrint stores the STL and its
   slicing plugin (if installed) takes it from there. The swarm never auto-starts an STL.
3. **Slice yourself.** Download the STL from step 3, slice in your desktop slicer, and print from
   there. The drawing and the model are yours either way.

`GET /api/scan-to-print/capabilities` reports `printers.slicerConfigured` so you can check the
setting took without sending anything.

**Bambu Lab printers are sliced by the package's own engine container** (OrcaSlicer, pinned by
version and sha256 in `engine/orcaslicer-lock.txt`, using the vendor's own printer, process and
filament profiles), not by `SCAN_TO_PRINT_SLICER_CMD`. Install or update it on the box with:

```
docker exec <api-container> sh /app/workspace-shared/deployed-apps/scan-to-print/engine/install-engine.sh
```

It builds `oshal-scan-to-print-engine:local` from `ubuntu:24.04`, starts it in its own compose project
on the stack network (alias `scan-to-print-engine:7414`, no host port, read-only, no capabilities),
and proves it by slicing a 20 mm cube for a P2S. If it is missing or out of date, the app and the
print service answer with the reason and this exact command (`GET .../printers/profiles`,
`capabilities.slicerEngine.installHint`) rather than slicing with something else.

## 3. Video frames

Video uploads are sampled with ffmpeg (shipped in the api image). Optional settings:

```
SCAN_TO_PRINT_FFMPEG_BIN=ffmpeg      # program name or path
SCAN_TO_PRINT_FRAME_FPS=1            # frames per second sampled
SCAN_TO_PRINT_MAX_FRAMES=24          # cap per video (1..120)
```

Only the frames you assign to a view are used. Pick the ones that look square-on.

## 4. Job files

Job files (stored photos, silhouettes, STL/OBJ/SVG/report, G-code) live under
`SCAN_TO_PRINT_DATA_DIR`, else `<shared workspace root>/scan-to-print` (the `oshal_workspace`
volume in the compose stack). Deleting a job in the app deletes its directory.

## 5. What is sent, and when

- **From the app, nothing leaves the swarm until you click *Send to printer…* and accept the
  confirmation.** The route answers `428 confirmation_required` without `confirm: true`; the
  surface always asks, and a print starts only when you tick *start printing*.
- **From the print service (§6), a job is sent when its caller asks**, and it **starts on its own
  only on a printer whose owner turned auto-start on** — the one gate the service enforces for every
  caller. Auto-start is off when a printer is added; the owner turns it on in the app (*turn
  auto-start on*, with a confirmation) on the OIDC-only route, which no service caller can reach. It
  is re-read at the last moment — for a Bambu Lab printer inside the per-printer start queue, right
  before the start command; for an HTTP host right before the upload, which carries the start — so
  switching it off stops a job already on its way; if it cannot be read, nothing is started. With it
  off, the file is uploaded and the reply says to start it on the printer. A Bambu Lab printer
  additionally refuses while it requires vendor-signed commands (§1), while it is busy, or when no
  loaded AMS slot holds the material. A caller's own machine instructions — a sliced `.gcode.3mf`
  or raw G-code posted as it is — are uploaded and never auto-started; auto-start covers what this
  package slices (scan jobs and posted STLs).
- **Agents** — Jarvis, this app's operator bot, or any bot assigned the tools — print through the
  `print-to-3d-printer` package tool, which ships as **ask**: each call waits for a person's approval
  until the operator sets that agent's grant to auto in the cockpit's agent tool settings (the tools
  share the `scan-to-print` tool group). Since 0.7.0 the tools run in-process as the person the agent
  acts for (§6), so they work under core enforce mode. The grant applies to calls made through the
  tool; a caller that holds the swarm's service secret and calls the service directly is gated by
  auto-start alone.
- Every attempt — accepted or refused by the host — is a row in the submissions with the host's
  answer and who asked (`person` or `service`).
- Until 0.6.0 no bot could send a job. The operator reversed that on 2026-10-06 ("build it into the
  app as a service"), and the same day decided that agents use the tools they are assigned and that a
  bot can call the printer (0.7.0).

## 6. The print service (for agents, persona scripts and other apps)

Mounted `service-or-oidc` at `/api/scan-to-print/service`: a signed-in person (a browser session,
e.g. another app's page), or a framework caller with the swarm's service secret **and** the user it
acts for (`X-Oshal-User-Sub-B64`, or the legacy `X-Oshal-User-Sub`). Every database call runs as that
user, never as operator; a caller sees only that user's printers and rows. It cannot change any
printer setting.

**Core application authorization (ADR-149) and the agent tools.** On a box where it runs in
`enforce` mode (the default), core admits a package request only with a verified identity — a
session or a verified workload delegation — so a bare service-secret call to these routes is refused
`401 authorization_identity_required` before this package runs. Agents therefore do not call these
routes: since 0.7.0 the five agent tools are in-process **package tools** (executor builtin/package,
src-routes/print-tools.ts). Core runs each one under the verified person the agent acts for and
authorizes it against the package's catalog first; the tool then calls the same functions these
routes call, with that person as the owner. A signed-in session reaches the routes in both modes.

**The catalog and the `maker` role.** 0.7.0 declares an ADR-149 catalog (`authorization.yaml`): one
`scan` resource, five permissions (`app.open`, `scan.read`, `scan.edit`, `printer.manage`,
`print.send`) and one `maker` role that carries all of them, as the `@app-admin` fallback did before.
Every route, tool, the operator bot and the photo intake are bound. Installing 0.7.0 over an earlier
version is a breaking catalog change: the first start refuses with
`authorization_catalog_migration_required` (Scan to Print is unmounted until then), an administrator
approves the catalog review, the next start removes the old `@app-admin` grant, and each person who
uses the app needs the `maker` role.

| Call | What it does |
|---|---|
| `GET /jobs` | the user's scan jobs: id, title, state, source, `printable`, last change |
| `GET /printers` | the user's printers: id, label, kind, model, `autoStart`, slice profile (never a key) |
| `GET /printers/{id}/status` | live state (Bambu: progress, layers, minutes left, whether oshal may start prints, health codes) |
| `POST /jobs/{jobId}/print` `{ printerId? }` | print a printable scan job's current model; starts only under auto-start |
| `POST /print` multipart `model` (+ `printerId`) | print a posted `.stl` (sliced for the printer; starts only under auto-start), `.gcode.3mf` (uploaded as is, never auto-started) or `.gcode` (HTTP hosts; uploaded, never auto-started) — up to 64 MiB; the stored name gets a short unique suffix |
| `GET /submissions` | the user's latest 50 attempts |

`printerId` may be omitted when the user has exactly one printer. The reply's `outcome.started` is
the only statement that a print began; `outcome.message` says why not otherwise.

Agent tools (manifest, package tools in the `scan-to-print` tool group): `scan-to-print-capabilities`,
`print-service-jobs`, `print-service-printers` and `print-service-printer-status` (read-only, auto)
and `print-to-3d-printer` (`{ jobId, printerId? }`, ask). A print's reply is the route's answer plus
`ok` and `status`, so a refusal the route answers with 4xx — a stale or unprintable model, a busy
job, no printer chosen or found — comes back as data the agent can report; the status tool answers
`{ ok, printer, status }` with the printer's own state. A malformed id, an input field the tool does
not take, a missing signed-in person or an internal failure is a tool error instead. On a legacy-mode box, a persona script on the stack network can still call the routes:

```
curl -s -X POST http://oshal-local-api:5000/api/scan-to-print/service/print \
  -H "X-Service-Secret: $SWARM_SERVICE_SECRET" -H "X-Oshal-User-Sub: $OSHAL_USER_SUB" \
  -F model=@bracket.stl
```
