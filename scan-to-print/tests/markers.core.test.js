/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The orientation cube over loopback HTTP (BACKLOG B9): six photos of a 60 x 40 x 30 box, each with its face marker beside the object, are assigned their views by the upload itself and reconstruct to 72000 mm3 with no PATCH; a photo without a marker, with an unknown pattern, or whose view another photo already holds stays unassigned and its row says why; video frames showing a marker are never auto-assigned.
 *
 * FRAMEWORK-COUPLED: needs a core checkout for express/multer/sharp. Not part of the store-CI
 * wildcard; run locally: OSHAL_CORE_DIR=C:/Projects/oshal node --test tests/markers.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startFixture, json, coreRequire } = require('./routes-core.fixture.js');

const e = require(path.resolve(__dirname, '..', 'routes', 'engine', 'index.js'));
const sharp = coreRequire('sharp');
let fixture;
test.before(async () => { fixture = await startFixture(); });
test.after(async () => fixture.close());
const call = (...args) => fixture.call(...args);

const SIZE = 200;
const FACE_MM = { front: [60, 30], back: [60, 30], left: [40, 30], right: [40, 30], top: [60, 40], bottom: [60, 40] };

/** A PNG photo: the object centred at 2 px/mm, and optionally a marker grid on a white card at the top left. */
async function markerPhoto(objectMm, cells) {
  const data = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    data.set(Math.abs(x + 0.5 - SIZE / 2) < objectMm[0] && Math.abs(y + 0.5 - SIZE / 2) < objectMm[1] ? [40, 70, 160] : [214, 200, 176], (y * SIZE + x) * 3);
  }
  if (cells) {
    const cell = 4, x0 = 16, y0 = 16, card = cells.length + 2;
    for (let r = 0; r < card; r += 1) for (let c = 0; c < card; c += 1) {
      const black = r > 0 && c > 0 && r < card - 1 && c < card - 1 && cells[r - 1][c - 1] === 1;
      for (let dy = 0; dy < cell; dy += 1) for (let dx = 0; dx < cell; dx += 1) data.set(black ? [0, 0, 0] : [255, 255, 255], ((y0 + (r - 1) * cell + dy) * SIZE + x0 + (c - 1) * cell + dx) * 3);
    }
  }
  return sharp(data, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer();
}
const faceCells = (view) => e.faceMarkerCells(view);

test('B9: six photos with markers are assigned on upload and reconstruct with no manual step', async () => {
  const id = (await call('/jobs', json('POST', { title: 'cube-labelled box' }))).body.job.job_id;
  assert.equal((await call(`/jobs/${id}`, json('PATCH', { knownDimensions: [{ axis: 'x', mm: 60 }] }))).status, 200);
  const files = [];
  for (const view of e.VIEW_NAMES) files.push([`${view}.png`, await markerPhoto(FACE_MM[view], faceCells(view))]);
  const up = await fixture.uploadPhotos(id, files);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.viewsFromMarkers, 6);
  assert.deepEqual(up.body.images.map((img) => img.view), e.VIEW_NAMES, 'every photo arrives with its view');
  assert.ok(up.body.images.every((img) => img.silhouette.marker.view === img.view));
  const rec = await call(`/jobs/${id}/reconstruct`, json('POST', { resolution: 60, smoothIterations: 0 }));
  assert.equal(rec.status, 200, JSON.stringify(rec.body));
  assert.deepEqual([...rec.body.report.viewsUsed].sort(), [...e.VIEW_NAMES].sort());
  assert.deepEqual(rec.body.report.sizeMm, { x: 60, y: 40, z: 30 });
  assert.equal(rec.body.report.gridVolumeMm3, 72000);
});

test('B9: no marker, an unknown pattern, or a view already held leaves the photo unassigned, and its row says why', async () => {
  const id = (await call('/jobs', json('POST', { title: 'partial labels' }))).body.job.job_id;
  const first = await fixture.uploadPhotos(id, [['front.png', await markerPhoto(FACE_MM.front, faceCells('front'))]]);
  assert.equal(first.body.images[0].view, 'front');
  const unknown = faceCells('front').map((row) => [...row]);
  unknown[1][1] ^= 1; unknown[2][3] ^= 1; unknown[4][2] ^= 1; // three cells off every face
  const next = await fixture.uploadPhotos(id, [
    ['front-again.png', await markerPhoto(FACE_MM.front, faceCells('front'))],
    ['plain.png', await markerPhoto(FACE_MM.top, null)],
    ['smudged.png', await markerPhoto(FACE_MM.right, unknown)],
  ]);
  assert.equal(next.status, 201, JSON.stringify(next.body));
  assert.equal(next.body.viewsFromMarkers, 0);
  const [again, plain, smudged] = next.body.images;
  assert.equal(again.view, null);
  assert.match(again.silhouette.marker.reason, /another photo already holds the front view/);
  assert.equal(plain.view, null);
  assert.match(plain.silhouette.marker.reason, /No orientation-cube marker is visible/);
  assert.equal(smudged.view, null);
  assert.match(smudged.silhouette.marker.reason, /not an orientation-cube face/);
});

test('B9: video frames that show a marker are never auto-assigned', async () => {
  const id = (await call('/jobs', json('POST', { title: 'video with cube' }))).body.job.job_id;
  const frame = await markerPhoto(FACE_MM.front, faceCells('front'));
  fixture.control.execFile = async (_file, args) => {
    const dir = path.dirname(args.at(-1));
    for (let i = 1; i <= 3; i += 1) fs.writeFileSync(path.join(dir, `frame-00${i}.png`), frame);
    return { stdout: '', stderr: '' };
  };
  try {
    const form = new FormData();
    form.append('video', new Blob([Buffer.from('clip')]), 'clip.mp4');
    const up = await call(`/jobs/${id}/video`, { method: 'POST', body: form });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.ok(up.body.images.every((img) => img.view === null), 'the frame suggestion lane owns video, not the marker');
  } finally { fixture.control.execFile = null; }
});
