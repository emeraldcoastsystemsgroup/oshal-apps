/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove console character creation, bounded inputs and concurrent identity reuse over actual HTTP, Chromium and forced-RLS PostgreSQL. Session and post-migration bootstrap are fixture seams; GPU and tickets are forbidden.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retain package integration time budgets under the framework runner so the real five-second lock refusal and disposable-engine cleanup can finish.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Admit all race-test connections before starting transactions, including a deliberately late caller, without overriding production lock deadlines or database results.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Apply migration 104 with the rest of the package schema: the studio's dataset listing now expires staged images, so a fixture without the staging table would answer that read with an error.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | GET /characters no longer saves the starter character (a GET is admitted read-only on the native host, which refused that write), so a fresh owner's console opens on the explicit "Add the starter character" action instead of a card. openConsole waits for either, and a new case proves over Chromium and forced-RLS PostgreSQL that the studio's read saves nothing and that the action saves exactly one owner-bound starter, idempotently, without starting work.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { DisposablePostgres } from '@test-fixtures/disposable-postgres';
import { getRequestIdentity, runWithRequestIdentity } from '@/shared/services/database/request-identity';

// Match gallery.config.mjs even when the broader framework config supplies unit-test defaults.
vi.setConfig({ testTimeout: 30000, hookTimeout: 120000 });

vi.mock('@/shared/services/database', () => ({ runRuntimeSchemaBootstrap: vi.fn(async () => undefined) }));
vi.mock('@/app/routes/remote-client-routes', () => ({ remoteClientRegistry: {
  listClients: () => { throw new Error('No GPU lookup in character creation'); },
  enqueueTask: () => { throw new Error('No GPU dispatch in character creation'); },
} }));
import { createBotLoraRoutes } from '../src-routes/bot-lora-routes';
const fixture = new DisposablePostgres({ purpose: 'lora-character-console', roles: [
  { name: 'create_a', max: 6, options: '-c oshal.current_sub=create_a -c oshal.is_operator=off' },
  { name: 'create_b', options: '-c oshal.current_sub=create_b -c oshal.is_operator=off' },
] });
const pkg = fileURLToPath(new URL('..', import.meta.url));
let server: Server, browser: Browser, base: string;
let creationAdmission: (() => Promise<void>) | undefined;
const draft = { subject: 'tin-drummer', displayName: 'Tin Drummer', triggerWord: 'tindrummer',
  heroImage: 'hero-tin.png', identPrompt: 'A red tin drummer with two round eyes',
  negativePrompt: 'blur, rust, missing drum', identityStructure: 'a toy with a drum',
  identityViolation: 'a toy without a drum', baseModel: 'tin-checkpoint.safetensors' };

function ownerPool() {
  const sub = getRequestIdentity()?.sub;
  if (sub !== 'create_a' && sub !== 'create_b') throw new Error('Unbound creation fixture owner');
  return fixture.rolePool(sub);
}
function makeApp() {
  const pool = { query: (sql: string, params?: unknown[]) => ownerPool().query(sql, params), connect: async () => {
    const client = await ownerPool().connect();
    try { await creationAdmission?.(); return client; }
    catch (error) { client.release(true); throw error; }
  } };
  const ctx = { pool, appPackageDir: pkg, ticketService: { createTicket: () => { throw new Error('No tickets in creation proof'); } } } as any;
  const app = express(); app.use(express.json());
  app.get('/favicon.ico', (_req, res) => { res.status(204).end(); });
  app.use('/shared/ui', express.static(resolve(process.env.OSHAL_FRAMEWORK_ROOT || resolve(pkg, '../../oshal'), 'src/shared/ui')));
  app.use('/cockpit/css/themes', express.static(resolve(process.env.OSHAL_FRAMEWORK_ROOT || resolve(pkg, '../../oshal'), 'src/pages/cockpit/css/themes')));
  app.use('/api/lora', (req, res, next) => {
    const sub = /creation-owner=(create_[ab])(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    Object.assign(req, { oidc: { isAuthenticated: () => true, user: { sub } } });
    runWithRequestIdentity({ sub, isOperator: false }, next);
  }, createBotLoraRoutes(ctx));
  return app;
}
beforeAll(async () => {
  await fixture.start();
  for (let pass = 0; pass < 2; pass++) for (const name of ['058-lora-studio.sql', '100-lora-owner-rls.sql', '101-lora-cell-images.sql', '102-lora-character-identity.sql', '103-lora-dataset-images.sql', '104-lora-dataset-staging.sql']) {
    await fixture.pool.query(readFileSync(resolve(pkg, 'migrations', name), 'utf8'));
  }
  await fixture.pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO create_a, create_b');
  server = makeApp().listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
}, 120000);
beforeEach(async () => { await fixture.pool.query('TRUNCATE oshal_lora_characters CASCADE'); });
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  await fixture.stop();
});
function create(body: unknown, owner = 'create_a') {
  return fetch(base + '/api/lora/characters', { method: 'POST', headers: {
    'content-type': 'application/json', Cookie: `creation-owner=${owner}`,
  }, body: JSON.stringify(body) });
}
async function openConsole(owner = 'create_a') {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'creation-owner', value: owner, url: base }]);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route('**/*', async (route) => {
    if (!route.request().url().startsWith(base)) { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  await page.goto(base + '/api/lora/ui');
  expect((await page.request.get(base + '/shared/ui/css/surface-themes.css')).status()).toBe(200);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim())).not.toBe('');
  // A fresh owner has no characters (the list read saves nothing) and sees the starter action instead.
  await page.locator('#chars .card, #addStarterBtn').first().waitFor();
  return { context, page, errors, external };
}

