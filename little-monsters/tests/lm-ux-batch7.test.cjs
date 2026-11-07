/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | UX audit 2026-11-06 batch-7 regressions for lm-storage (MERGE into My Files -> Saved, /api/education/storage redirect, empty state vs /api/files frame) and lm-voice-settings (student withholds server engines and operator disclosure, teacher sees them without an empty Text-to-speech heading, save-on-change writes localStorage without a Save button, single caveat sentence, live speed readout with Reset, and sans-serif title stack).
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (express, js-yaml, playwright, chromium).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLS = path.join(PKG, 'tools');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const yaml = require(path.join(TOOLCHAIN, 'js-yaml'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

/** @description Start a local fixture server for My Files, Storage and Voice Settings. @returns {Promise<object>} */
function serve(state) {
  const app = express();
  app.use(express.json());
  app.get('/api/education/files', (_req, res) => res.sendFile(path.join(TOOLS, 'files.html')));
  app.get('/api/education/storage', (_req, res) => res.sendFile(path.join(TOOLS, 'standard-view.html')));
  app.get('/api/education/voice-settings', (_req, res) => res.sendFile(path.join(TOOLS, 'voice-settings.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/education/lm-voice.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-voice.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ella', role: state.role, studentId: 's1' }));
  app.get('/api/education/rewards', (_req, res) => res.json({ xp: 20, level: 1 }));
  app.get('/api/education/catalog', (_req, res) => res.json({ textbooks: [] }));
  app.get('/api/files/list', (_req, res) => res.json({ files: state.files, totalBytes: state.files.length * 1024 }));
  app.get('/api/files', (_req, res) => res.type('html').send('<!doctype html><title>Files</title><main id="kernelFiles">Kernel files list</main>'));
  app.get('/api/education/voice-config', (_req, res) => res.json({ success: true, data: state.voiceConfig }));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js|png)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

test('lm-storage MERGE: tile removed from ui.static, /api/education/storage opens My Files -> Saved, empty state and framed /api/files work', async () => {
  const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
  const names = manifest.ui.static.map((t) => t.toolName);
  assert.ok(!names.includes('lm-storage'), 'lm-storage left ui.static');
  assert.ok(names.includes('lm-files') && names.includes('lm-voice-settings'));

  const state = { role: 'student', files: [], voiceConfig: {} };
  const { base, close } = await serve(state);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
    await page.goto(`${base}/api/education/storage`);
    await page.waitForURL(/\/api\/education\/files\?view=saved$/);
    await page.locator('#savedFilesEmpty:not([hidden])').waitFor();

    const tabs = await page.$$eval('.files-tabs [role="tab"]', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(tabs, ['My notes', 'Textbooks', 'Saved']);
    assert.equal(await page.getAttribute('#tab-saved', 'aria-selected'), 'true');
    assert.match(await page.textContent('#savedFilesEmpty'), /No saved work yet/);
    assert.match(await page.textContent('#savedFilesEmpty'), /Lecture PDFs and decks you make appear here\./);
    assert.equal(await page.locator('#savedFilesWrap').isVisible(), false);

    state.files = [{ name: 'Cell-Biology.pptx', size: 2048 }];
    await page.goto(`${base}/api/education/files?view=saved`);
    await page.locator('#savedFilesWrap:not([hidden])').waitFor();
    assert.equal(await page.locator('#savedFilesEmpty').isVisible(), false);
    const frame = page.frame({ url: /\/api\/files$/ });
    assert.ok(frame, 'frames /api/files below the view switch when saved files exist');
  } finally {
    await browser.close();
    close();
  }
});

test('lm-voice-settings: student sees no server engines or operator disclosure, saves on change without a Save button, updates speed live and resets', async () => {
  const state = {
    role: 'student',
    files: [],
    voiceConfig: {
      config: { tts: { default: 'gemini-tts' }, stt: { default: 'local-stt' } },
      tts: { providers: [] },
      stt: { providers: [{ id: 'local-stt', displayName: 'Local STT', kind: 'local', status: { configured: false, reason: 'Not set up' } }] },
    },
  };
  const { base, close } = await serve(state);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
    await page.goto(`${base}/api/education/voice-settings`);
    await page.locator('.lm-topbar[data-lm-ready]').waitFor();

    assert.equal(await page.locator('#enginesSection').isVisible(), false, 'student sees no engines section');
    assert.equal(await page.locator('#operatorSection').isVisible(), false, 'student sees no operators disclosure');
    assert.equal(await page.locator('#vSave').count(), 0, 'Save on this device button is gone');
    assert.equal(await page.locator('.lm-card .lm-btn-primary').count(), 1, 'Preview is the single primary');
    assert.match(await page.locator('.lm-card .lm-btn-primary').textContent(), /Preview/);
    assert.equal(await page.textContent('#vCaveat'), 'These choices are saved on this device.');

    const displayFont = await page.$eval('h1.lm-display', (h) => getComputedStyle(h).fontFamily);
    assert.doesNotMatch(displayFont, /Georgia|Times New Roman|(?<![a-z-])serif\b/i, `display font avoids serif fallback: ${displayFont}`);

    await page.selectOption('#vVoice', 'Puck');
    assert.equal(await page.evaluate(() => localStorage.getItem('lm-tts-voice')), 'Puck');
    assert.equal(await page.textContent('#vSavedStatus'), 'Saved');

    await page.$eval('#vRate', (el) => { el.value = '1.25'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.textContent('#vRateLabel'), '1.25×');
    assert.equal(await page.evaluate(() => localStorage.getItem('lm-tts-rate')), '1.25');

    await page.click('#vReset');
    assert.equal(await page.inputValue('#vVoice'), '');
    assert.equal(await page.textContent('#vRateLabel'), '1×');
    assert.equal(await page.evaluate(() => localStorage.getItem('lm-tts-voice')), '');
    assert.equal(await page.evaluate(() => localStorage.getItem('lm-tts-rate')), '1');

    state.role = 'teacher';
    await page.reload();
    await page.locator('#enginesSection:not([hidden])').waitFor();
    assert.equal(await page.locator('#operatorSection').isVisible(), true, 'teacher sees operator disclosure');
    const headings = await page.$$eval('#content h3', (hs) => hs.map((h) => h.textContent.trim()));
    assert.deepEqual(headings, ['Speech-to-text'], 'empty Text-to-speech provider list draws no empty h3');
  } finally {
    await browser.close();
    close();
  }
});
