/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the GPU worker's callbacks cross the kernel's ADR-149 enforce boundary. LoRA 1.6.0 was refused authorization_identity_required on the live box because its grant check sat behind the application-authorization layer, and its specs mounted the routers directly. This suite mounts the real package through the kernel's manifest reader, enforce-mode runtime and route mounter (kernel-callback-harness.cjs): a grant minted by a real studio dispatch is admitted and served as its owner, and unsigned, fleet-secret-only, tampered, replayed, expired, issuer-less, foreign-owner, wrong-method and permission-revoked requests are refused with no write. The Python and PowerShell box producers cross the same boundary in box-producers-boundary.core.test.js.
 */

'use strict';

const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { A1, A2, B1, ISSUER, dispatchTrain, seedCharacters, startKernelHarness, training, workerKey } = require('./helpers/kernel-callback-harness.cjs');

let h, signer;

before(async () => {
  h = await startKernelHarness();
  signer = require('./helpers/lora-callback-signer.ts'); // loaded through the core's tsx hook
  await h.changeRole('owner_a'); await h.changeRole('owner_b');
}, { timeout: 180000 });

after(async () => { if (h) await h.stop(); });

beforeEach(() => seedCharacters(h));

const rows = async (sql, params = []) => (await h.fixture.pool.query(sql, params)).rows;
const status = async (request) => { const response = await signer.send(request); return { code: response.status, body: await response.json().catch(() => ({})) }; };
const callback = (grant, owner, payload) => signer.signedCallback(h.base, grant, owner, payload);

test('the package activates through the kernel in enforce mode with the catalog and a declared callback verifier', () => {
  const ingest = h.manifest.routes.find((route) => route.mountPath === '/api/lora/ingest');
  assert.equal(ingest.callbackVerifier, 'createLoraCallbackVerifier');
  assert.equal(ingest.auth, 'public');
  assert.equal(h.runtime.protectedApp('lora'), true);
  assert.ok(h.policy.getApp('lora').catalog.permissions['lora.execute']);
});

test('a studio dispatch mints a grant bound to the verified owner subject and issuer', async () => {
  const grant = await dispatchTrain(h);
  const [row] = await rows('SELECT owner_sub, owner_issuer, character_id, dispatch_kind FROM oshal_lora_callback_grants WHERE id = $1', [grant.id]);
  assert.deepEqual(row, { owner_sub: 'lcb_a', owner_issuer: ISSUER, character_id: A1, dispatch_kind: 'train' });
});

