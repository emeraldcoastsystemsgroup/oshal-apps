# Scan to Print (`scan-to-print`) parity audit

## 1. What it is

`scan-to-print` (0.7.3) turns six photos, a video or a `.ply` point cloud plus one ruler measurement into a watertight STL and OBJ and an engineering drawing, then sends the model to the person's own printer. It has no AI in the geometry. Its screen is `tools/scan-to-print.html` with `tools/scan-to-print.js`. It is measured against two kinds of product: phone 3D scanners (Polycam) and slicers (PrusaSlicer, Bambu Studio), plus Bambu Handy as the phone companion for a printer. The concierge (`scan-to-print-operator`) has five tools, all on the printing side: capabilities, jobs, printers, printer status and print. It can guide but cannot start a scan, add a photo, set a scale or reconstruct. The persona calls this deliberate: it "never runs a reconstruction". Under the owner's rule it is a gap.

**How to read the table.** "Yes†" means general product knowledge not re-checked against a source in this audit. Sources disagreed on some Polycam plan limits (export per plan and free capture caps), so check those in the app before relying on them. Sources also disagree on whether Bambu Handy can slice: most say no, but it can start prints from its model library. I read the code and did not print anything. `BACKLOG.md` B23 says a Send to printer through the kernel has been proven once, on a part of 12 triangles, and B19 records the live print test as deferred.

## 2. Parity table

| Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|
| New scan job, delete a job | basic | Polycam: Yes | Yes | `#new-job`, `#delete-job` | none. `print-service-jobs` only reads | UX only |
| Guided capture with the camera | basic | Polycam: Yes | not applicable | `#open-camera`, `#cam-shutter`, `#cam-auto`, `#photo-capture` | none | UX only |
| Add photos or a video | basic | Polycam: Yes | Polycam web: Yes† | `#photos`, `#video`, `#suggest-views`, `#suggest-all` | none | UX only |
| Assign each photo a view | ours | not applicable | not applicable | `<select>` on each image card in `scan-to-print.js` | none | UX only |
| Import a LiDAR point cloud | pro | Polycam: captures it | Yes† | `#pointcloud`, `#pc-voxel`, `#pc-units`, `#pc-up` | none | UX only |
| Capture LiDAR live on the phone | basic to pro | Polycam: Yes (free per sources) | not applicable | none (`BACKLOG.md` B14 open) | none | missing |
| Upload a depth image | pro | not confirmed | not confirmed | none (`BACKLOG.md` B1 says no surface control; `POST /jobs/:id/depth` exists) | none | missing |
| Set real-world scale | basic | Polycam: Yes† | Yes† | `#dim-x`, `#dim-y`, `#dim-z`, `#save-dims` | none | UX only |
| Build the model | basic | Polycam: Yes | Yes | `#reconstruct`, `#res`, `#smooth` | none | UX only |
| Colour and texture on the model | basic | Polycam: Yes† | Yes† | none. The hull has no texture; output is STL and OBJ geometry | none | missing |
| Clean up the mesh (crop, cut, fill, smooth a region) | basic | Polycam: Yes (edit tools, free per sources) | PrusaSlicer: cut tool | none. Re-run with other settings, or "Open in CAD Studio" | none | missing |
| Move, rotate, scale the model before printing | basic | Handy: not confirmed | PrusaSlicer: Yes | none | none | missing |
| View the model in 3D | basic | Polycam: Yes | Yes | `#viewer` (orbit, zoom, pan) | none | UX only |
| Read the report and drawing | pro | not confirmed | not confirmed | `#report`, `#drawing` | none. `print-service-jobs` returns state and whether printable | UX only |
| Download STL, OBJ, SVG | basic | Polycam: STL on paid plan | Yes | Download links in `renderReport`, `scan-to-print.js` | none | UX only |
| Add and manage printers | basic | Handy: Yes | Yes | `#printer-form`, printer rows | `print-service-printers` reads; adding is on screen only (by design, no key passes through the service) | UX only |
| Choose nozzle, filament and plate | basic | not confirmed | Yes | `window.prompt` dialogs in `scan-to-print.js` | none. `print-service-printers` reads the profile | UX only |
| Layer height, infill, supports, speed | basic to pro | Handy: No (does not slice, per most sources) | PrusaSlicer modes: Yes; Bambu Studio: Yes | none. `slicer_worker.py` uses fixed machine and process profiles | none | missing |
| Layer-by-layer slice preview | basic | Handy: not confirmed | Yes† | none. Only an estimate in a toast | none | missing |
| Send to a printer | basic | Handy: Yes | Yes | `#printer`, `#file-kind`, `#send` | `print-to-3d-printer` (held for approval) | both |
| Start the print | basic | Handy: Yes | Yes | `#start-print` | `print-to-3d-printer`, only when the owner turned auto-start on | both |
| Read printer status and progress | basic | Handy: Yes | Yes | Status action on a printer row (shown in a toast) | `print-service-printer-status` | both |
| See jobs and printers | basic | Handy: Yes | Yes | `#job-list`, `#printer-list` | `print-service-jobs`, `print-service-printers` | both |
| Pause or stop a print | basic | Handy: Yes | Bambu Studio: Yes | none. No such route | none | missing |
| Past submissions | basic | Handy: Yes† | Yes† | `#submissions` | none. `GET /service/submissions` exists without a tool | UX only |

