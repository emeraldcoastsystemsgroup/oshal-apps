# Portrait Studio: parity audit against Lensa, Aragon and Photoshop generative tools

`portrait-studio` 1.17.10 turns one cropped photo (person, pet, or up to six faces in a group) into one generated portrait, with style presets and swappable background, clothing, hat, prop, finish and framing. It is measured against Lensa (phone app: avatars, AI art, retouch, eraser) and Aragon (web headshots from several selfies), with Photoshop generative tools as the reference for editing a result. In `1.17.10`, `portrait-artist` gained read tools (`portrait-list`, `portrait-read`, `portrait-catalog`, `portrait-provider-status`, `portrait-export`) and approval-held action tools (`portrait-create`, `portrait-rerun`, `portrait-rename`, `portrait-delete`, `portrait-handoff`), alongside a gallery **Run again** button on finished and failed rows.

## Table

How to read it:
- Our side comes from reading the snapshot. Nothing here was run. `studio.html` means `portrait-studio/tools/portrait-studio.html`. Routes are in `portrait-studio/src-routes/`.
- Generation needs an image provider the kernel will give this person; otherwise the route answers 503 (`portrait-studio-routes.ts`). That applies to row 10.
- Letters in brackets are sources, listed at the end. [K] means general product knowledge, not re-read. "n/c" means not confirmed. Tier is the industry split: basic is in a free or entry product; pro is paid or a higher plan.

| # | Capability | Tier | Industry mobile | Industry desktop | Our UX control | Our concierge tool | Status |
|---|---|---|---|---|---|---|---|
| 1 | Upload a photo | basic | Lensa: yes [A] | Aragon: yes [C] | `#pickFileBtn`, `#fileInput`, `studio.html` | none | UX only |
| 2 | Take a photo with the camera | basic | Lensa: n/c | Aragon: selfies recommended, camera n/c [C] | `#useCameraBtn`, `#camSnap`, `studio.html`; `tools/portrait-capture.js` | none | UX only |
| 3 | Choose a photo from own files | basic | n/c | n/c | `#browseFilesBtn`, `studio.html` | none | UX only |
| 4 | Crop the head | basic | n/c | n/c (these products ask for several photos instead) | crop box, `#resetCrop`, aspect buttons, `studio.html` | none | UX only |
| 5 | Find faces automatically | basic | n/c | n/c | `#findFacesBtn`, `studio.html`; `tools/portrait-face.js` | none | UX only |
| 6 | Group portrait from several faces | pro | n/c | n/c | `#modeGroup`, `#addFaceBtn`, `#removeFaceBtn`, `studio.html` (2 to 6 faces) | none | UX only |
| 7 | Pick a style or preset | basic | Lensa: 200+ styles [A] | Aragon: curated outfits and backgrounds [C] | mode buttons and the profile grid, `studio.html` | `portrait-catalog` (read styles/layers) + `portrait-create` (`mode`, `style`) (`1.17.10`) | both |
| 8 | Swap background, clothing, hat, prop, finish, framing | pro | n/c | Aragon: background, outfit, pose, others; more on higher plans [C] | `#tuneBackground`, `#tuneAttire`, `#tuneHeadwear`, `#tuneProp`, `#tuneFinish`, `#tuneFraming`, `studio.html` | `portrait-catalog` + `portrait-create` swap fields (`1.17.10`) | both |
| 9 | Free-text notes, brand colors in words | basic | Lensa AI art: text prompt [A] | n/c | `#notes`, `#brandNotes`, `studio.html` | `portrait-create` `notes` (`1.17.10`) | both |
| 10 | Generate a portrait | basic | Lensa: paid packs or subscription [A][B] | Aragon: paid plans [C] | `#generateBtn`, `studio.html`; `POST /portraits` | `portrait-create` (held for approval, owned photo reference + daily cap) + `portrait-provider-status` (`1.17.10`) | both |
| 11 | Train on several photos of the person for a stronger likeness | pro | Lensa: 15 to 20 photos [A] | Aragon: several selfies [C] | none (one cropped image or one reference sheet per run) | none | missing |
| 12 | Many results from one run, pick favorites | pro | Lensa: packs of many avatars [B] | Aragon: 40 to 100 by plan [C] | none (one portrait per generate) | none | missing |
| 13 | Run again with the same settings | basic | n/c | Aragon: free redo through support [C] | `↻ Run again` (`[data-rerun]`) button on finished and failed gallery rows, `studio.html`; `POST /portraits/:id/rerun` (`1.17.10`) | `portrait-rerun` (held for approval, counts toward daily cap, `1.17.10`) | both |
| 14 | Change a finished portrait: background, clothes, pose | pro | Photoshop phone: Generative Fill [D] | Aragon: changers and pose editor [C] | none in the app; Send to... can hand a result to another app (row 22) | none | missing |
| 15 | Retouch: smooth skin, remove blemish, brighten | basic | Lensa: retouch [B] | Aragon: Blemish Remover [C] | none | none | missing |
| 16 | Erase an object or person | basic | Lensa: Advanced Eraser [B]; Photoshop phone: Remove Tool, paid [D] | Photoshop: yes [K] | none | none | missing |
| 17 | Filters and color looks on a result | basic | Lensa: filters and tones, AI effects [B] | n/c | none (finish is chosen before generating) | none | missing |
| 18 | See my portraits and their state | basic | Lensa: n/c | Aragon: view favorites [C] | `#gallery`, `#galleryGrid`, `studio.html` | `portrait-list`, `portrait-read`, `portrait-provider-status` (`1.17.10`) | both |
| 19 | Download the original | basic | Lensa: save up to 4K [A] | Aragon: 896x1088 to 1792x2176 by plan [C] | download link in gallery rows, `studio.html`; `GET /portraits/:id/image` | `portrait-export` (`size: original`) and `portrait-read` (`1.17.10`) | both |
| 20 | Passport and print sizes | pro | n/c | n/c | 600, 300, 4x6, 6x4 links in gallery rows, `studio.html`; `GET /portraits/:id/export` | `portrait-export` (`linkedin`, `square`, `passport`, `300`, `600`, `print`, `4x6`, `portrait`, `6x4`, `landscape`, `1.17.10`) | both |
| 21 | Email a portrait | basic | Lensa: share to social [A] | n/c | none that works: `POST /portraits/:id/email` always answers 503 (`portrait-studio-routes.ts`), and the Email button is removed because `/permissions` reports it unavailable (`portrait-authorization.ts`, `studio.html`) | none | missing |
| 22 | Send to another app | basic | n/c | n/c | Send to... button, `studio.html` (only when the core offers it) | `portrait-handoff` (held for approval, `POST /portraits/:id/handoff`, `1.17.10`) | both |
| 23 | Rename a portrait | basic | n/c | n/c | Rename button, `renamePortrait`, `studio.html` | `portrait-rename` (held for approval, `PATCH /portraits/:id`, `1.17.10`) | both |
| 24 | Delete a portrait and its files | basic | n/c | Aragon: delete account and data [C] | delete button, `studio.html`; `DELETE /portraits/:id` | `portrait-delete` (held for approval, `DELETE /portraits/:id`, `1.17.10`) | both |

