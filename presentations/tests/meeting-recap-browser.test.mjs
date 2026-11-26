/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.14: headless Chromium browser test for Meeting Recap UI at 1440x900 desktop and 412x915 phone viewports.
 */
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveBinary } from '../routes/meeting-recap/recap-media.mjs';

const execFile = promisify(execFileCb);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const STORE_ROOT = path.resolve(APP_ROOT, '..');

function resolveDep(name) {
  const bases = [
    process.env.STORE_CI_TOOLCHAIN && path.join(path.resolve(process.env.STORE_CI_TOOLCHAIN), 'package.json'),
    path.join(STORE_ROOT, 'scripts', 'toolchain', 'package.json'),
    process.env.OSHAL_FRAMEWORK && path.join(path.resolve(process.env.OSHAL_FRAMEWORK), 'package.json'),
    import.meta.url,
  ].filter(Boolean);
  for (const base of bases) {
    try { return createRequire(base)(name); } catch { /* continue */ }
  }
  throw new Error(`Missing test dependency: ${name}`);
}

async function buildTinyMp4(outPath) {
  const filter = [
    'color=c=0x00AA00:s=320x180:d=2:r=8[g]',
    'color=c=0xF200F2:s=320x180:d=2:r=8[m]',
    '[g][m]concat=n=2:v=1:a=0[v]',
    'sine=frequency=440:sample_rate=44100:duration=4[a]',
  ].join(';');
  await execFile(resolveBinary('ffmpeg'), [
    '-y', '-v', 'error', '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', outPath,
  ], { timeout: 60000 });
}

