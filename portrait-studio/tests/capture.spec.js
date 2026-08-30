/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-29 10:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Group-mode geometry guard: the face-count rule (2..6, catalog ceiling wins), the reference-sheet layout (reading order, no overlaps, all tiles inside, 2 columns to 4 faces then 3), clampBox/boxAt/nextFaceBox/faceBoxFromDetection/detectionsToBoxes (aspect-true, inside the image, unclaimed placement, detected face contained with headroom, left-to-right numbering, capped), and `group` → rear lens.
 * 2026-08-12 09:00:00 | maintainer@emeraldcoastsystemsgroup.com     | Camera-source guard: asserts the live/file-capture/upload-only decision over every capability combination (insecure page, no getUserMedia, no canvas.toBlob, no capture attribute), that the shared photo rule refuses the same things for a captured frame as for an upload, honest permission/unavailability messages, facing-mode + non-exact constraints, camera labelling/picker thresholds, and the un-letterboxed frame box. Runs against tools/portrait-capture.js — the SAME file the surface loads.
 */

'use strict';

const assert = require('node:assert');
const path = require('node:path');

const cap = require(path.join(__dirname, '..', 'tools', 'portrait-capture.js'));

/** Build a capability object with everything present, then knock pieces out per case. */
function env(overrides) {
  return Object.assign(
    { secure: true, mediaApi: true, enumerate: true, canvasBlob: true, captureAttr: true },
    overrides || {},
  );
}

