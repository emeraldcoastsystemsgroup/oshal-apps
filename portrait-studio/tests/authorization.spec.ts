/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify explicit CRUD grants, independent ownership, denial and capability boundaries over actual HTTP.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retain the exact readiness version assertion for the local detector release.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Prove named manager entry through the actual outer mounter without a second subject-only legacy assignment.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createPortraitFixture, IDS, ISSUER, media } from './authorization.fixture';
import { requirePortraitPermission } from '../src-routes/portrait-authorization';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
let fixture: Awaited<ReturnType<typeof createPortraitFixture>>;
beforeEach(async () => { fixture = await createPortraitFixture(); });
afterEach(async () => { await fixture?.close(); });

it('uses named permissions at the real package entry without requiring a legacy assignment', async () => {
  expect((await fixture.call('/app')).status).toBe(403);
  await fixture.change('manager');
  expect((await fixture.call('/app')).status).toBe(200);
  expect((await fixture.call('/app', 'collision')).status).toBe(403);
  await fixture.change('manager', 'alice', 'revoke');
  expect((await fixture.call('/app')).status).toBe(403);
  expect(media.calls).toBe(0);
});

it('keeps the operator ownership report read-only and outside automatic installation migrations', () => {
  const sql = readFileSync(resolve(__dirname, '../migrations/legacy-owner-review.sql'), 'utf8').replace(/--[^\n]*/g, '');
  expect(sql).toMatch(/BEGIN TRANSACTION READ ONLY/);
  expect(sql).toContain('portraits_requiring_owner_review');
  expect(sql).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|ALTER|DROP)\b/i);
  expect(readFileSync(resolve(__dirname, '../oshal-app.yaml'), 'utf8')).not.toContain('legacy-owner-review.sql');
});

it('requires actual user view authority for metadata readiness and refuses a service-only caller', async () => {
  expect((await fixture.call('/_smoke')).status).toBe(403);
  await fixture.change('viewer');
  expect(await (await fixture.call('/_smoke')).json()).toMatchObject({ status: 'ready', package: 'portrait-studio', version: '1.14.1' });
  expect((await fetch(fixture.base + '/api/portrait-studio/_smoke', { headers: { 'x-service-secret': 'fixture-service-only' } })).status).toBe(401);
  expect(media.calls).toBe(0);
});