async function holdInsertions() {
  await fixture.pool.query(`CREATE OR REPLACE FUNCTION fixture_hold_creation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.subject LIKE 'race-%' THEN PERFORM pg_advisory_xact_lock(48117, 92); END IF; RETURN NEW; END $$;
    CREATE TRIGGER fixture_hold_creation BEFORE INSERT ON oshal_lora_characters FOR EACH ROW EXECUTE FUNCTION fixture_hold_creation()`);
  const lease = await fixture.pool.connect();
  await lease.query('SELECT pg_advisory_lock(48117,92)');
  return async () => { await lease.query('SELECT pg_advisory_unlock(48117,92)'); lease.release(); };
}
async function concurrentReuse(field: 'heroImage' | 'identPrompt') {
  const release = await holdInsertions();
  let arrivals = 0;
  let admitted = false, openAdmission!: () => void;
  const admissionReady = new Promise<void>((done) => { openAdmission = done; });
  // Synchronize before BEGIN, not by extending the product's five-second SQL lock timeout.
  // A late fourth caller reproduces the old fixture's three 503s without this rendezvous.
  creationAdmission = async () => {
    if (++arrivals === 4) {
      if (field === 'heroImage') await new Promise((done) => setTimeout(done, 5500));
      admitted = true; openAdmission();
    }
    await admissionReady;
  };
  let admissionError: unknown;
  let observed: unknown;
  const pending = Array.from({ length: 4 }, (_, i) => create({ ...draft, subject: `race-${i}`,
    heroImage: field === 'heroImage' ? draft.heroImage : `hero-${i}.png`,
    identPrompt: field === 'identPrompt' ? draft.identPrompt : `Different identity ${i}` }));
  try {
    await vi.waitFor(() => expect(admitted).toBe(true), { timeout: 15000, interval: 30 });
    await vi.waitFor(async () => {
      const result = await fixture.pool.query("SELECT state, wait_event, query FROM pg_stat_activity WHERE usename='create_a'");
      observed = result.rows;
      expect(result.rows.filter((row) => row.wait_event === 'advisory')).toHaveLength(4);
    }, { timeout: 8000, interval: 30 });
  } catch (error) {
    admissionError = error;
  } finally {
    creationAdmission = undefined;
    openAdmission();
    await release();
    await Promise.allSettled(pending);
    await fixture.pool.query('DROP TRIGGER fixture_hold_creation ON oshal_lora_characters');
  }
  const responses = await Promise.all(pending);
  if (admissionError) throw new Error(`Concurrent admission failed: ${JSON.stringify({ observed,
    responses: await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() }))) })}`,
    { cause: admissionError });
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
  expect((await fixture.pool.query("SELECT * FROM oshal_lora_characters WHERE subject LIKE 'race-%'")).rows).toHaveLength(1);
}

