/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (lm-recorder, FIX-BROKEN). With no microphone the timer ran and the page said 'Nice!'. Drives the shipped recorder in Chromium with getUserMedia stubbed three ways: refused, a silent stream and a stream with sound. Refused and silent stop the recording with role="alert" 'No microphone sound — allow the microphone and try again' and never 'Nice!'; with sound the level meter moves, Pause holds the take and Finish brings up the sticky 'Make the study materials'. Also: no hero and no '← Back', the record button is the one primary on the first screen, and Recent lectures lists GET /lectures/recent.
 * -----------------------------------------------------------------------------
 *
 * Needs the store toolchain (express, playwright, chromium).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const TOOLS = path.join(PKG, 'tools');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules');
const express = require(path.join(TOOLCHAIN, 'express'));
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const NO_MIC = 'No microphone sound — allow the microphone and try again';

/** @description Serve the recorder with a teacher identity, one class and one recent lecture. @returns {Promise<object>} */
function serve() {
  const app = express();
  app.get('/api/education/recorder', (_req, res) => res.sendFile(path.join(TOOLS, 'lecture-recorder.html')));
  app.get('/api/education/education.css', (_req, res) => res.sendFile(path.join(TOOLS, 'education.css')));
  app.get('/api/education/mascot.js', (_req, res) => res.sendFile(path.join(TOOLS, 'lm-mascot.js')));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.get('/api/education/me', (_req, res) => res.json({ name: 'Ms Rivera', role: 'teacher', studentId: 't1' }));
  app.get('/api/education/classes', (_req, res) => res.json({ classes: [{ class_id: 'c1', name: 'Biology', subject: 'Science', teacher_student_id: 't1' }] }));
  app.get('/api/education/lectures/recent', (_req, res) => res.json({ lectures: [
    { lecture_id: 'l1', class_id: 'c1', class_name: 'Biology', lecture_date: '2026-11-05T00:00:00.000Z', has_slides: true },
  ] }));
  app.use((req, res) => (req.method === 'GET' && /\.(css|js)$/.test(req.path) ? res.type(path.extname(req.path)).send('') : res.status(404).json({})));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

/** In-page stubs: no live captions, and getUserMedia refused / silent / with a tone. */
function stubMicrophone(mode) {
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
  navigator.mediaDevices.getUserMedia = async () => {
    if (mode === 'refused') throw new DOMException('Permission denied', 'NotAllowedError');
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    if (mode === 'sound') { const osc = ctx.createOscillator(); osc.frequency.value = 220; osc.connect(dest); osc.start(); }
    return dest.stream;
  };
}

/** @description Open the recorder with a microphone mode, choose the class and press record. @returns {Promise<object>} page */
async function openAndRecord(browser, base, mode) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  await page.addInitScript(stubMicrophone, mode);
  await page.goto(`${base}/api/education/recorder`);
  await page.waitForSelector('#recorder:not(.hide)');
  await page.selectOption('#classSelect', 'c1');
  await page.click('#recBtn');
  return page;
}

test('recorder: refused or silent microphone stops with the alert, never "Nice!"; sound records, pauses and finishes', async () => {
  const { base, close } = await serve();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    // First screen: no hero, no Back, the record button is the one primary, Recent lectures listed.
    const first = await browser.newPage({ viewport: { width: 412, height: 915 } });
    await first.goto(`${base}/api/education/recorder`);
    await first.waitForSelector('#recentList .lm-item');
    assert.equal(await first.locator('.lm-hero').count(), 0);
    assert.equal(await first.getByText('← Back').count(), 0);
    assert.equal(await first.locator('#recorder .lm-btn-primary:visible').count(), 0, 'no other primary before Finish');
    const rec = await first.locator('#recBtn').boundingBox();
    assert.ok(rec.width >= 64 && rec.height >= 64, `record button ${rec.width}x${rec.height}`);
    assert.match(await first.textContent('#recentList'), /Biology/);
    assert.match(await first.getAttribute('#recentList a', 'href'), /presentation\?lectureId=l1/);
    assert.match(await first.getAttribute('#lessonTitle', 'placeholder'), /^Lecture — /);
    await first.close();

    for (const mode of ['refused', 'silent']) {
      const page = await openAndRecord(browser, base, mode);
      await page.waitForSelector('#micAlert:not(.hide)', { timeout: 6000 });
      assert.equal(await page.getAttribute('#micAlert', 'role'), 'alert');
      assert.equal((await page.textContent('#micAlert')).trim(), NO_MIC, mode);
      assert.doesNotMatch(await page.textContent('#status'), /Nice/, mode);
      assert.equal(await page.locator('#recBtn.recording').count(), 0, `${mode}: recording stopped`);
      const t1 = await page.textContent('#timer');
      await page.waitForTimeout(1200);
      assert.equal(await page.textContent('#timer'), t1, `${mode}: the timer does not run on`);
      await page.close();
    }

    const page = await openAndRecord(browser, base, 'sound');
    await page.waitForTimeout(2600);
    assert.equal(await page.locator('#micAlert:not(.hide)').count(), 0, 'a microphone with sound keeps recording');
    assert.equal(await page.locator('#recBtn.recording').count(), 1);
    assert.ok(Number(await page.getAttribute('#levelMeter', 'aria-valuenow')) > 0, 'the level meter moves');
    await page.click('#pauseBtn');
    assert.equal(await page.textContent('#pauseBtn'), 'Resume');
    await page.click('#pauseBtn');
    await page.click('#finishBtn');
    await page.waitForSelector('#genBar:not(.hide)');
    assert.equal(await page.locator('#genBar').evaluate((el) => getComputedStyle(el).position), 'sticky');
    assert.equal(await page.locator('#recControls.hide').count(), 1);
    await page.close();
  } finally {
    await browser.close();
    close();
  }
});
