/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Read-aloud uses the neural voice. Roger heard a robotic voice on the flashcards: the end-of-deck message called the browser's speechSynthesis directly, the dashboard's textbook reader and study pack never loaded lm-voice.js, and the Voice settings preview treated every working answer as a failure. Pins: every page that speaks loads lm-voice.js and reaches the browser voice only as the fallback after window.lmSpeak; in Chromium, lmSpeak plays the server's audio ({data:{audioData,format}}) without touching speechSynthesis and falls back to it only when the server refuses.
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (express, playwright, chromium).
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
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

/** Pages whose own job is the browser voice (the provider preview shows what each provider answers). */
const BROWSER_VOICE_PAGES = new Set(['voice-settings.html']);

test('every page that speaks loads the neural helper and uses the browser voice only as its fallback', () => {
  for (const file of fs.readdirSync(TOOLS).filter((name) => name.endsWith('.html') && !BROWSER_VOICE_PAGES.has(name))) {
    const lines = fs.readFileSync(path.join(TOOLS, file), 'utf8').split('\n');
    const speaks = lines.flatMap((line, i) => (/speechSynthesis\.speak\(/.test(line) ? [i] : []));
    if (!speaks.length) continue;
    assert.ok(lines.some((line) => line.includes('/api/education/lm-voice.js')), `${file} loads lm-voice.js`);
    for (const at of speaks) {
      const before = lines.slice(Math.max(0, at - 10), at).join('\n');
      assert.match(before, /window\.lmSpeak\b/, `${file}:${at + 1} reaches speechSynthesis only after window.lmSpeak`);
    }
  }
});

test('the Voice settings preview accepts the kernel answer, which has no success field', () => {
  const page = fs.readFileSync(path.join(TOOLS, 'voice-settings.html'), 'utf8');
  const preview = page.slice(page.indexOf("fetch('/api/voice/synthesize'"), page.lastIndexOf('Preview failed'));
  assert.ok(preview.length > 0, 'the provider preview calls /api/voice/synthesize');
  assert.doesNotMatch(preview, /body\.success/);
  assert.match(preview, /if \(!res\.ok \|\| !body\.data\)/);
});

/** A tiny valid WAV (silence), base64. */
function silentWav() {
  const samples = 800;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer.toString('base64');
}

test('lmSpeak plays the server voice and falls back to the browser voice only when the server refuses', async () => {
  let refuse = false;
  const app = express();
  app.use(express.json());
  app.get('/page', (_req, res) => res.type('html').send('<!doctype html><script src="/api/education/lm-voice.js"></script>'));
  app.get('/api/education/lm-voice.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-voice.js')));
  app.post('/api/voice/synthesize', (_req, res) => (refuse
    ? res.status(503).json({ refused: 'store_unavailable', detail: 'Speech provider unavailable' })
    : res.json({ data: { audioData: silentWav(), format: 'audio/wav' } })));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.__spoken = [];
      window.__played = 0;
      Object.defineProperty(window, 'speechSynthesis', { value: { speak: (u) => window.__spoken.push(u.text), cancel() {} } });
      window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function counted() { window.__played += 1; return play.call(this).catch(() => {}); };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/page`);
    await page.evaluate(() => window.lmSpeak('What is a variable?'));
    assert.deepEqual(await page.evaluate(() => [window.__played, window.__spoken]), [1, []], 'the server voice played; no browser voice');
    refuse = true;
    await page.evaluate(() => window.lmSpeak('Learning takes practice!'));
    assert.deepEqual(await page.evaluate(() => window.__spoken), ['Learning takes practice!'], 'a refused server falls back');
  } finally {
    await browser.close();
    server.close();
  }
});