async function startBrowserFixture(t) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'recap-browser-'));
  const prevDataDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  process.env.OSHAL_PACKAGE_DATA_DIR = dataDir;
  const express = resolveDep('express');
  const PptxGen = resolveDep('pptxgenjs');
  const rows = new Map();

  const pool = {
    async query(sql, params = []) {
      const text = String(sql).trim();
      if (/^INSERT INTO oshal_presentation_recaps/i.test(text)) {
        const now = new Date().toISOString();
        rows.set(params[0], {
          id: params[0], owner_sub: params[1], title: params[2], source_filename: params[3],
          source_sha256: params[4], source_bytes: Number(params[5] || 0), duration_seconds: null,
          status: params[6], stage_message: params[7], minutes_processed: 0, total_minutes: 0,
          keyframes_count: 0, crop_mode: params[8], sample_interval_sec: Number(params[9]),
          theme: params[10], saved_deck_path: null, saved_deck_open_url: null,
          error_code: null, error_message: null, meta_json: params[11], created_at: now, updated_at: now,
        });
        return { rows: [], rowCount: 1 };
      }
      if (/^SELECT[\s\S]*FROM oshal_presentation_recaps[\s\S]*WHERE owner_sub = \$1 AND id = \$2/i.test(text)) {
        const r = rows.get(params[1]);
        return { rows: r && r.owner_sub === params[0] ? [r] : [], rowCount: r && r.owner_sub === params[0] ? 1 : 0 };
      }
      if (/^SELECT[\s\S]*FROM oshal_presentation_recaps[\s\S]*WHERE owner_sub = \$1/i.test(text)) {
        const list = [...rows.values()].filter((r) => r.owner_sub === params[0]);
        return { rows: list, rowCount: list.length };
      }
      if (/^UPDATE oshal_presentation_recaps SET/i.test(text)) {
        const r = rows.get(params[1]);
        if (!r || r.owner_sub !== params[0]) return { rows: [], rowCount: 0 };
        const setPart = text.match(/SET([\s\S]*)WHERE/i)[1];
        for (const assign of setPart.split(',').map((s) => s.trim())) {
          const m = /^(\w+)\s*=\s*\$(\d+)$/.exec(assign);
          if (m) r[m[1]] = params[Number(m[2]) - 1];
        }
        r.updated_at = new Date().toISOString();
        return { rows: [r], rowCount: 1 };
      }
      if (/^DELETE FROM oshal_presentation_recaps/i.test(text)) {
        rows.delete(params[1]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };

  const stubs = {
    express,
    '@/features/presentation-generation': {
      isThemeId: () => true,
      renderPptx: async (title, sections) => {
        const p = new PptxGen();
        p.addSlide().addText(title, { x: 0.5, y: 1, w: 8, h: 1 });
        for (const s of sections) p.addSlide().addText(s.title, { x: 0.5, y: 1, w: 8, h: 1 });
        const out = await p.write({ outputType: 'nodebuffer' });
        return Buffer.isBuffer(out) ? out : Buffer.from(out);
      },
    },
    '@/app/routes/storage-target': {
      saveContent: async (_c, _s, _k, name) => ({ provider: 'oshal-local', location: `oshal/deck/${name}`, downloadUrl: `/dl/${name}` }),
    },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '{}' }) },
  };
  const origLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return origLoad.call(this, request, parent, isMain);
  };

  const { createMeetingRecapRoutes } = await import(`../routes/meeting-recap-routes.mjs?b=${Date.now()}`);
  const app = express();
  app.get('/shared/ui/css/surface-themes.css', (_req, res) => { res.type('text/css').send(''); });
  app.get('/shared/ui/js/surface-theme.js', (_req, res) => { res.type('text/javascript').send(''); });
  app.use('/api/presentations/recap', createMeetingRecapRoutes({
    appPackageDir: APP_ROOT,
    pool,
    authorization: {
      registerResource() {},
      currentActor: () => ({ isActive: true, issuer: 'oshal-test', sub: 'browser-owner', principalId: 'p-1', tenantIds: ['t-1'] }),
      authorize: async () => ({ allowed: true }),
    },
  }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    Module._load = origLoad;
    if (prevDataDir === undefined) delete process.env.OSHAL_PACKAGE_DATA_DIR;
    else process.env.OSHAL_PACKAGE_DATA_DIR = prevDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { origin, dataDir };
}

test('Meeting Recap UI renders cleanly at 1440x900 desktop and 412x915 phone, completes upload + run, and shows artifacts', { timeout: 120000 }, async (t) => {
  const { chromium } = resolveDep('playwright');
  const { origin, dataDir } = await startBrowserFixture(t);
  const mp4 = path.join(dataDir, 'demo-call.mp4');
  const vtt = path.join(dataDir, 'demo-call.vtt');
  await buildTinyMp4(mp4);
  writeFileSync(vtt, 'WEBVTT\n\n00:00:00.200 --> 00:00:01.800\nWe decided to launch Meeting Recap in 2.20.14.\n\n00:00:02.200 --> 00:00:03.800\nAction item: share review deck with team.\n', 'utf8');

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 412, height: 915 }]]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    const dialogs = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.type()); void d.dismiss(); });

    await page.goto(`${origin}/api/presentations/recap/app`, { waitUntil: 'networkidle' });
    await page.locator('html[data-recap-ready="true"]').waitFor({ timeout: 10000 });
    const overflowBefore = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflowBefore, false, `${label}: zero horizontal overflow on initial load`);

    if (label === 'desktop') {
      await page.fill('#mr-title', 'Weekly Design Sync');
      await page.setInputFiles('#mr-media-file', mp4);
      await page.setInputFiles('#mr-transcript-file', vtt);
      await page.click('#mr-start-btn');
      await page.locator('#mr-artifacts .mr-art-card[data-artifact="review.pptx"]').waitFor({ state: 'visible', timeout: 30000 });
      assert.equal(await page.locator('#mr-artifacts .mr-art-card').count(), 3, 'all 3 artifact cards rendered');
      assert.ok((await page.locator('#mr-keyframe-gallery img').count()) >= 1, 'cropped keyframe gallery rendered');
      assert.match(await page.locator('#mr-timeline-view').textContent(), /Meeting Recap in 2\.20\.14/);
      await page.click('#mr-save-files-btn');
      await page.locator('#mr-open-office-link').waitFor({ state: 'visible', timeout: 10000 });
    }
    const overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflowAfter, false, `${label}: zero horizontal overflow after interactions`);
    assert.deepEqual(errors, [], `${label}: zero pageErrors`);
    assert.deepEqual(dialogs, [], `${label}: zero native browser dialogs`);
    await context.close();
  }
});