describe('character console and storage acceptance', () => {
  it('saves nothing on the studio read and adds the owner-bound starter only on request, once', async () => {
    const { context, page, errors, external } = await openConsole();
    try {
      await page.locator('#addStarterBtn').waitFor();
      expect((await fixture.rolePool('create_a').query('SELECT * FROM oshal_lora_characters')).rows).toHaveLength(0);
      await page.locator('#addStarterBtn').click();
      await page.locator('#chars .card').filter({ hasText: 'Cyclops (oshbrainrot)' }).waitFor();
      await page.reload();
      await page.locator('#chars .card').filter({ hasText: 'Cyclops (oshbrainrot)' }).waitFor();
      expect((await fixture.rolePool('create_a').query('SELECT subject, owner_sub FROM oshal_lora_characters')).rows)
        .toEqual([{ subject: 'oshbrainrot', owner_sub: 'create_a' }]);
      expect((await fixture.rolePool('create_b').query('SELECT * FROM oshal_lora_characters')).rows).toHaveLength(0);
      const again = await fetch(base + '/api/lora/characters/starter', { method: 'POST', headers: {
        'content-type': 'application/json', Cookie: 'creation-owner=create_a' }, body: '{}' });
      expect(again.status).toBe(200);
      expect((await again.json()).characters).toHaveLength(1);
      expect((await fixture.pool.query('SELECT * FROM oshal_lora_characters')).rows).toHaveLength(1);
      expect((await fixture.pool.query('SELECT * FROM oshal_lora_models')).rows).toHaveLength(0);
      expect(errors).toEqual([]); expect(external).toEqual([]);
    } finally { await context.close(); }
  });

  it('creates all identity fields in the console, reloads them and starts no work', async () => {
    const { context, page, errors, external } = await openConsole();
    try {
      await page.getByText('Create a character', { exact: true }).click();
      for (const [key, value] of Object.entries(draft)) await page.locator(`#characterForm [name="${key}"]`).fill(value);
      await page.getByRole('button', { name: 'Save character' }).click();
      await page.locator('#createResult.ok').waitFor();
      expect(await page.locator('#createResult').innerText()).toContain('No training was started');
      await page.reload();
      await page.locator('#chars .card').filter({ hasText: 'Tin Drummer' }).click();
      await page.waitForFunction(() => document.getElementById('characterConfig')?.textContent?.includes('hero-tin.png'));
      const row = (await fixture.rolePool('create_a').query('SELECT * FROM oshal_lora_characters WHERE subject=$1', [draft.subject])).rows[0];
      expect(row).toMatchObject({ display_name: draft.displayName, trigger_word: draft.triggerWord,
        hero_image: draft.heroImage, ident_prompt: draft.identPrompt, negative_prompt: draft.negativePrompt,
        identity_structure: draft.identityStructure, identity_violation: draft.identityViolation, base_model: draft.baseModel, owner_sub: 'create_a' });
      expect(await page.locator('#characterConfig').innerText()).toContain(`lora-${row.id.replace(/-/g, '')}`);
      for (const value of Object.values(draft).slice(2)) expect(await page.locator('#characterConfig').innerText()).toContain(value);
      expect((await fixture.pool.query('SELECT * FROM oshal_lora_models')).rows).toHaveLength(0);
      expect(errors).toEqual([]); expect(external).toEqual([]);
      if (process.env.OSHAL_LORA_SCREENSHOT) await page.screenshot({ path: process.env.OSHAL_LORA_SCREENSHOT, fullPage: true });
    } finally { await context.close(); }
  });

  it('rejects invalid types, NULs and UTF-8 oversize fields before persistence', async () => {
    for (const body of [[], { ...draft, heroImage: {} }, { ...draft, displayName: 42 },
      { ...draft, identPrompt: 'x\0y' }, { ...draft, negativePrompt: '界'.repeat(683) },
      { ...draft, triggerWord: 'x'.repeat(2049) }]) {
      const response = await create(body);
      expect(response.status).toBe(400);
    }
    expect((await fixture.pool.query('SELECT * FROM oshal_lora_characters')).rows).toHaveLength(0);
  });

  it('accepts a 2048-byte identity and preserves another owner exact same identity', async () => {
    const body = { ...draft, identPrompt: '界'.repeat(682) + 'ab', ownerSub: 'create_b' };
    expect((await create(body)).status).toBe(201); expect((await create(body, 'create_b')).status).toBe(201);
    expect((await fixture.rolePool('create_a').query('SELECT * FROM oshal_lora_characters')).rows).toHaveLength(1);
    expect((await fixture.rolePool('create_b').query('SELECT * FROM oshal_lora_characters')).rows).toHaveLength(1);
    expect((await create(body, 'anonymous')).status).toBe(401);
  });

  it('serializes simultaneous hero reuse without a second persisted character', () => concurrentReuse('heroImage'));
  it('serializes simultaneous identity-sentence reuse without a second persisted character', () => concurrentReuse('identPrompt'));

  it('replaying the identity migration preserves a custom character using the starter public name', async () => {
    expect((await create({ ...draft, subject: 'oshbrainrot', identityStructure: '', identityViolation: '' })).status).toBe(201);
    await fixture.rolePool('create_b').query(`INSERT INTO oshal_lora_characters
      (subject,display_name,trigger_word,hero_image,ident_prompt,owner_sub) VALUES
      ('oshbrainrot','Starter','oshbrainrot','hero_brainrot_00002_.png',
      'a one-eyed leathery orange-red screaming cyclops creature, big single eye, wide toothy mouth, stubby clawed legs, long thin arms, glossy 3d render, italian brainrot meme style','create_b')`);
    const migration = readFileSync(resolve(pkg, 'migrations/102-lora-character-identity.sql'), 'utf8');
    await fixture.pool.query(migration); await fixture.pool.query(migration);
    const row = (await fixture.rolePool('create_a').query("SELECT * FROM oshal_lora_characters WHERE subject='oshbrainrot'")).rows[0];
    expect(row).toMatchObject({ hero_image: draft.heroImage, ident_prompt: draft.identPrompt,
      negative_prompt: draft.negativePrompt, identity_structure: null, identity_violation: null });
    const starter = (await fixture.rolePool('create_b').query('SELECT identity_structure,identity_violation FROM oshal_lora_characters')).rows[0];
    expect(starter).toEqual({ identity_structure: 'a one-eyed cyclops creature with a single big eye', identity_violation: 'a creature with two eyes' });
  });

  it('rolls a failed insert back, releases the owner lock and allows a clean retry', async () => {
    await fixture.pool.query(`CREATE FUNCTION fixture_reject_creation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture internal failure'; END $$;
      CREATE TRIGGER fixture_reject_creation AFTER INSERT ON oshal_lora_characters FOR EACH ROW EXECUTE FUNCTION fixture_reject_creation()`);
    try {
      const response = await create(draft);
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain('fixture internal failure');
      expect((await fixture.pool.query('SELECT * FROM oshal_lora_characters')).rows).toHaveLength(0);
      const idle = await fixture.pool.query("SELECT * FROM pg_stat_activity WHERE usename='create_a' AND state LIKE 'idle in transaction%'");
      expect(idle.rows).toHaveLength(0);
      const locks = await fixture.pool.query("SELECT l.* FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.usename='create_a' AND l.locktype='advisory'");
      expect(locks.rows).toHaveLength(0);
    } finally { await fixture.pool.query('DROP TRIGGER fixture_reject_creation ON oshal_lora_characters'); }
    expect((await create(draft)).status).toBe(201);
  });

  it('bounds lock contention, creates nothing on timeout and succeeds after release', async () => {
    const lease = await fixture.pool.connect();
    await lease.query('SELECT pg_advisory_lock(hashtextextended($1,0))', ['lora-character-create:create_a']);
    try {
      const response = await create(draft);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'character_creation_busy' });
      expect((await fixture.pool.query('SELECT * FROM oshal_lora_characters')).rows).toHaveLength(0);
    } finally {
      await lease.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', ['lora-character-create:create_a']); lease.release();
    }
    expect((await create(draft)).status).toBe(201);
  });

  it('cancels without a write and suppresses duplicate submits while a real save is pending', async () => {
    const { context, page, errors } = await openConsole();
    let posts = 0, release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    await page.route('**/api/lora/characters', async (route) => {
      if (route.request().method() === 'POST') { posts++; await held; }
      await route.continue();
    });
    try {
      await page.getByText('Create a character', { exact: true }).click();
      await page.locator('#characterForm [name="subject"]').fill('cancelled');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(posts).toBe(0);
      await page.getByText('Create a character', { exact: true }).click();
      expect(await page.locator('#characterForm [name="subject"]').inputValue()).toBe('');
      for (const [key, value] of Object.entries(draft)) await page.locator(`#characterForm [name="${key}"]`).fill(value);
      await page.getByRole('button', { name: 'Save character' }).click();
      await vi.waitFor(() => expect(posts).toBe(1));
      expect(await page.getByRole('button', { name: 'Save character' }).isDisabled()).toBe(true);
      await page.locator('#characterForm').evaluate((form) => (form as HTMLFormElement).requestSubmit());
      release(); await page.locator('#createResult.ok').waitFor();
      expect(posts).toBe(1);
      expect((await fixture.pool.query('SELECT * FROM oshal_lora_characters WHERE subject=$1', [draft.subject])).rows).toHaveLength(1);
      expect((await fixture.pool.query('SELECT * FROM oshal_lora_characters WHERE subject=$1', ['cancelled'])).rows).toHaveLength(0);
      expect(errors).toEqual([]);
    } finally { release(); await context.close(); }
  });

  it('shows a server refusal as text and preserves the draft for correction', async () => {
    expect((await create({ ...draft, subject: 'prior', displayName: '<img src=x onerror=alert(1)>' })).status).toBe(201);
    const { context, page, errors } = await openConsole();
    try {
      await page.getByText('Create a character', { exact: true }).click();
      for (const [key, value] of Object.entries(draft)) await page.locator(`#characterForm [name="${key}"]`).fill(value);
      await page.getByRole('button', { name: 'Save character' }).click();
      await page.locator('#createResult.err').waitFor();
      expect(await page.locator('#createResult').innerText()).toContain('prior');
      expect(await page.locator('#characterForm [name="heroImage"]').inputValue()).toBe(draft.heroImage);
      expect(await page.locator('#chars img').count()).toBe(0); expect(errors).toEqual([]);
      expect((await fixture.pool.query('SELECT * FROM oshal_lora_characters WHERE subject=$1', [draft.subject])).rows).toHaveLength(0);
    } finally { await context.close(); }
  });
});