test('enabling autonomous mode through the kernel records the verified owner issuer for the schedule; disabling clears it', async () => {
  const toggle = async (enabled) => fetch(`${h.base}/api/lora/characters/drummer/autonomous`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fixture-user': 'owner_a' }, body: JSON.stringify({ enabled }) });
  assert.equal((await toggle(true)).status, 200);
  assert.deepEqual(await rows('SELECT autonomous, autonomous_issuer FROM oshal_lora_characters WHERE id = $1', [A1]), [{ autonomous: true, autonomous_issuer: ISSUER }]);
  assert.equal((await toggle(false)).status, 200);
  assert.deepEqual(await rows('SELECT autonomous, autonomous_issuer FROM oshal_lora_characters WHERE id = $1', [A1]), [{ autonomous: false, autonomous_issuer: null }]);
});

test('a correctly signed worker callback is admitted and served as the grant owner; the identical request replayed is refused', async () => {
  const grant = await dispatchTrain(h);
  const signed = callback(grant, 'lcb_a', training(workerKey(A1)));
  const first = await status(signed);
  assert.equal(first.code, 200, JSON.stringify(first.body));
  assert.deepEqual({ ok: first.body.ok, kind: first.body.kind, version: first.body.version }, { ok: true, kind: 'training', version: 1 });
  // The write went through the non-bypass lcb_a role: the harness pool refuses any other identity.
  assert.deepEqual(await rows('SELECT status FROM oshal_lora_models WHERE character_id = $1', [A1]), [{ status: 'trained' }]);
  const replay = await status(signed);
  assert.deepEqual([replay.code, replay.body], [401, { error: 'callback_signature_invalid' }]);
  assert.deepEqual(await rows('SELECT count(*)::int AS n FROM oshal_lora_callback_nonces'), [{ n: 1 }]);
});

test('unsigned, fleet-secret-only and tampered requests are refused by the kernel before any write', async () => {
  const grant = await dispatchTrain(h);
  const body = JSON.stringify(training(workerKey(A1)));
  const unsigned = await fetch(`${h.base}/api/lora/ingest`, { method: 'POST', body, headers: { 'content-type': 'application/vnd.oshal.lora-callback+json' } });
  assert.equal(unsigned.status, 401);
  const fleet = await fetch(`${h.base}/api/lora/ingest`, { method: 'POST', body, headers: { 'content-type': 'application/vnd.oshal.lora-callback+json',
    'x-service-secret': process.env.SWARM_SERVICE_SECRET, 'x-oshal-user-sub-b64': Buffer.from('lcb_a').toString('base64url') } });
  assert.deepEqual([fleet.status, await fleet.json()], [401, { error: 'callback_signature_invalid' }]);
  const signed = callback(grant, 'lcb_a', training(workerKey(A1)));
  const tampered = await fetch(signed.url, { ...signed.init, body: Buffer.from(JSON.stringify(training(workerKey(A1), { version: 9 }))) });
  assert.equal(tampered.status, 401);
  assert.deepEqual(await rows('SELECT status FROM oshal_lora_models'), [{ status: 'training' }]);
  assert.deepEqual(await rows('SELECT count(*)::int AS n FROM oshal_lora_callback_nonces'), [{ n: 0 }]);
});

test('expired and issuer-less (1.6.0) grants are refused', async () => {
  const grant = await dispatchTrain(h);
  await h.fixture.pool.query("UPDATE oshal_lora_callback_grants SET expires_at = NOW() - INTERVAL '1 second', created_at = NOW() - INTERVAL '1 hour'");
  assert.equal((await status(callback(grant, 'lcb_a', training(workerKey(A1))))).code, 401);
  const legacy = await dispatchTrain(h, 'owner_a', 'piper');
  await h.fixture.pool.query('UPDATE oshal_lora_callback_grants SET owner_issuer = NULL WHERE id = $1', [legacy.id]);
  assert.equal((await status(callback(legacy, 'lcb_a', training(workerKey(A2))))).code, 401);
  assert.deepEqual(await rows("SELECT count(*)::int AS n FROM oshal_lora_models WHERE status <> 'training'"), [{ n: 0 }]);
});

test("another owner cannot present a grant, and a grant cannot reach another owner's or character's rows", async () => {
  const grant = await dispatchTrain(h);
  assert.equal((await status(callback(grant, 'lcb_b', training(workerKey(B1))))).code, 401);
  const crossOwner = await status(callback(grant, 'lcb_a', training(workerKey(B1))));
  assert.equal(crossOwner.code, 404);
  const crossCharacter = await status(callback(grant, 'lcb_a', training(workerKey(A2))));
  assert.deepEqual([crossCharacter.code, crossCharacter.body], [403, { error: 'callback_character_not_granted' }]);
  assert.deepEqual(await rows("SELECT count(*)::int AS n FROM oshal_lora_models WHERE status <> 'training'"), [{ n: 0 }]);
});

test("the owner's current permission and account gate every callback", async () => {
  const grant = await dispatchTrain(h);
  await h.changeRole('owner_a', 'revoke');
  try {
    assert.equal((await status(callback(grant, 'lcb_a', training(workerKey(A1))))).code, 403);
  } finally { await h.changeRole('owner_a'); }
  h.directory.people.owner_a.isActive = false;
  try {
    const inactive = await status(callback(grant, 'lcb_a', training(workerKey(A1))));
    assert.deepEqual([inactive.code, inactive.body], [403, { error: 'callback_owner_unavailable' }]);
  } finally { h.directory.people.owner_a.isActive = true; }
  assert.deepEqual(await rows('SELECT status FROM oshal_lora_models'), [{ status: 'training' }]);
  assert.equal((await status(callback(grant, 'lcb_a', training(workerKey(A1))))).code, 200);
});

test('only POST reaches the worker mount: the 1.6.0 GET download and a GET probe are refused', async () => {
  for (const target of [`/api/lora/ingest/dataset/${A1}`, '/api/lora/ingest']) {
    const response = await fetch(h.base + target);
    assert.deepEqual([response.status, await response.json()], [405, { error: 'callback_post_required' }], target);
  }
  const grant = await dispatchTrain(h);
  const unknown = await signer.send(signer.signedRequest(h.base, grant, 'lcb_a', 'POST', '/api/lora/ingest/elsewhere'));
  assert.equal(unknown.status, 401);
});
