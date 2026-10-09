/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove season responses and the real studio through HTTP, forced-RLS PostgreSQL and Chromium. Session identity, unrelated panels, bootstrap and forbidden provider dispatch are explicit seams; no render or Drive upload occurs.
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

const { forbidden } = vi.hoisted(() => ({ forbidden: vi.fn(() => { throw new Error('No provider, render or dispatch in surface proof'); }) }));
vi.mock('@/shared/services/database', () => ({ runRuntimeSchemaBootstrap: async () => undefined, buildOwnerRlsPolicyStatements: () => [] }));
vi.mock('@/features/agent-management', () => ({ BotNodeClient: class {}, createRegistryEndpointResolver: () => forbidden }));
vi.mock('@/features/video-generation', () => ({ renderVideo: forbidden, sanitizeStoryboard: forbidden, storyboardSeconds: forbidden,
  clampTargetSeconds: forbidden, veoCostPerSecond: forbidden, getVertexAccessToken: forbidden }));
vi.mock('@/app/routes/storage-target', () => ({ saveContent: forbidden, listFolder: forbidden }));
vi.mock('@/app/routes/inline-bot-execution', () => ({ executeBotOrInline: forbidden }));
vi.mock('@/app/routes/connectors-routes', () => ({ getValidAccessToken: forbidden }));
vi.mock('@/app/series-dispatch', () => ({ SCREENPLAY_WRITER_AGENT_ID: 'fixture-writer', isRenderInFlight: forbidden, dispatchStoryboardedEpisode: forbidden }));
vi.mock('@/app/series-pipeline', () => ({ writeSeries: forbidden, storyboardEpisode: forbidden }));
vi.mock('@/app/series-orchestrator', () => ({ approveSeries: forbidden, runVideoSeries: forbidden, advanceVideoSeries: forbidden }));
vi.mock('@/app/series-drive', () => ({ uploadFrameToDrive: forbidden }));
import { createBotVideoRoutes } from '../src-routes/video-routes';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || resolve(pkg, '../../oshal'));
const fixture = new DisposablePostgres({ purpose: 'video-season', roles: [
  { name: 'season_a', options: '-c oshal.current_sub=season_a -c oshal.is_operator=off' },
  { name: 'season_b', options: '-c oshal.current_sub=season_b -c oshal.is_operator=off' },
] });
const ids = [1, 2, 3, 4, 5].map(n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`);
const headers = (owner = 'season_a') => ({ Cookie: `season-owner=${owner}` });
let browser: Browser, server: Server, base: string;

beforeAll(async () => {
  await fixture.start();
  for (let pass = 0; pass < 2; pass++) {
    for (const name of ['066-video-series.sql', '067-video-episode-scenes.sql']) {
      await fixture.pool.query(readFileSync(resolve(pkg, 'migrations', name), 'utf8'));
    }
    for (const name of ['098-video-series-intro-clip.sql', '153-video-season-artifact.sql']) {
      await fixture.pool.query(readFileSync(resolve(framework, 'scripts/migrations', name), 'utf8'));
    }
  }
  await fixture.pool.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO season_a, season_b');
  const pool = { query: (sql: string, params?: unknown[]) => {
    const sub = getRequestIdentity()?.sub;
    if (sub !== 'season_a' && sub !== 'season_b') throw new Error('Unbound fixture database identity');
    return fixture.rolePool(sub).query(sql, params);
  } };
  const app = express();
  app.use(express.json());
  app.get('/favicon.ico', (_req, res) => { res.status(204).end(); });
  app.use('/shared/ui', express.static(resolve(framework, 'src/shared/ui')));
  // Adjacent artifact and personal-library panels are not part of this read-only series proof.
  app.get('/api/artifacts/send-to.js', (_req, res) => { res.type('js').send(''); });
  app.get('/api/create/brand-kit', (_req, res) => { res.json({}); });
  app.use('/api/video', (req, res, next) => {
    const sub = /season-owner=(season_[ab])(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    Object.assign(req, { oidc: { isAuthenticated: () => true, user: { sub } } });
    runWithRequestIdentity({ sub, isOperator: false }, next);
  });
  app.get('/api/video/list', (_req, res) => { res.json({ videos: [] }); });
  app.use('/api/video', createBotVideoRoutes({ pool, appPackageDir: pkg, ticketService: { createTicket: forbidden } } as any));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(done => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
}, 120000);

beforeEach(async () => {
  forbidden.mockClear();
  await fixture.pool.query('TRUNCATE video_series CASCADE');
  for (const [n, title, status, count, node, drive] of [
    [0, 'Delivered season', 'done', 2, 'fixture/season.mp4', 'https://drive.example/season'],
    [1, 'Node-only season', 'done', 2, 'fixture/season.mp4', null],
    [2, 'Stitching season', 'assembling', 2, null, null],
    [3, 'Single episode', 'done', 1, null, null],
    [4, 'Other owner private season', 'done', 2, 'private/season.mp4', 'https://drive.example/private'],
  ] as const) {
    await fixture.pool.query(`INSERT INTO video_series(series_id,user_sub,title,premise,status,episode_count,intro_clip,season_path,season_drive_url)
      VALUES ($1,$2,$3,'fixture premise',$4,$5,'fixture-intro.mp4',$6,$7)`, [ids[n], n === 4 ? 'season_b' : 'season_a', title, status, count, node, drive]);
  }
  for (const n of [2, 1]) await fixture.pool.query(`INSERT INTO video_episodes(series_id,user_sub,ordinal,title,status,drive_url)
    VALUES ($1,'season_a',$2,$3,'assembled',$4)`, [ids[0], n, `Episode ${n}`, `https://drive.example/episode-${n}`]);
});

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(done => server.close(() => done()));
  await fixture.stop();
});

