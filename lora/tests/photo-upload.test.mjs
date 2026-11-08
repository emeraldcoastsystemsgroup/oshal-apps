/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | RP-LORA-01: unit and loopback HTTP tests for multi-photo device upload (basename collision auto-numbering, PNG/JPEG/WebP magic-byte and 10 MiB bounds, crop-box geometry, owner-scoped staging/preview, and cross-owner refusal).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Cover hex-encoded decode($5, 'hex') staging writes and native \x<hex> bytea preview decoding alongside PostgreSQL Buffers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { computeCropBox } from '../tools/lora-photo-upload.mjs';

const requireToolchain = createRequire(new URL('../../scripts/toolchain/package.json', import.meta.url));
const express = requireToolchain('express');
const Module = (await import('node:module')).default;
const identityStore = new AsyncLocalStorage();

let ingest, editor;
const prevLoad = Module._load;
Module._load = function stubCore(name, parent, ...rest) {
  if (name === 'express') return express;
  if (name === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  if (name === '@/shared/services/database/request-identity') {
    return {
      runWithRequestIdentity: (id, fn) => identityStore.run(id, fn),
      getCurrentRequestIdentity: () => identityStore.getStore() || null,
    };
  }
  if (name === '@/app/routes/remote-client-routes') {
    return { remoteClientRegistry: { listClients: () => [], enqueueTask: () => { throw new Error('unexpected worker dispatch'); } } };
  }
  return prevLoad.call(this, name, parent, ...rest);
};
try {
  const reqLocal = createRequire(import.meta.url);
  ingest = reqLocal('../routes/lora-dataset-ingest.js');
  editor = reqLocal('../routes/lora-caption-editor.js');
} finally {
  Module._load = prevLoad;
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG_MIN = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);

function actorFor(sub) {
  return { issuer: 'https://auth.example', sub, principalId: sub, tenant: 't1' };
}

function runMemoryQuery(state, sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  const owner = identityStore.getStore()?.userId || '';
  if (/^(CREATE|ALTER|GRANT|BEGIN|COMMIT|ROLLBACK|SET LOCAL|DELETE|UPDATE)/i.test(s)) return { rows: [], rowCount: 0 };
  if (s.includes('FROM oshal_lora_character_editor WHERE character_id=$1')) {
    const hit = state.chars.find((c) => c.id === params[0] && c.owner === owner);
    return { rows: hit ? [{ owner_key: hit.ownerKey }] : [], rowCount: hit ? 1 : 0 };
  }
  if (s.includes('SELECT id FROM oshal_lora_characters WHERE id=$1 FOR UPDATE')) {
    const hit = state.chars.find((c) => c.id === params[0] && c.owner === owner);
    return { rows: hit ? [{ id: hit.id }] : [], rowCount: hit ? 1 : 0 };
  }
  if (s.includes('FROM oshal_lora_dataset_images WHERE character_id')) {
    const rows = state.images.filter((r) => r.character_id === params[0] && r.owner === owner);
    return { rows, rowCount: rows.length };
  }
  if (s.startsWith('INSERT INTO oshal_lora_dataset_images')) {
    const id = crypto.randomUUID();
    const [character_id, filename, source_name, caption, byte_size] = params;
    state.images.push({ id, character_id, owner, filename, source_name, caption, byte_size, status: 'queued', created_at: new Date().toISOString(), ingested_at: null });
    return { rows: [{ id }], rowCount: 1 };
  }
  if (s.startsWith('INSERT INTO oshal_lora_dataset_staging')) {
    assert.equal(typeof params[4], 'string', 'staging parameter $5 must be hex string for decode($5, hex)');
    const rawBytes = Buffer.from(params[4], 'hex');
    const stored = state.nativeHexBytea ? `\\x${rawBytes.toString('hex')}` : rawBytes;
    state.staging.set(params[0], { owner, content_type: params[1], byte_size: params[2], sha256: params[3], image: stored });
    return { rows: [], rowCount: 1 };
  }
  if (s.includes('SELECT s.image_id FROM oshal_lora_dataset_staging s JOIN oshal_lora_dataset_images d')) {
    const rows = state.images.filter((r) => r.character_id === params[0] && r.owner === owner && state.staging.has(r.id)).map((r) => ({ image_id: r.id }));
    return { rows, rowCount: rows.length };
  }
  if (s.includes('SELECT s.content_type, s.image FROM oshal_lora_dataset_staging s JOIN oshal_lora_dataset_images d')) {
    const img = state.images.find((r) => r.id === params[0] && r.character_id === params[1] && r.owner === owner);
    const st = img ? state.staging.get(img.id) : null;
    return { rows: st ? [{ content_type: st.content_type, image: st.image }] : [], rowCount: st ? 1 : 0 };
  }
  return { rows: [], rowCount: 0 };
}

function createOwnerMemoryPool(nativeHexBytea = false) {
  const state = {
    nativeHexBytea,
    chars: [
      { id: '11111111-1111-4111-8111-111111111111', subject: 'ranger', owner: 'owner-a', ownerKey: editor.editorOwnerKey(actorFor('owner-a')), config: { subject: 'ranger', triggerWord: 'rngr' } },
      { id: '22222222-2222-4222-8222-222222222222', subject: 'ranger', owner: 'owner-b', ownerKey: editor.editorOwnerKey(actorFor('owner-b')), config: { subject: 'ranger', triggerWord: 'other' } },
    ],
    images: [],
    staging: new Map(),
  };
  return {
    ...state,
    async connect() {
      return { release() {}, query: async (sql, params) => runMemoryQuery(state, sql, params) };
    },
    async query(sql, params = []) {
      return runMemoryQuery(state, sql, params);
    },
  };
}
test('computeCropBox preserves aspect ratio, zoom scaling, and normalized pan bounds', () => {
  const sq = computeCropBox(1200, 800, '1:1', 1, 0, 0);
  assert.equal(Math.round(sq.sw), 800);
  assert.equal(Math.round(sq.sh), 800);
  assert.equal(Math.round(sq.sx), 200);
  const zoomed = computeCropBox(1200, 800, '3:4', 2, 1, -1);
  assert.equal(Math.round(zoomed.sh), 400);
  assert.equal(Math.round(zoomed.sw), 300);
  assert.equal(Math.round(zoomed.sx), 900);
  assert.equal(Math.round(zoomed.sy), 0);
});

test('datasetUploadFilename sanitizes stems and auto-numbers case-insensitive collisions', () => {
  const taken = new Set();
  assert.equal(ingest.datasetUploadFilename('../Hero Pose #1.jpeg', 'image/png', taken), 'Hero-Pose-1.png');
  assert.equal(ingest.datasetUploadFilename('hero pose #1.png', 'image/png', taken), 'hero-pose-1-2.png');
  assert.equal(ingest.datasetUploadFilename('hero-pose-1.webp', 'image/jpeg', taken), 'hero-pose-1-3.jpg');
  assert.equal(ingest.datasetUploadFilename('   ', 'image/jpeg', taken), 'photo.jpg');
  assert.equal(ingest.datasetUploadFilename('   ', 'image/png', taken), 'photo-2.png');
});

test('decodeUploadedPhoto enforces PNG/JPEG/WebP magic bytes and 10 MiB ceiling', () => {
  const okPng = ingest.decodeUploadedPhoto({ name: 'pose', dataBase64: `data:image/png;base64,${PNG_1X1.toString('base64')}` });
  assert.equal(okPng.ok, true);
  assert.equal(okPng.type, 'image/png');
  const badMagic = ingest.decodeUploadedPhoto({ name: 'pose', dataBase64: Buffer.from('not an image at all').toString('base64') });
  assert.equal(badMagic.ok, false);
  assert.equal(badMagic.status, 415);
  const oversize = ingest.decodeUploadedPhoto({ name: 'pose', dataBase64: Buffer.alloc(10 * 1024 * 1024 + 8, 0x89).toString('base64') });
  assert.equal(oversize.ok, false);
  assert.equal(oversize.status, 413);
});

async function mountDatasetTestApp(t, nativeHexBytea = false) {
  const pool = createOwnerMemoryPool(nativeHexBytea);
  const state = { currentSub: 'owner-a', pool };
  const ctx = {
    pool,
    ticketService: { createTicket: async () => ({ ticketId: 'ticket-1' }) },
    authorization: {
      currentActor: () => ({ isActive: true, sub: state.currentSub, issuer: 'https://auth.example', principalId: state.currentSub, tenantIds: ['t1'] }),
      authorize: async ({ permission }) => ({ allowed: ['lora.read', 'lora.configure', 'lora.source.change'].includes(permission) }),
    },
  };
  const deps = {
    callerSub: () => state.currentSub,
    loadCharacter: async (_ctx, subject, sub) => pool.chars.find((c) => c.subject === subject && c.owner === sub) || null,
    directorAgentId: 'a0000000-0000-0000-0000-000000000065',
  };
  const app = express();
  app.use((_req, _res, next) => identityStore.run({ userId: state.currentSub, issuer: 'https://auth.example' }, next));
  app.use('/api/lora', ingest.createLoraDatasetRoutes(ctx, deps));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  t.after(() => new Promise((done) => server.close(done)));
  return { base: `http://127.0.0.1:${server.address().port}/api/lora`, state };
}

for (const nativeHexBytea of [false, true]) {
  const label = nativeHexBytea ? 'native \\x-hex bytea' : 'PostgreSQL Buffer bytea';
  test(`POST /dataset/upload stages owner-scoped photos, serves byte-identical previews, and denies cross-owner reads (${label})`, async (t) => {
    const { base, state } = await mountDatasetTestApp(t, nativeHexBytea);
    const uploadRes = await fetch(`${base}/dataset/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: 'ranger',
        photos: [
          { name: 'front-view', caption: 'rngr, front studio portrait', dataBase64: PNG_1X1.toString('base64') },
          { name: 'front-view', caption: 'rngr, side profile', dataBase64: JPEG_MIN.toString('base64') },
        ],
      }),
    });
    assert.equal(uploadRes.status, 201);
    const uploaded = await uploadRes.json();
    assert.equal(uploaded.count, 2);
    assert.deepEqual(uploaded.uploaded.map((x) => x.filename), ['front-view.png', 'front-view-2.jpg']);
    const listRes = await fetch(`${base}/dataset?subject=ranger`);
    const listed = await listRes.json();
    assert.equal(listed.images.length, 2);
    assert.equal(listed.images[0].has_preview, true);
    const prevRes = await fetch(`${base}/dataset/${listed.images[0].id}/preview?subject=ranger`);
    assert.equal(prevRes.status, 200);
    assert.equal(prevRes.headers.get('content-type'), 'image/png');
    assert.equal(prevRes.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await prevRes.arrayBuffer()), PNG_1X1);
    state.currentSub = 'owner-b';
    assert.equal((await fetch(`${base}/dataset/${listed.images[0].id}/preview?subject=ranger`)).status, 404);
    assert.deepEqual((await (await fetch(`${base}/dataset?subject=ranger`)).json()).images, []);
  });
}

test('decodeStagedImageBytes decodes native \\x-prefixed hex bytea and PostgreSQL Buffers identically', () => {
  assert.deepEqual(ingest.decodeStagedImageBytes(PNG_1X1), PNG_1X1);
  assert.deepEqual(ingest.decodeStagedImageBytes(`\\x${PNG_1X1.toString('hex')}`), PNG_1X1);
  assert.deepEqual(ingest.decodeStagedImageBytes(PNG_1X1.toJSON()), PNG_1X1);
});
