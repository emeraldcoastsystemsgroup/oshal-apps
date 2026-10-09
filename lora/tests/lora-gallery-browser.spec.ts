/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Drive real thumbnail bytes through package HTTP, forced-RLS PostgreSQL and Chromium; prove correct pixels, expiry without external fallback and deleted-run callback refusal. Session identity and bootstrap are explicit fixture seams; no GPU or deployment database is used.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve package browser/database time budgets under the framework's unit-default runner, including deterministic container cleanup.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Apply migration 104 with the rest of the package schema: the studio's dataset listing now expires staged images, so a fixture without the staging table would answer that read with an error.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Upload thumbnails as the worker holding a validate grant minted for the owner's character (migration 105) instead of with the fleet service secret; this proof forbids dispatch, so the grant is minted directly.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Thumbnail uploads pass the signed-package-callbacks verifier first (lora-callback-rail double), and the validate grant records its owner issuer (migration 106).
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
import { send, signedRequest, workerGrant, type WorkerGrant } from './helpers/lora-callback-signer';

vi.setConfig({ testTimeout: 30000, hookTimeout: 120000 });

// Migrations are applied twice to the fixture-owned server below. No lazy runtime DDL is needed.
vi.mock('@/shared/services/database', () => ({ runRuntimeSchemaBootstrap: vi.fn(async () => undefined) }));
vi.mock('@/app/routes/remote-client-routes', () => ({ remoteClientRegistry: { listClients: () => [], enqueueTask: () => { throw new Error('No GPU dispatch in gallery proof'); } } }));
import { createBotLoraRoutes } from '../src-routes/bot-lora-routes';
import { mintCallbackGrant } from '../src-routes/lora-callback-grants';
import { mountLoraIngest } from './helpers/lora-callback-rail';

const fixture = new DisposablePostgres({ purpose: 'lora-gallery', roles: [
  { name: 'gallery_a', options: '-c oshal.current_sub=gallery_a -c oshal.is_operator=off' },
  { name: 'gallery_b', options: '-c oshal.current_sub=gallery_b -c oshal.is_operator=off' },
] });
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secret = 'gallery-fixture-service-secret';
const pkg = fileURLToPath(new URL('..', import.meta.url));
let browser: Browser, server: Server, base: string, ctx: any;
let images: Buffer[];
let grant: WorkerGrant;
const imagePath = (cell = 0) => `/api/lora/cell-image?subject=gallery-fixture&version=1&cell=${cell}`;
const ownerHeaders = (owner = 'gallery_a') => ({ Cookie: `gallery-owner=${owner}` });

async function upload(cell: number, owner = 'gallery_a'): Promise<Response> {
  return send(signedRequest(base, grant, owner, 'POST',
    `/api/lora/ingest/cell-image?character=gallery-fixture&version=1&cell=${cell}&filename=cell-${cell}.png`,
    { bytes: images[cell], type: 'image/png' }));
}

beforeAll(async () => {
  vi.stubEnv('SWARM_SERVICE_SECRET', secret);
  await fixture.start();
  for (let pass = 0; pass < 2; pass++) for (const name of ['058-lora-studio.sql', '100-lora-owner-rls.sql', '101-lora-cell-images.sql', '102-lora-character-identity.sql', '103-lora-dataset-images.sql', '104-lora-dataset-staging.sql', '105-lora-callback-grants.sql', '106-lora-callback-identity.sql']) {
    await fixture.pool.query(readFileSync(resolve(pkg, 'migrations', name), 'utf8'));
  }
  await fixture.pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gallery_a, gallery_b');
  const pool = { query: (sql: string, params?: unknown[]) => {
    const sub = getRequestIdentity()?.sub;
    if (sub !== 'gallery_a' && sub !== 'gallery_b') throw new Error('Unbound fixture database identity');
    return fixture.rolePool(sub).query(sql, params);
  } };
  ctx = { pool, appPackageDir: pkg, ticketService: { createTicket: () => { throw new Error('No work dispatch in gallery proof'); } } } as any;
  const app = express();
  app.use(express.json());
  app.get('/favicon.ico', (_req, res) => { res.status(204).end(); });
  app.use('/shared/ui', express.static(resolve(process.env.OSHAL_FRAMEWORK_ROOT || resolve(pkg, '../../oshal'), 'src/shared/ui')));
  mountLoraIngest(app, ctx);
  app.use('/api/lora', (req, res, next) => {
    const sub = /gallery-owner=(gallery_[ab])(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    Object.assign(req, { oidc: { isAuthenticated: () => true, user: { sub } } });
    runWithRequestIdentity({ sub, isOperator: false }, next);
  }, createBotLoraRoutes(ctx));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  images = (await page.evaluate(() => ['red', 'lime'].map((color) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 2, 2);
    return canvas.toDataURL('image/png').split(',')[1];
  }))).map((value) => Buffer.from(value, 'base64'));
  await page.close();
}, 120_000);

beforeEach(async () => {
  await fixture.pool.query('TRUNCATE oshal_lora_characters CASCADE');
  await fixture.pool.query(`INSERT INTO oshal_lora_characters(id,subject,display_name,trigger_word,owner_sub)
    VALUES ($1,'gallery-fixture','Gallery fixture','fixture','gallery_a'),($2,'gallery-fixture','Other gallery','fixture','gallery_b');`, [A, B]);
  await fixture.pool.query(`INSERT INTO oshal_lora_models(character_id,version,status) VALUES ($1,1,'scored'),($2,1,'scored')`, [A, B]);
  const cells = [0, 1].map((i) => ({ cell: `cell-${i}`, score: .8, identity: .8, quality: .8, image: `cell-${i}.png` }));
  await fixture.pool.query(`INSERT INTO oshal_lora_scores(character_id,version,overall,cells) VALUES ($1,1,.8,$2::jsonb)`, [A, JSON.stringify(cells)]);
  grant = workerGrant((await runWithRequestIdentity({ sub: 'gallery_a', isOperator: false }, () => mintCallbackGrant(ctx.pool,
    { characterId: A, ownerSub: 'gallery_a', ownerIssuer: 'https://issuer.oshal.example.com', ticketId: 'gallery-validate-ticket', dispatchKind: 'validate' }))).token);
  for (const cell of [0, 1]) expect((await upload(cell)).status).toBe(200);
});

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  await fixture.stop();
  vi.unstubAllEnvs();
});