**The mobile and basic/pro picture.** This is the package closest to a mobile-first shape. The camera flow and file capture work from a phone, and the page collapses at 900 px. Basic and pro are not separated. PrusaSlicer's Simple, Advanced and Expert modes are a useful model here, and slicing settings could start at Simple. On phones, Bambu Handy's split is also useful: monitor and start on the phone, and prepare on the desktop.

## 3. Backlog (ordered by what people hit first)

- **CREATE-TOOL-SCAN-TO-PRINT-01: Slice settings a person can set.** Done when: a Simple panel sets layer height, infill and supports, the print uses them, and the sliced file measures the chosen layer height. The concierge can read and change the same settings under approval.
- **CREATE-TOOL-SCAN-TO-PRINT-02: Replace the slice-setting prompts with a form.** Done when: nozzle, filament and plate are dropdowns filled from `/printers/profiles`, not browser prompts, and a bad value cannot be typed.
- **CREATE-TOOL-SCAN-TO-PRINT-03: Mesh clean-up and placement.** Done when: a person can cut off a base or stray part, scale and rotate the model in the viewer, and the STL and print use the result. The concierge can apply the same operations.
- **CREATE-TOOL-SCAN-TO-PRINT-04: Concierge can run the scan.** Done when: tools exist for creating a job, assigning views from photos already sent, setting scale and reconstructing, with a held card, and a chat turn goes from photos to a printable model. The persona rule against running reconstruction is removed.
- **CREATE-TOOL-SCAN-TO-PRINT-05: Pause and stop.** Done when: a running print can be paused, resumed and stopped from the page and by a held tool on each printer kind that allows it, and the reply states what the printer did.
- **CREATE-TOOL-SCAN-TO-PRINT-06: Slice preview.** Done when: a person sees the sliced layers, time and material before sending, and a bad overhang is visible.
- **CREATE-TOOL-SCAN-TO-PRINT-07: Concierge reads the outputs.** Done when: tools return the report, download links and submissions, and "how big is it and did it print?" is answered from them.
- **CREATE-TOOL-SCAN-TO-PRINT-08: Live LiDAR on a phone.** Done when: `BACKLOG.md` B14 and B15 close, and a phone scan lands in a job with no export and upload step.
- **CREATE-TOOL-SCAN-TO-PRINT-09: Depth upload control.** Done when: the page has a control for `POST /jobs/:id/depth` with the required header fields, and a person uploads a range image and sees `lane: depth` in the report.
- **CREATE-TOOL-SCAN-TO-PRINT-10: Texture and better reconstruction.** Done when: the owner decides whether colour capture is in scope. If so, a photo set produces a textured model export, labelled as not for measurement.

## 4. Sources

- Polycam export formats by plan (official help, seen through search; could not be fetched directly): https://learn.poly.cam/hc/en-us/articles/27756102599572
- Polycam plan details and capture modes: https://poly.cam/de-de/basic-plan and https://apps.apple.com/uz/app/id1532482376
- Polycam free-plan details (third-party review): https://skyebrowse-website-d07212f74681.herokuapp.com/news/posts/polycam-review
- PrusaSlicer Simple, Advanced and Expert modes: https://help.prusa3d.com/article/simple-advanced-expert-modes_1765
- PrusaSlicer layout and tools: https://help.prusa3d.com/article/ui-overview_1766
- PrusaSlicer layer height: https://help.prusa3d.com/article/layers-and-perimeters_1748
- PrusaSlicer per-model settings: https://help.prusa3d.com/article/per-model-settings_1674
- Bambu Handy quick start: https://wiki.bambulab.com/studio-handy/handy/bambu-handy-quick-start
- Bambu Studio quick start: https://wiki.bambulab.com/en/software/bambu-studio/studio-quick-start
- Bambu Studio remote control: https://wiki.bambulab.com/en/software/bambu-studio/remote-control
- Handy cannot slice (third party): https://simplyprint.io/features/slicer/bambustudio
