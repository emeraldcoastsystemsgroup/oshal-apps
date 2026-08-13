# portrait-studio — BACKLOG

Open work on the packaged portrait app. Every entry has a done-when so scope does not have to be
guessed later.

**Posture:** the package ships and runs (v1.4.0). Camera capture landed — Step 1 now takes a photo
from a file, a live in-page camera, or the OS camera app, all through one validation rule and one
crop stage (see [README.md](README.md)). What is left is the Drive source and one honest gap in how
the camera work is guarded.

---

## A. The camera's DOM wiring has no standing guard

`tests/capture.spec.js` covers every source *decision* — which mode a browser gets, the messages,
the lens, the frame box — and mutation-testing confirms it goes red when those are broken. It does
not cover the *wiring*: that the surface actually calls those functions, opens the modal, and stops
the tracks.

The wiring proof exists and passes — `tests/browser/camera-proof.js`, a real Chromium with a fake
camera device, 23/23: live preview → snap → crop stage → generate enabled, retake offered, tracks
`live` → `ended` on close, plus the desktop-hidden-button and phone-camera-app fallbacks. It is
**run by hand**, because it needs Playwright and the package runner is deliberately zero-dependency:

```
node portrait-studio/tests/browser/camera-proof.js --playwright <framework-checkout>/node_modules/playwright
```

So a refactor that leaves `PortraitCapture` correct but unwired would still ship green through the
automated gate. That is the residual gap, stated rather than papered over.

**Done when:** the store gate itself runs a browser-level capture check (not a skip), or the choice
to keep the runner dependency-free is accepted deliberately — with the command above kept in the
release checklist rather than living only in this file.

---

## B. Widen Drive access so the picker can actually see the user's photos

The picker itself is **built and not blocked** — Step 1 browses every storage source the caller has
connected through the framework's one rail (`/api/files/roots|browse|download`), so OSHAL Storage,
Career, Dropbox and GitHub all work today. Only Google Drive comes up short, and it degrades
honestly rather than breaking: the folder reads empty with a message naming the cause.

**The cause.** The Google connector ships `openid email gmail.readonly gmail.send calendar.readonly
drive.file` (`src/app/routes/connector-provider-registry.ts` in the core repo). `drive.file` is
**per-file access to files the app itself created** — it cannot list or read a photo the user took
on their phone. So Drive is connected, the browse call succeeds, and the listing is legitimately
empty. Two ways forward, neither of which this package can decide:

| option | what it costs | verdict |
|---|---|---|
| **Google Picker** — the user selects the file in Google's own picker; the app gains `drive.file` access to exactly that file | an API key + app ID as operator config, and a CSP change: the Picker loads `https://apis.google.com/js/api.js`, while `script-src` today is `'self'` (+ nonce / `strict-dynamic`) with **no env knob for an extra script host** (`src/features/security/hardening/strict-csp.ts`) — adding one is a core change | **recommended** — keeps the connector scope where ADR-080 deliberately left it |
| **Add `drive.readonly`** to `GOOGLE_CONNECT_SCOPES` — the existing browse rail then works unchanged, and every other Drive-touching surface gains the same reach | `drive.readonly` is a Google **restricted** scope: production use needs app verification plus a CASA security assessment, every existing Google connection must reconnect, and it widens what *every* feature can read for *every* user | a security-boundary change, not a Portrait Studio feature — do not slip it in under this entry |

Whichever is chosen, the constraints the picker already honours must survive it: bytes land in the
**client-side crop stage** like any other photo (no server-side "fetch straight into generation"
path that skips the crop, the 20 MB ceiling and the image-MIME check), and non-image and
Google-native files stay filtered out **before** the download — `readBytes` exports Google-native
documents as PDF/text, which are not pictures.

**Done when:** a user can pick a photo they did not create from Drive and generate from it; the
choice is recorded in the core backlog entry that owns it; no surface depends on report-only CSP to
load its scripts; and the empty-folder message stops being reachable for a Drive account that does
have photos.

---

## C. Store-package guard reach

`tests/capture.spec.js` and `tests/ops.spec.js` run from `node tests/run.js`, which the store gate
can call. The browser proof (entry A) cannot. Worth deciding once for the store repo rather than
per package: whether packages may declare an optional browser-level suite that the gate runs when
a framework checkout is present, instead of every package inventing its own answer.

**Done when:** the store repo documents one convention for package-level browser tests, and this
package either adopts it or records why it opts out.
