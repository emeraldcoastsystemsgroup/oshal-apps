/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | A LoRA character could not be deleted (no route, no control), so test characters stayed in every list. DELETE /characters/:subject runs here over real HTTP against a disposable PostgreSQL with the package's migrations and forced row-level security, as non-bypass owner roles: the owner's character goes with every version, score, thumbnail, dataset receipt, staged image and callback grant; another owner's character with the same subject is untouched and cannot be deleted by the first owner; an unknown subject answers 404 and no identity answers 401. The authorization catalog binds the route to lora.configure and the studio carries the two-step control.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DisposablePostgres } from '@test-fixtures/disposable-postgres';
import { getRequestIdentity, runWithRequestIdentity } from '@/shared/services/database/request-identity';

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 });

vi.mock('@/shared/services/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), runRuntimeSchemaBootstrap: vi.fn(async () => undefined),
}));
vi.mock('@/app/routes/remote-client-routes', () => ({ remoteClientRegistry: { listClients: () => [], enqueueTask: vi.fn() } }));

import { createBotLoraRoutes } from '../src-routes/bot-lora-routes';
import { mintCallbackGrant } from '../src-routes/lora-callback-grants';

const MIGRATIONS = ['058-lora-studio.sql', '100-lora-owner-rls.sql', '101-lora-cell-images.sql', '102-lora-character-identity.sql',
  '103-lora-dataset-images.sql', '104-lora-dataset-staging.sql', '105-lora-callback-grants.sql', '106-lora-callback-identity.sql'];
const OWNERS = ['delete_a', 'delete_b'] as const;
const fixture = new DisposablePostgres({ purpose: 'lora-character-delete', roles: OWNERS.map((name) => (
  { name, options: `-c oshal.current_sub=${name} -c oshal.is_operator=off` })) });
const pkg = fileURLToPath(new URL('..', import.meta.url));
const A1 = 'a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaad1';
const A2 = 'a2a2a2a2-aaaa-4aaa-8aaa-aaaaaaaaaad2';
const B1 = 'b1b1b1b1-bbbb-4bbb-8bbb-bbbbbbbbbbd1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CHILD_TABLES = ['oshal_lora_models', 'oshal_lora_scores', 'oshal_lora_cell_images', 'oshal_lora_dataset_images', 'oshal_lora_callback_grants'];
let server: Server, base: string;

/** Every query runs as the non-bypass role named by the request identity. */
function ownerPool() {
  const role = () => {
    const sub = getRequestIdentity()?.sub;
    if (sub !== 'delete_a' && sub !== 'delete_b') throw new Error('Unbound fixture database identity');
    return fixture.rolePool(sub);
  };
  return { query: (sql: string, params?: unknown[]) => role().query(sql, params), connect: () => role().connect() };
}
const ctx = { pool: ownerPool(), appPackageDir: pkg, ticketService: { createTicket: vi.fn() } } as any;

beforeAll(async () => {
  await fixture.start();
  for (const name of MIGRATIONS) await fixture.pool.query(readFileSync(resolve(pkg, 'migrations', name), 'utf8'));
  await fixture.pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${OWNERS.join(', ')}`);
  const app = express();
  app.use(express.json());
  app.use('/api/lora', (req, res, next) => {
    const sub = req.headers['x-fixture-owner'];
    if (sub !== 'delete_a' && sub !== 'delete_b') { next(); return; }
    Object.assign(req, { oidc: { isAuthenticated: () => true, user: { sub } } });
    runWithRequestIdentity({ sub, principalIssuer: 'https://issuer.oshal.example.com', isOperator: false }, next);
  }, createBotLoraRoutes(ctx));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120000);

afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
  await fixture.stop();
});

/** Two characters for owner A and one for owner B under the SAME subject, each with a full set of child rows. */
beforeEach(async () => {
  await fixture.pool.query('TRUNCATE oshal_lora_characters CASCADE');
  await fixture.pool.query(`INSERT INTO oshal_lora_characters (id, subject, display_name, trigger_word, owner_sub) VALUES
    ($1, 'drummer', 'Drummer', 'drummer', 'delete_a'), ($2, 'piper', 'Piper', 'piper', 'delete_a'),
    ($3, 'drummer', 'Other drummer', 'drummer', 'delete_b')`, [A1, A2, B1]);
  for (const [id, owner] of [[A1, 'delete_a'], [A2, 'delete_a'], [B1, 'delete_b']] as const) {
    await fixture.pool.query(`INSERT INTO oshal_lora_models (character_id, version, status) VALUES ($1, 1, 'scored'), ($1, 2, 'trained')`, [id]);
    await fixture.pool.query(`INSERT INTO oshal_lora_scores (character_id, version, overall, cells) VALUES ($1, 1, .8, '[]'::jsonb)`, [id]);
    await fixture.pool.query(`INSERT INTO oshal_lora_cell_images (character_id, version, cell_index, content_type, byte_size, image, expires_at)
      VALUES ($1, 1, 0, 'image/png', $2, $3, NOW() + INTERVAL '1 day')`, [id, PNG.length, PNG]);
    const [receipt] = (await fixture.pool.query(`INSERT INTO oshal_lora_dataset_images (character_id, filename, caption, byte_size, status)
      VALUES ($1, 'portrait.png', 'portrait', $2, 'queued') RETURNING id`, [id, PNG.length])).rows;
    await fixture.pool.query(`INSERT INTO oshal_lora_dataset_staging (image_id, content_type, byte_size, sha256, image, expires_at)
      VALUES ($1, 'image/png', $2, 'fixture', $3, NOW() + INTERVAL '1 hour')`, [receipt.id, PNG.length, PNG]);
    await runWithRequestIdentity({ sub: owner, isOperator: false }, () => mintCallbackGrant(ctx.pool,
      { characterId: id, ownerSub: owner, ownerIssuer: 'https://issuer.oshal.example.com', ticketId: `ticket-${id}`, dispatchKind: 'train' }));
  }
});

/** Child rows per table for one character, read as the superuser so RLS cannot hide a leftover. */
async function childCounts(characterId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of CHILD_TABLES) {
    out[table] = Number((await fixture.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE character_id = $1`, [characterId])).rows[0].n);
  }
  out.oshal_lora_dataset_staging = Number((await fixture.pool.query(
    'SELECT count(*)::int AS n FROM oshal_lora_dataset_staging s JOIN oshal_lora_dataset_images i ON i.id = s.image_id WHERE i.character_id = $1',
    [characterId])).rows[0].n);
  return out;
}

