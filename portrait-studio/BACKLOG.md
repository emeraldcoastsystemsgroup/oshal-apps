# portrait-studio — BACKLOG

Open work on the packaged portrait app. Every entry has a done-when so scope does not have to be
guessed later.

**Posture:** version 1.14.1 repairs named-role entry without changing the authorization
catalog. The obsolete subject-only default-deny declaration from before the named
permission migration prevented a current manager from opening the app or seeing
its Test Lab cases. The real outer-mounter regression now proves manager entry and
unassigned, wrong-issuer and revoked refusal without legacy grants. Source verification
and native installation acceptance are recorded separately. On 2026-09-12, installed
1.14.1 exposed all eleven current Lab cases and its selected local-cascade recipe
passed 4/4 with verified cleanup. That checkpoint's native image-picker attempt
was blocked by a Windows prompt. A later check on core `dd7bcaa4` completed the
real picker → Group → Find faces flow with the licensed local photo: the bundled
fallback produced one editable face box and preserved Daylight. No portrait was
generated. The three-engine isolated browser proof remains separate. See the
[dated installed acceptance](../TEST-LAB-ADOPTION.md#portrait-studio-follow-up-2026-09-12).

Version 1.14.0 adds bundled local face detection (D below), following the delivered
1.13.0 application permissions. Earlier entries retain their original acceptance context.
Camera capture landed — Step 1 now takes a photo
from a file, a live in-page camera, or the OS camera app, all through one validation rule and one
crop stage (see [README.md](README.md)). What is left is the Drive source and one honest gap in how
the camera work is guarded.

---

## A. The camera's DOM wiring has no standing guard

`tests/capture.spec.js` covers every source *decision* — which mode a browser gets, the messages,
the lens, the frame box — and mutation-testing confirms it goes red when those are broken. It does
not cover the *wiring*: that the surface actually calls those functions, opens the modal, and stops
the tracks.

**CLOSED 2026-09-14.** The wiring proof is now a `node:test` suite — `tests/browser/camera-proof.js`,
real Chromium over Chromium's own fake capture device — registered as Test Lab case `camera-browser`
and runnable unattended:

```
OSHAL_CORE_ROOT=<framework-checkout> node --test portrait-studio/tests/browser/camera-proof.js
```

Four test points, all asserting: live capture chosen with decoded mirrored frames; snap → crop stage
→ generate enabled → retake offered, and the tracks go `live` → `ended` when the modal closes; the
desktop hidden-button fallback with its reason; and the phone camera-app hand-off with the front lens,
flipping to the rear in character mode. Playwright and the shared picker asset resolve from
`OSHAL_CORE_ROOT` instead of two hand-typed CLI arguments, and a missing input fails the file loudly
rather than skipping. So a refactor that leaves `PortraitCapture` correct but unwired now goes red.

The one part still outside the gate is a **physical** camera — real device enumeration, a human
answering the OS permission prompt, real lens and exposure behaviour. That needs hardware and a
person, is not registered as a Lab case, and is written up under README "Proving the camera on real
hardware".

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

---

## D. Bundled local face finding — implemented in 1.14.0

Group mode's **Find faces** now uses a bundled MIT frontal-face model in a local Worker when
the native API is absent or fails. Actual Chromium, Firefox and WebKit tests run the real
detector over a [public-domain photo](tests/fixtures/README.md); no external source or image
upload is used. WebKit is the automated Safari-engine proof, not a claim that every physical
Safari/device combination was tested. Manual boxes and the existing detector-to-box helper
remain intact. Finding may be cancelled; later photos, mode changes, edits and permission
refreshes invalidate a pending result.

**Verification:** `tests/face-cascade.test.js` checks the lossless upstream model hash and input
bounds; `tests/face-browser.spec.ts` proves actual worker detection, no-face and failure fallback,
manual-edit continuity and exact current asset permission checks. Both are registered in
`tests/test-lab.yaml`; browser prerequisites remain explicit. The existing
`tests/capture.spec.js`, camera browser and authorization proofs remain regression guards.
See [model provenance and quality limits](tools/face-model/README.md). No recognition,
provider changes or generated-image behavior is introduced.

---

## E. The Home summary reads a different identity rail than its six siblings (2026-09-14)

**CLOSED 2026-11-19 (version 1.17.9).**
- **Harness rail fixed:** `scripts/media-home.test.cjs` (commit `f8f19ca3`) models both `req.oidc` and `ctx.authorization.currentActor()` / `authorize()` from one fixture; all `36/36` cases pass (`6/6` `portrait-studio` cases green, including inactive-actor `401` and missing-permission `403`).
- **Live Production tile confirmed:** `GET /api/portrait-studio/home-summary` on Production (`:38788`, 2026-11-19) returned `200 OK` with live `metrics`, `tiles`, `items`, and `asOf`, confirming the ADR-149 authorization rail is live and healthy.
- **Pre-read authorization hardening (`1.17.9`):** `src-routes/home-summary.ts` and `routes/home-summary.js` now enforce `portrait.view` and `portrait.read` **before** executing the two `ps_portraits` SQL queries as well as after (preventing unauthorized database reads while keeping mid-request revocation refusal), guarded by `tests/home-summary-authz.test.cjs` (`3/3` pass, Test Lab case `home-summary-authz`).
