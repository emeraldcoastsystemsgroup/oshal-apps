# Scan to Print — printer and slicer setup (runbook)

Everything in this runbook is a person-typed setting or an environment variable. Nothing in the
package hard-codes a printer, a host, a slicer or a model.

## 1. Register a printer (in the app)

Open `/cockpit/?app=scan-to-print`, reconstruct any object, expand **Register a printer** in step
4, and enter:

| Field | Value |
|---|---|
| label | anything you like |
| kind | `OctoPrint`, `Moonraker (Klipper)` or `PrusaLink` |
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

- **Nothing leaves the swarm until you click *Send to printer…* and accept the confirmation.** The
  route answers `428 confirmation_required` without `confirm: true`; the surface always asks.
- Every attempt — accepted or refused by the host — is a row in the job's submissions list with
  the host's answer.
- Bots can list your jobs and printers to brief you; no bot can send a job.