## Backlog

Ordered by what people hit first.

- **CREATE-TOOL-PORTRAIT-01: Give the concierge read tools.** *Delivered in `portrait-studio` 1.17.10.* Added read-only concierge tools `portrait-list` (`GET /portraits`), `portrait-read` (`GET /portraits/:id`, 404 on missing/foreign), `portrait-catalog` (`GET /catalog`, including export formats), and `portrait-provider-status` (`GET /provider-status` with provider availability and 24-hour daily cap usage/remaining), bound under existing permissions.
- **CREATE-TOOL-PORTRAIT-02: Let the concierge make a portrait.** *Delivered in `portrait-studio` 1.17.10.* `POST /portraits` now accepts owned JSON photo references (`sourceProjectId`, `sourceAssetId`, `portraitId`) in addition to browser multipart uploads, enforcing exact ownership and the same daily cap, with approval-held tool `portrait-create`.
- **CREATE-TOOL-PORTRAIT-03: Run again with the same settings.** *Delivered in `portrait-studio` 1.17.10.* Added owner-scoped `POST /portraits/:id/rerun` (counting toward the daily cap and supporting both finished and failed rows), a **↻ Run again** button on every finished and failed gallery row in `studio.html` with inline `#galleryStatus` feedback, and approval-held tool `portrait-rerun`.
- **CREATE-TOOL-PORTRAIT-04: Several results from one run.** A count choice with cost shown first, and a way to mark favorites.
  Done when: choosing 4 makes 4 portraits grouped as one run; a person keeps two and deletes the rest with one action. The concierge can ask for a count.
- **CREATE-TOOL-PORTRAIT-05: Edit a finished portrait in place.** Change background, clothes, hat or framing on a result; keep the original.
  Done when: a person changes only the background of a finished portrait, sees before and after, can keep or reject, and the concierge can propose the same change.
- **CREATE-TOOL-PORTRAIT-06: Retouch and eraser.** Blemish removal, skin smoothing, brighten, erase a marked object; here or by a direct Open in Image editor that returns.
  Done when: a person removes a marked blemish and the new image keeps the rest of the face in a side-by-side, with undo. The concierge can start it.
- **CREATE-TOOL-PORTRAIT-07: Decide about email and clean the dead path.** Either make email work through the person's own mailbox, or remove the modal and its code.
  Done when: Email sends a real message through a connected test mailbox, or the page has no email code and the 503 route is gone. A concierge tool follows the same choice.
- **CREATE-TOOL-PORTRAIT-08: Use several photos of one person.** Take more than one reference for a stronger likeness, with a clear statement of how long they are kept.
  Done when: a person adds 5 photos of one face, generates, and a side-by-side against a one-photo run on a fixed fixture set shows a measurable likeness gain.
- **CREATE-TOOL-PORTRAIT-09: Concierge tools for the rest of the gallery.** *Delivered in `portrait-studio` 1.17.10.* Added approval-held `portrait-rename` (`PATCH /portraits/:id`), `portrait-delete` (`DELETE /portraits/:id`), `portrait-handoff` (`POST /portraits/:id/handoff`), and read-only `portrait-export` (`GET /portraits/:id/export-link?size=...`), each bound under existing permissions and documented in `portrait-artist`.
- **CREATE-TOOL-PORTRAIT-10: Filters on a result.** A few looks and a strength control.
  Done when: applying a look makes a new copy, keeps the original, and appears in downloads.

## Sources

Read directly unless marked. App listings describe features in the vendor's own terms; they do not prove quality. Lensa's and Aragon's "desktop" and "mobile" availability is taken from where each product is sold, so most device cells stay n/c.

- [A] Lensa avatars and AI art, App Store listing: https://apps.apple.com/us/app/lensa-ai/id1661127446
- [B] Lensa photo editor, App Store listing: https://apps.apple.com/au/app/id1436732536?l=en-au
- [C] Aragon headshots page: https://www.aragon.ai/headshots
- [D] Photoshop App Store listing: https://apps.apple.com/za/app/id1457771281