async function openGallery() {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'gallery-owner', value: 'gallery_a', url: base }]);
  const page = await context.newPage();
  const external: string[] = [], errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route('**/*', async (route) => {
    if (!route.request().url().startsWith(base)) { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  await page.goto(`${base}/api/lora/ui`);
  await page.locator('.card').filter({ hasText: 'Gallery fixture' }).click();
  await page.getByRole('button', { name: 'View scorecard' }).click();
  await page.locator('.cell').first().waitFor();
  return { context, page, external, errors };
}

describe('LoRA gallery real storage and browser acceptance', () => {
  it('displays the correct stored pixels in each scorecard cell', async () => {
    const { context, page, errors, external } = await openGallery();
    try {
      await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>('.cell img')).length === 2 &&
        Array.from(document.querySelectorAll<HTMLImageElement>('.cell img')).every((img) => img.complete && img.naturalWidth === 2));
      const pixels = await page.locator('.cell img').evaluateAll((nodes) => nodes.map((node) => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(node as HTMLImageElement, 0, 0);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
      }));
      expect(pixels).toEqual([[255, 0, 0, 255], [0, 255, 0, 255]]);
      expect(errors).toEqual([]); expect(external).toEqual([]);
    } finally { await context.close(); }
  });

  it('enforces session and real forced-RLS owner boundaries for identical subject names', async () => {
    expect((await fetch(base + imagePath())).status).toBe(401);
    expect((await fetch(base + imagePath(), { headers: ownerHeaders('gallery_b') })).status).toBe(404);
    const a = await fetch(base + imagePath(), { headers: ownerHeaders() });
    expect(a.status).toBe(200); expect(a.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await a.arrayBuffer())).toEqual(images[0]);
    expect((await fixture.rolePool('gallery_b').query('SELECT * FROM oshal_lora_cell_images')).rows).toHaveLength(0);
    expect((await fixture.rolePool('gallery_b').query('DELETE FROM oshal_lora_cell_images')).rowCount).toBe(0);
    expect((await fetch(`${base}/api/lora/models/gallery-fixture/1`, { method: 'DELETE', headers: ownerHeaders('gallery_b') })).status).toBe(200);
    expect((await fetch(base + imagePath(), { headers: ownerHeaders() })).status).toBe(200);
  });

  it('expired images are unavailable in HTTP and never fall back to a box-supplied URL', async () => {
    await fixture.pool.query("UPDATE oshal_lora_cell_images SET expires_at=now()-interval '1 second'");
    await fixture.pool.query(`UPDATE oshal_lora_scores SET cells=jsonb_set(cells,'{0,image}','"https://fixture.invalid/obsolete.png"'::jsonb)`);
    expect((await fetch(base + imagePath(), { headers: ownerHeaders() })).status).toBe(404);
    const { context, page, external } = await openGallery();
    try {
      expect(await page.locator('.cell img').count()).toBe(0);
      expect(await page.locator('.cell').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('no hosted image')]));
      expect(external).toEqual([]);
    } finally { await context.close(); }
  });

  it('deleting a run prevents a late thumbnail callback from restoring access', async () => {
    expect((await fetch(`${base}/api/lora/models/gallery-fixture/1`, { method: 'DELETE', headers: ownerHeaders() })).status).toBe(200);
    expect((await fetch(base + imagePath(), { headers: ownerHeaders() })).status).toBe(404);
    expect((await upload(0)).status).toBe(404);
    expect((await fetch(base + imagePath(), { headers: ownerHeaders() })).status).toBe(404);
    expect((await fixture.pool.query('SELECT * FROM oshal_lora_cell_images WHERE character_id=$1', [A])).rows).toHaveLength(0);
  });

  it('a model deletion cascades its images even when it does not use the route', async () => {
    await fixture.rolePool('gallery_a').query('DELETE FROM oshal_lora_models WHERE character_id=$1 AND version=1', [A]);
    expect((await fixture.pool.query('SELECT * FROM oshal_lora_cell_images WHERE character_id=$1', [A])).rows).toHaveLength(0);
  });

  it('a delayed callback cannot renew an expired run', async () => {
    await fixture.pool.query("UPDATE oshal_lora_models SET created_at=now()-interval '31 days' WHERE character_id=$1", [A]);
    expect((await fetch(base + imagePath(), { headers: ownerHeaders() })).status).toBe(404);
    expect((await upload(0)).status).toBe(404);
  });

  it('revalidation never shows an old image under a different scorecard cell', async () => {
    await fixture.pool.query(`UPDATE oshal_lora_scores SET cells=jsonb_set(cells,'{0,image}','"replacement.png"'::jsonb) WHERE character_id=$1`, [A]);
    expect((await fetch(base + imagePath(), { headers: ownerHeaders() })).status).toBe(404);
    expect((await fetch(base + imagePath(1), { headers: ownerHeaders() })).status).toBe(200);
    expect((await upload(0)).status).toBe(404);
    const body = await (await fetch(`${base}/api/lora/scorecard?subject=gallery-fixture&version=1`, { headers: ownerHeaders() })).json();
    expect(body.hostedCells).toEqual([1]);
  });
});