async function remove(subject: string, owner?: string): Promise<Response> {
  return fetch(`${base}/api/lora/characters/${encodeURIComponent(subject)}`, {
    method: 'DELETE', headers: owner ? { 'x-fixture-owner': owner } : {},
  });
}

describe('DELETE /characters/:subject', () => {
  it('deletes the owner\'s character with every row stored for it', async () => {
    expect(Object.values(await childCounts(A1)).every((n) => n > 0)).toBe(true);
    const response = await remove('drummer', 'delete_a');
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ ok: true, subject: 'drummer', removedVersions: 2 });
    expect((await fixture.pool.query('SELECT 1 FROM oshal_lora_characters WHERE id = $1', [A1])).rowCount).toBe(0);
    expect(Object.values(await childCounts(A1)).every((n) => n === 0)).toBe(true);
    expect((await fixture.pool.query('SELECT count(*)::int AS n FROM oshal_lora_callback_nonces')).rows[0].n).toBe(0);
  });

  it('leaves the owner\'s other characters and another owner\'s same-subject character untouched', async () => {
    expect((await remove('drummer', 'delete_a')).status).toBe(200);
    for (const id of [A2, B1]) {
      expect((await fixture.pool.query('SELECT 1 FROM oshal_lora_characters WHERE id = $1', [id])).rowCount).toBe(1);
      expect(Object.values(await childCounts(id)).every((n) => n > 0)).toBe(true);
    }
    const list = await fetch(`${base}/api/lora/characters`, { headers: { 'x-fixture-owner': 'delete_a' } });
    expect(((await list.json()).characters as Array<{ subject: string }>).map((c) => c.subject)).toEqual(['piper']);
  });

  it('cannot delete a character the caller does not own', async () => {
    expect((await remove('piper', 'delete_b')).status).toBe(404);
    expect((await fixture.pool.query('SELECT 1 FROM oshal_lora_characters WHERE id = $1', [A2])).rowCount).toBe(1);
    expect(Object.values(await childCounts(A2)).every((n) => n > 0)).toBe(true);
  });

  it('answers 404 for an unknown subject and 401 without an identity', async () => {
    expect((await remove('no-such-character', 'delete_a')).status).toBe(404);
    expect((await remove('drummer')).status).toBe(401);
    expect((await fixture.pool.query('SELECT count(*)::int AS n FROM oshal_lora_characters')).rows[0].n).toBe(3);
  });

  it('is bound to lora.configure in the catalog and offered by the studio as a two-step control', () => {
    const catalog = readFileSync(resolve(pkg, 'authorization.yaml'), 'utf8');
    expect(catalog).toMatch(/\{ id: character-delete, method: DELETE, path: \/characters\/:subject, allOf: \[lora\.configure\] \}/);
    const compiled = readFileSync(resolve(pkg, 'routes/bot-lora-routes.js'), 'utf8');
    expect(compiled).toContain("router.delete('/characters/:subject'");
    const studio = readFileSync(resolve(pkg, 'tools/lora.html'), 'utf8');
    expect(studio).toContain('id="deleteCharBtn"');
    expect(studio).toMatch(/api\('\/characters\/'\+encodeURIComponent\(c\.subject\),\{method:'DELETE'\}\)/);
    expect(studio).toContain("'Yes, delete it'");
  });
});