it('blocks the entire component and direct CRUD for an unassigned user, including swarm admin', async () => {
  for (const user of ['alice', 'admin']) for (const [method, path] of [['GET', '/app'], ['GET', '/portraits'], ['POST', '/portraits'], ['PATCH', `/portraits/${IDS.alice}`], ['DELETE', `/portraits/${IDS.alice}`]]) {
    expect((await fixture.call(path, user, method)).status).toBe(403);
  }
  expect(media.calls).toBe(0);
});
it('separates viewing the component from reading data or creating portraits', async () => {
  await fixture.change('viewer');
  expect((await fixture.call('/app')).status).toBe(200);
  expect((await fixture.call('/catalog')).status).toBe(200);
  for (const path of ['/portraits', '/artifacts', '/readiness', '/home-summary', '/provider']) expect((await fixture.call(path)).status).toBe(403);
  const result = await (await fixture.call('/permissions')).json();
  expect(result.permissions).toMatchObject({ view: true, read: false, create: false, change: false, delete: false });
});
it('reads only owned issuer-qualified portraits and quarantines legacy unqualified rows', async () => {
  await fixture.change('reader'); await fixture.change('reader', 'bob'); await fixture.change('reader', 'collision');
  expect((await (await fixture.call('/portraits')).json()).portraits.map((row: any) => row.portrait_id)).toEqual([IDS.alice]);
  expect((await (await fixture.call('/portraits', 'bob')).json()).portraits.map((row: any) => row.portrait_id)).toEqual([IDS.bob]);
  expect((await (await fixture.call('/portraits', 'collision')).json()).portraits).toEqual([]);
  expect((await fixture.call(`/portraits/${IDS.alice}/image`)).status).toBe(200);
  for (const id of [IDS.bob, IDS.legacy]) expect((await fixture.call(`/portraits/${id}/image`)).status).toBe(403);
  expect((await fixture.call(`/portraits/${IDS.alice}/image`, 'collision')).status).toBe(403);
});
it('creator can reach input validation but reader cannot; neither gains change or delete', async () => {
  await fixture.change('reader', 'bob'); await fixture.change('creator');
  expect((await fixture.call('/portraits', 'bob', 'POST')).status).toBe(403);
  expect((await fixture.call('/portraits', 'alice', 'POST')).status).toBe(400);
  expect((await fixture.call(`/portraits/${IDS.alice}`, 'alice', 'PATCH', { title: 'no' })).status).toBe(403);
  expect((await fixture.call(`/portraits/${IDS.alice}`, 'alice', 'DELETE')).status).toBe(403);
});
it('editor changes only the owned title and cannot mutate owner fields or another user', async () => {
  await fixture.change('editor');
  const changed = await fixture.call(`/portraits/${IDS.alice}`, 'alice', 'PATCH', { title: 'Reviewed headshot' });
  expect(changed.status).toBe(200); expect((await changed.json()).title).toBe('Reviewed headshot');
  expect((await fixture.call(`/portraits/${IDS.alice}`, 'alice', 'PATCH', { title: 'x', user_sub: 'bob' })).status).toBe(400);
  expect((await fixture.call(`/portraits/${IDS.alice}`, 'alice', 'PATCH', { title: 'x'.repeat(121) })).status).toBe(400);
  expect((await fixture.call(`/portraits/${IDS.bob}`, 'alice', 'PATCH', { title: 'stolen' })).status).toBe(403);
  expect((await fixture.call(`/portraits/${IDS.alice}`, 'alice', 'DELETE')).status).toBe(403);
  expect(fixture.rows.find(row => row.portrait_id === IDS.alice)?.owner_issuer).toBe(ISSUER);
});
it('delete is a separate grant and never overrides another owner, even for the manager role', async () => {
  await fixture.change('manager');
  expect((await fixture.call(`/portraits/${IDS.bob}`, 'alice', 'DELETE')).status).toBe(403);
  expect((await fixture.call(`/portraits/${IDS.legacy}`, 'alice', 'DELETE')).status).toBe(403);
  await fixture.change('manager', 'alice', 'revoke'); await fixture.change('deleter');
  expect((await fixture.call(`/portraits/${IDS.alice}`, 'alice', 'DELETE')).status).toBe(200);
  expect(fixture.rows.map(row => row.portrait_id)).not.toContain(IDS.alice);
});
it('retained read grants do not authorize download/export or issuer-unsafe mailbox operations', async () => {
  await fixture.change('reader');
  expect((await fixture.call(`/portraits/${IDS.alice}/image?download=1`)).status).toBe(403);
  expect((await fixture.call(`/portraits/${IDS.alice}/export?size=600`)).status).toBe(403);
  expect((await fixture.call(`/portraits/${IDS.alice}/email`, 'alice', 'POST', { confirm: true })).status).toBe(403);
  await fixture.change('mailer');
  const refused = await fixture.call(`/portraits/${IDS.alice}/email`, 'alice', 'POST', { confirm: true });
  expect(refused.status).toBe(503); expect((await refused.json()).error).toBe('portrait_mail_identity_unavailable');
  expect(fixture.pool.seen.every(entry => !entry.sql.includes('oshal_connections'))).toBe(true);
});
it('revokes operation access immediately and explicit app deny overrides all business roles', async () => {
  await fixture.change('editor'); await fixture.change('editor', 'alice', 'revoke');
  expect((await fixture.call(`/portraits/${IDS.alice}`, 'alice', 'PATCH', { title: 'revoked' })).status).toBe(403);
  await fixture.change('manager'); await fixture.change(undefined, 'alice', 'deny');
  expect((await fixture.call('/app')).status).toBe(403); expect((await fixture.call('/portraits')).status).toBe(403);
});
it('uses the same permission authority for Jarvis/bot dispatch and rejects unbound operations', async () => {
  const bot = { app: 'portrait-studio', kind: 'bots' as const, operation: 'b0100000-0000-0000-0000-000000000001' };
  await fixture.change('reader');
  expect((await fixture.runtime.authorize(fixture.actors.alice, bot)).allowed).toBe(false);
  await fixture.change('artist');
  expect((await fixture.runtime.authorize(fixture.actors.alice, bot)).allowed).toBe(true);
  await fixture.change('artist', 'alice', 'revoke');
  expect((await fixture.runtime.authorize(fixture.actors.alice, bot)).allowed).toBe(false);
  expect((await fixture.call('/undeclared')).status).toBe(403);
  await expect(fixture.asActor('alice', () => requirePortraitPermission(fixture.ctx, 'create'))).rejects.toThrow('portrait_permission_denied');
});
it('runs owner adapters and handlers without a database operator bypass', async () => {
  await fixture.change('manager'); await fixture.call('/portraits');
  const reads = fixture.pool.seen.filter(entry => /WHERE user_sub/.test(entry.sql));
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(entry => entry.identity?.sub === 'alice' && entry.identity?.principalIssuer === ISSUER && entry.identity.isOperator === false)).toBe(true);
});
it('refuses CLI image transport before creating a row or invoking a provider', async () => {
  await fixture.change('creator'); media.provider = 'codex-cli';
  expect((await (await fixture.call('/provider')).json()).unavailable).toBe('portrait_cli_authorization_unavailable');
  const response = await createPortrait();
  expect(response.status).toBe(503);
  expect(fixture.rows.some(row => row.portrait_id === IDS.created)).toBe(false);
  expect(media.calls).toBe(0);
});

async function createPortrait() {
  const catalog = await (await fixture.call('/catalog')).json();
  const body = new FormData(); body.set('photo', new Blob(['fixture-photo'], { type: 'image/png' }), 'photo.png');
  body.set('mode', 'professional'); body.set('style', catalog.presets.professional[0].id);
  return fetch(fixture.base + '/api/portrait-studio/portraits', { method: 'POST', headers: { 'x-fixture-user': 'alice' }, body });
}
it('creates an issuer-qualified portrait using the authorized platform provider fixture', async () => {
  await fixture.change('creator'); const response = await createPortrait();
  expect(response.status).toBe(202);
  await expect.poll(() => fixture.rows.find(row => row.portrait_id === IDS.created)?.status).toBe('done');
  expect(fixture.rows.find(row => row.portrait_id === IDS.created)).toMatchObject({ owner_issuer: ISSUER, user_sub: 'alice' });
  expect(media.calls).toBe(1);
});
it('refuses generation publication after the creator grant is revoked during provider work', async () => {
  await fixture.change('creator'); let release!: () => void;
  media.wait = new Promise<void>(done => { release = done; });
  const response = await createPortrait(); expect(response.status).toBe(202);
  await expect.poll(() => media.calls).toBe(1);
  await fixture.change('creator', 'alice', 'revoke'); release();
  await expect.poll(() => fixture.rows.find(row => row.portrait_id === IDS.created)?.status).toBe('failed');
  expect((await fixture.call(`/portraits/${IDS.created}/image`)).status).toBe(403);
});