module.exports = async function run() {
  let checks = 0;

  // ── mode choice: the whole point of the module ────────────────────────────
  assert.strictEqual(cap.chooseCaptureMode(env()), 'live');
  // An insecure page (plain-http LAN address) has getUserMedia on the object but it always
  // rejects — the surface must NOT offer a live preview it cannot deliver.
  assert.strictEqual(cap.chooseCaptureMode(env({ secure: false })), 'file-capture');
  assert.strictEqual(cap.chooseCaptureMode(env({ mediaApi: false })), 'file-capture');
  // No canvas.toBlob = no way to turn the frozen frame into a validated photo.
  assert.strictEqual(cap.chooseCaptureMode(env({ canvasBlob: false })), 'file-capture');
  // Nothing at all: the control must be hidden, never rendered dead.
  assert.strictEqual(cap.chooseCaptureMode(env({ mediaApi: false, captureAttr: false })), 'upload-only');
  assert.strictEqual(cap.chooseCaptureMode(env({ secure: false, captureAttr: false })), 'upload-only');
  assert.strictEqual(cap.chooseCaptureMode({}), 'upload-only', 'an empty env must fail closed');
  checks += 7;

  // ── the reason is honest about WHICH problem it is ────────────────────────
  assert.strictEqual(cap.unavailableReason(env()), null, 'live needs no excuse');
  assert.match(cap.unavailableReason(env({ secure: false })), /secure page/i);
  assert.match(cap.unavailableReason(env({ mediaApi: false })), /camera app/i);
  assert.match(cap.unavailableReason(env({ canvasBlob: false })), /frame/i);
  assert.match(cap.unavailableReason(env({ mediaApi: false, captureAttr: false })), /no camera support/i);
  // An insecure page must not be reported as "no camera support" — different fix entirely.
  assert.doesNotMatch(cap.unavailableReason(env({ secure: false })), /no camera support/i);
  // The case that made this precedence load-bearing: a DESKTOP browser on a plain-http LAN
  // address. Browsers hide navigator.mediaDevices outside a secure context and desktop browsers
  // have no `capture` attribute, so the capability probe is indistinguishable from "no camera
  // support at all" — but the fix is the https origin, not a different browser.
  const httpLaptop = env({ secure: false, mediaApi: false, captureAttr: false });
  assert.match(cap.unavailableReason(httpLaptop), /secure page/i);
  assert.doesNotMatch(cap.unavailableReason(httpLaptop), /no camera support/i);
  // …and with nowhere to hand off to, it must not promise a camera app it cannot open.
  assert.doesNotMatch(cap.unavailableReason(httpLaptop), /camera app/i);
  assert.match(cap.unavailableReason(env({ secure: false, mediaApi: false })), /camera app/i, 'on mobile there IS a camera app');
  checks += 10;

  // ── one photo rule for every source ───────────────────────────────────────
  assert.strictEqual(cap.photoRejectReason({ type: 'image/jpeg', size: 1024 }), null);
  assert.match(cap.photoRejectReason({ type: 'application/pdf', size: 10 }), /not an image/i);
  assert.match(cap.photoRejectReason({ type: 'image/png', size: cap.MAX_PHOTO_BYTES + 1 }), /20 MB/);
  assert.strictEqual(cap.photoRejectReason({ type: 'image/png', size: cap.MAX_PHOTO_BYTES }), null, 'the cap is inclusive');
  assert.match(cap.photoRejectReason({ type: 'image/jpeg', size: 0 }), /empty/i, 'a failed toBlob must not reach the crop stage');
  assert.match(cap.photoRejectReason(null), /no photo/i);
  // A camera frame is Blob-shaped (no name) and must be judged by the same rule as a File.
  assert.strictEqual(cap.photoRejectReason({ type: 'image/jpeg', size: 900000 }), null);
  checks += 7;

  // ── getUserMedia failures say what the operator can do about it ───────────
  assert.match(cap.permissionMessage({ name: 'NotAllowedError' }), /denied/i);
  assert.match(cap.permissionMessage({ name: 'NotFoundError' }), /no camera found/i);
  assert.match(cap.permissionMessage({ name: 'NotReadableError' }), /already in use/i);
  // An unrecognised fault must surface its real message, not be swallowed into a generic line.
  assert.match(cap.permissionMessage({ name: 'WeirdError', message: 'kernel said no' }), /kernel said no/);
  checks += 4;

  // ── lens preference + constraints ─────────────────────────────────────────
  assert.strictEqual(cap.facingModeFor('professional'), 'user');
  assert.strictEqual(cap.facingModeFor('character'), 'environment');
  assert.strictEqual(cap.facingModeFor(undefined), 'user', 'default to the headshot lens');
  const loose = cap.videoConstraints('character');
  assert.deepStrictEqual(loose.facingMode, { ideal: 'environment' });
  assert.ok(!('exact' in (loose.facingMode || {})), 'facing must never be exact — a one-camera laptop still has to open');
  const pinned = cap.videoConstraints('professional', 'dev-2');
  assert.deepStrictEqual(pinned.deviceId, { exact: 'dev-2' });
  assert.ok(!('facingMode' in pinned), 'an explicit device wins over the facing preference');
  checks += 7;

  // ── device labelling + when a picker is worth showing ─────────────────────
  const cams = cap.describeCameras([
    { kind: 'audioinput', deviceId: 'a1', label: 'Mic' },
    { kind: 'videoinput', deviceId: 'v1', label: 'FaceTime HD' },
    { kind: 'videoinput', deviceId: 'v2', label: '' },
  ]);
  assert.strictEqual(cams.length, 2, 'microphones are not cameras');
  assert.strictEqual(cams[0].label, 'FaceTime HD');
  // Labels are empty until permission is granted — a blank picker is a broken picker.
  assert.strictEqual(cams[1].label, 'Camera 2');
  assert.strictEqual(cap.shouldShowPicker(cams), true);
  assert.strictEqual(cap.shouldShowPicker([cams[0]]), false, 'one camera is not a choice');
  assert.strictEqual(cap.shouldShowPicker([]), false);
  assert.deepStrictEqual(cap.describeCameras(null), []);
  checks += 7;

  // ── frame box: centred, never upscaled past what the camera delivered ─────
  const land = cap.frameBox(1280, 720);
  assert.strictEqual(land.sw, 720);
  assert.strictEqual(land.sh, 720, 'a landscape webcam must not claim rows it does not have');
  assert.strictEqual(land.sx, 280, 'centred horizontally');
  assert.strictEqual(land.sy, 0);
  const port = cap.frameBox(720, 1280);
  assert.strictEqual(port.sw, 720);
  assert.strictEqual(port.sh, 900, 'portrait video gets headroom above the head');
  assert.ok(port.sy >= 0 && port.sy + port.sh <= 1280, 'the box must stay inside the frame');
  // A video element with no intrinsic size yet must still yield a usable box, not NaN.
  const zero = cap.frameBox(0, 0);
  assert.ok(zero.sw > 0 && zero.sh > 0);
  checks += 8;

  // ── connected-asset picker: which stored files are pickable ───────────────
  assert.strictEqual(cap.imageMimeFromName('headshot.JPG'), 'image/jpeg', 'extension match is case-insensitive');
  assert.strictEqual(cap.imageMimeFromName('a.png'), 'image/png');
  assert.strictEqual(cap.imageMimeFromName('resume.pdf'), null);
  assert.strictEqual(cap.imageMimeFromName('notes'), null, 'no extension is not an image');
  assert.strictEqual(cap.imageMimeFromName('.gitignore'), null, 'a dotfile is not a gif');
  // A Google-native doc has no image extension, so it is filtered out BEFORE any download —
  // the framework would export it as PDF/text and the studio would choke on the bytes.
  assert.strictEqual(cap.imageMimeFromName('Q3 Plan'), null);
  // Drive path segments carry a ~<file id> suffix; the id must not eat the extension.
  assert.strictEqual(cap.imageMimeFromName('photos~1AbC/me.jpeg~9XyZ'), 'image/jpeg');
  assert.strictEqual(cap.isRiskyImage('IMG_0421.HEIC'), true, 'phone HEIC must be flagged');
  assert.strictEqual(cap.isRiskyImage('IMG_0421.jpg'), false);
  checks += 9;

  // ── partitioning a folder listing ─────────────────────────────────────────
  const part = cap.partitionEntries([
    { name: 'Trips', type: 'folder', path: 'Trips' },
    { name: 'me.jpg', type: 'file', path: 'me.jpg', size: 400000 },
    { name: 'huge.png', type: 'file', path: 'huge.png', size: cap.MAX_PHOTO_BYTES + 1 },
    { name: 'taxes.pdf', type: 'file', path: 'taxes.pdf', size: 100 },
    { name: 'notes.txt', type: 'file', path: 'notes.txt', size: 10 },
    null,
  ]);
  assert.strictEqual(part.folders.length, 1, 'folders always survive — they are the way to the photos');
  assert.strictEqual(part.images.length, 1);
  assert.strictEqual(part.images[0].mime, 'image/jpeg', 'the MIME rides along; /download only sends octet-stream');
  assert.strictEqual(part.hiddenOther, 2);
  assert.strictEqual(part.hiddenTooBig, 1, 'oversized images are refused BEFORE the download, not after');
  // Silently dropping files reads as "the folder was empty" — the count has to survive.
  assert.match(cap.hiddenSummary(part), /2 non-image files and 1 over 20 MB hidden/);
  assert.strictEqual(cap.hiddenSummary({ hiddenOther: 0, hiddenTooBig: 0 }), '', 'nothing hidden says nothing');
  assert.match(cap.hiddenSummary({ hiddenOther: 1, hiddenTooBig: 0 }), /1 non-image file hidden/, 'singular');
  checks += 8;

  // ── navigation is provider-agnostic ───────────────────────────────────────
  assert.deepStrictEqual(cap.breadcrumbs(''), []);
  assert.deepStrictEqual(cap.breadcrumbs('Photos/2026'), [
    { label: 'Photos', path: 'Photos' }, { label: '2026', path: 'Photos/2026' },
  ]);
  // Drive segments are `<url-encoded name>~<id>` — the crumb shows the name, the path keeps the id.
  assert.deepStrictEqual(cap.breadcrumbs('My%20Photos~1AbC/Trips~2Def'), [
    { label: 'My Photos', path: 'My%20Photos~1AbC' },
    { label: 'Trips', path: 'My%20Photos~1AbC/Trips~2Def' },
  ]);
  assert.strictEqual(cap.parentPath('a/b/c'), 'a/b');
  assert.strictEqual(cap.parentPath('a'), '');
  assert.strictEqual(cap.parentPath(''), '', 'the root has no parent to climb to');
  checks += 6;

  // ── an empty folder must name the real cause ──────────────────────────────
  assert.match(cap.emptyMessage('oshal-local'), /no images/i);
  // Drive can be genuinely connected and still show nothing, because the connector holds
  // per-file scope. Reporting that as "no images" would send the user hunting for photos
  // that are there — the scope is the reason.
  assert.match(cap.emptyMessage('google-drive'), /per-file access/i);
  assert.doesNotMatch(cap.emptyMessage('google-drive'), /^No images in this folder\.$/);
  checks += 3;

  // ── group mode: face count, reference-sheet layout, box placement ─────────
  assert.strictEqual(cap.subjectsRejectReason(2), null);
  assert.strictEqual(cap.subjectsRejectReason(6), null);
  assert.match(cap.subjectsRejectReason(1), /at least 2/);
  assert.match(cap.subjectsRejectReason(7), /at most 6/);
  assert.match(cap.subjectsRejectReason(4, 3), /at most 3/, 'the catalog ceiling wins over the module default');
  assert.match(cap.subjectsRejectReason(2.5), /whole number/);
  assert.match(cap.subjectsRejectReason(NaN), /whole number/);
  assert.strictEqual(cap.MIN_GROUP_SUBJECTS, 2);
  assert.strictEqual(cap.MAX_GROUP_SUBJECTS, 6);
  assert.strictEqual(cap.facingModeFor('group'), 'environment', 'a group shot points at the room');
  checks += 10;

  // sheet layout: reading order (left→right, top→bottom), no overlaps, every tile inside the sheet
  for (let n = 1; n <= 6; n++) {
    const L = cap.sheetLayout(n, 640, 800, 8);
    assert.strictEqual(L.tiles.length, n);
    assert.strictEqual(L.cols, n <= 1 ? 1 : n <= 4 ? 2 : 3, `column rule broken for n=${n}`);
    assert.strictEqual(L.rows, Math.ceil(n / L.cols));
    L.tiles.forEach((t, i) => {
      assert.strictEqual(t.number, i + 1, 'badge numbers are 1-based and sequential');
      assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= L.width && t.y + t.h <= L.height, `tile ${i} outside the sheet for n=${n}`);
      if (i > 0) {
        const prev = L.tiles[i - 1];
        assert.ok(prev.y < t.y || prev.x + prev.w <= t.x, `tile ${i} not in reading order for n=${n}`);
      }
      L.tiles.slice(0, i).forEach((o) => {
        const overlap = t.x < o.x + o.w && o.x < t.x + t.w && t.y < o.y + o.h && o.y < t.y + t.h;
        assert.ok(!overlap, `tiles overlap for n=${n}`);
      });
    });
  }
  assert.deepStrictEqual(cap.sheetLayout(4, 100, 125, 0).tiles.map((t) => [t.x, t.y]), [[0, 0], [100, 0], [0, 125], [100, 125]]);
  checks += 7;

  // clampBox: aspect kept, inside the image, shrinks before it moves
  const W = 1600, H = 1200, A = 0.8;
  const inside = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= W + 1e-6 && b.y + b.h <= H + 1e-6;
  const aspectOk = (b) => Math.abs(b.w / b.h - A) < 1e-6;
  let b = cap.clampBox({ x: -50, y: -50, w: 400 }, W, H, A);
  assert.ok(inside(b) && aspectOk(b));
  assert.strictEqual(b.x, 0); assert.strictEqual(b.y, 0);
  b = cap.clampBox({ x: 0, y: 0, w: 5000 }, W, H, A);
  assert.ok(inside(b) && aspectOk(b), 'an oversized box is shrunk into the image');
  checks += 3;

  // boxAt: centred on the click, smaller than the solo default, inside even at the edge
  b = cap.boxAt(800, 600, W, H, A);
  assert.ok(inside(b) && aspectOk(b));
  assert.ok(Math.abs((b.x + b.w / 2) - 800) < 1e-6 && Math.abs((b.y + b.h / 2) - 600) < 1e-6, 'box must be centred on the click');
  assert.ok(b.h < H * 0.85, 'a group face box is smaller than the solo default box');
  assert.ok(inside(cap.boxAt(0, 0, W, H, A)), 'a click at the corner still lands inside');
  checks += 4;

  // nextFaceBox: lands on unclaimed picture, never centred inside an existing box, never outside
  const first = cap.nextFaceBox([], W, H, A);
  assert.ok(inside(first) && aspectOk(first));
  const second = cap.nextFaceBox([first], W, H, A);
  const cx2 = second.x + second.w / 2, cy2 = second.y + second.h / 2;
  assert.ok(!(cx2 > first.x && cx2 < first.x + first.w && cy2 > first.y && cy2 < first.y + first.h), 'second box must not be centred inside the first');
  const full = [cap.clampBox({ x: 0, y: 0, w: W }, W, H, A)];
  assert.ok(inside(cap.nextFaceBox(full, W, H, A)), 'when everything is claimed it still returns a box inside the image');
  checks += 3;

  // faceBoxFromDetection: contains the face, headroom above, more room below (shoulders), aspect-true, inside
  const face = { x: 700, y: 300, width: 200, height: 240 };
  b = cap.faceBoxFromDetection(face, W, H, A);
  assert.ok(inside(b) && aspectOk(b));
  assert.ok(b.x <= face.x && b.x + b.w >= face.x + face.width && b.y <= face.y && b.y + b.h >= face.y + face.height, 'crop must contain the detected face');
  assert.ok(face.y - b.y > 0, 'headroom above the face');
  assert.ok((b.y + b.h) - (face.y + face.height) > face.y - b.y, 'more room below the face than above it');
  assert.ok(inside(cap.faceBoxFromDetection({ x: 1500, y: 1100, width: 200, height: 240 }, W, H, A)), 'a face at the edge is clamped in');
  checks += 5;

  // detectionsToBoxes: left-to-right numbering, empties dropped, capped at the ceiling
  const rects = [
    { x: 900, y: 300, width: 150, height: 180 }, { x: 100, y: 320, width: 150, height: 180 },
    { x: 500, y: 310, width: 0, height: 0 }, { x: 1300, y: 300, width: 150, height: 180 },
  ];
  const ordered = cap.detectionsToBoxes(rects, W, H, A);
  assert.strictEqual(ordered.length, 3, 'empty rectangles are dropped');
  assert.ok(ordered[0].x < ordered[1].x && ordered[1].x < ordered[2].x, 'left-to-right numbering');
  assert.strictEqual(cap.detectionsToBoxes(rects, W, H, A, 2).length, 2, 'capped at the group ceiling');
  assert.deepStrictEqual(cap.detectionsToBoxes(null, W, H, A), []);
  checks += 4;

  return checks;
};