async function openStudio() {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'season-owner', value: 'season_a', url: base }]);
  const page = await context.newPage();
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    if (!route.request().url().startsWith(base)) { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  await page.goto(`${base}/api/video/ui`);
  await page.locator('#seriesBox summary').click();
  await page.locator('#seriesList .vid').first().waitFor();
  return { context, page, errors, external };
}

async function denySeasonRead() {
  await fixture.pool.query('REVOKE SELECT ON video_series FROM season_a');
  await fixture.pool.query(`GRANT SELECT(series_id,user_sub,title,premise,episode_count,scenes_per_episode,status,ticket_id,created_at)
    ON video_series TO season_a`);
}

describe('Video season HTTP/database/browser acceptance', () => {
  it('shows ordered episodes and distinct Drive, node-only, stitching and no-season states', async () => {
    const { context, page, errors, external } = await openStudio();
    try {
      const delivered = page.locator('#seriesList .vid').filter({ hasText: 'Delivered season' });
      expect(await delivered.locator('a').evaluateAll(nodes => nodes.map(n => n.getAttribute('href'))))
        .toEqual(['https://drive.example/episode-1', 'https://drive.example/episode-2', 'https://drive.example/season']);
      const node = page.locator('#seriesList .vid').filter({ hasText: 'Node-only season' });
      expect(await node.textContent()).toContain('ready on the render node');
      expect(await node.locator('a').count()).toBe(0);
      expect(await page.locator('#seriesList .vid').filter({ hasText: 'Stitching season' }).textContent()).toContain('stitching');
      expect(await page.locator('#seriesList .vid').filter({ hasText: 'Single episode' }).textContent()).not.toContain('Season cut');
      expect(await page.locator('#seriesList').textContent()).not.toContain('Other owner');
      expect(errors).toEqual([]); expect(external).toEqual([]); expect(forbidden).not.toHaveBeenCalled();
    } finally { await context.close(); }
  });

  it('isolates owners through HTTP and real non-bypass roles and rejects anonymous reads/controls', async () => {
    const result = await (await fetch(`${base}/api/video/series`, { headers: headers('season_b') })).json();
    expect(result.series.map((s: any) => s.series_id)).toEqual([ids[4]]);
    expect((await fixture.rolePool('season_b').query('SELECT series_id FROM video_series')).rows).toEqual([{ series_id: ids[4] }]);
    expect((await fixture.rolePool('season_b').query('SELECT * FROM video_episodes')).rows).toHaveLength(0);
    expect((await fetch(`${base}/api/video/series`)).status).toBe(401);
    expect((await fetch(`${base}/api/video/series/${ids[0]}/approve`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`${base}/api/video/series/${ids[0]}/write`, { method: 'POST', headers: headers('season_b') })).status).toBe(404);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('keeps episodes available on a framework without the season columns', async () => {
    await fixture.pool.query('ALTER TABLE video_series DROP COLUMN season_path');
    try {
      const r = await fetch(`${base}/api/video/series`, { headers: headers() });
      expect(r.status).toBe(200);
      const series = (await r.json()).series.find((s: any) => s.series_id === ids[0]);
      expect(series.episodes).toHaveLength(2); expect(series.seasonPath).toBeNull(); expect(series.seasonDriveUrl).toBeNull();
    } finally { await fixture.pool.query('ALTER TABLE video_series ADD COLUMN season_path TEXT'); }
  });

  it('does not disguise actual permission failures as an older framework', async () => {
    await denySeasonRead();
    try { expect((await fetch(`${base}/api/video/series`, { headers: headers() })).status).toBe(502); }
    finally { await fixture.pool.query('GRANT SELECT ON video_series TO season_a'); }
  });

  it('never offers executable or credential-bearing season and episode links', async () => {
    await fixture.pool.query(`UPDATE video_series SET season_drive_url='javascript:alert(1)' WHERE series_id=$1`, [ids[0]]);
    await fixture.pool.query(`UPDATE video_episodes SET drive_url=CASE WHEN ordinal=1 THEN 'javascript:alert(1)' ELSE 'https://user:password@drive.example/file' END`);
    const { context, page } = await openStudio();
    try {
      const delivered = page.locator('#seriesList .vid').filter({ hasText: 'Delivered season' });
      expect(await delivered.locator('a').count()).toBe(0);
      expect(await delivered.textContent()).toContain('ready on the render node');
    } finally { await context.close(); }
  });

  it('clears stale success links and displays a read failure on refresh', async () => {
    const { context, page } = await openStudio();
    await denySeasonRead();
    try {
      await page.evaluate(async () => { await (window as any).loadSeries(); });
      expect(await page.locator('#seriesList a').count()).toBe(0);
      expect(await page.locator('#seriesList').textContent()).toContain('Could not load series');
    } finally { await fixture.pool.query('GRANT SELECT ON video_series TO season_a'); await context.close(); }
  });
});
