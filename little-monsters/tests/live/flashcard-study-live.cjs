/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.9.3 live check, read-only, on a running kernel at phone size (412x915, isMobile, hasTouch): open Flashcards in the cockpit as a signed-in learner, press Study on a set, and require that the study page shows that set's first card (not "No flashcards yet. Pick a set"), that the card flips to its back, that Got it! shows the next card face up, and that ← My flashcards returns to the list. It records the set id the study page received, the status of the cards read and every console error. Every request to the kernel that is not GET or HEAD is stopped and listed (Got it!'s review save among them), so the check changes nothing. The session token is read from a file and never printed; it goes to the kernel's own origin only.
 * -----------------------------------------------------------------------------
 *
 * usage: OSHAL_BROWSER_MODULE=<path to playwright> node little-monsters/tests/live/flashcard-study-live.cjs \
 *          <http://127.0.0.1:port> <session file: JSON {"token": "..."}> <screenshot dir> [set title]
 * Exit 0 when Study opens the set; 1 otherwise. Run it with DISPLAY and WAYLAND_DISPLAY unset.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.OSHAL_BROWSER_MODULE || 'playwright');

const [origin, sessionFile, outDir, wantedTitle] = process.argv.slice(2);

/** @description A path and query on the kernel's origin, or another site's origin and path. @param {string} u An address. @returns {string} */
function clean(u) {
  try { const x = new URL(u); return x.origin === origin ? x.pathname + x.search : x.origin + x.pathname; } catch (_) { return String(u).slice(0, 120); }
}

/** @description The frame (top page or any nested frame) where a test holds. @param {object} page The page. @param {Function} probe Runs in the frame. @returns {Promise<object|null>} */
async function findFrame(page, probe, tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    for (const frame of page.frames()) {
      if (await frame.evaluate(probe).catch(() => false)) return frame;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

/** @description What the study page shows now: its address, the card, the empty block and the progress. @param {object} frame The study frame. @returns {Promise<object>} */
function readStudy(frame) {
  return frame.evaluate(() => {
    const text = (id) => (document.getElementById(id) ? document.getElementById(id).textContent.replace(/\s+/g, ' ').trim() : null);
    return {
      address: location.pathname + location.search,
      setId: new URLSearchParams(location.search).get('setId'),
      front: text('cardFront'),
      back: text('cardBack'),
      flipped: document.getElementById('cardInner').classList.contains('flipped'),
      backHidden: document.getElementById('cardBackFace').getAttribute('aria-hidden'),
      progress: text('progressText'),
      empty: document.getElementById('emptyState').classList.contains('hide') ? '' : text('emptyState'),
    };
  });
}

(async () => {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '')) throw new Error('the origin must be a loopback kernel, http://127.0.0.1:<port>');
  if (!outDir) throw new Error('usage: flashcard-study-live.cjs <origin> <session file> <screenshot dir> [set title]');
  const token = JSON.parse(fs.readFileSync(sessionFile, 'utf8')).token;
  if (!token) throw new Error('the session file holds no token');
  fs.mkdirSync(outDir, { recursive: true });
  const out = { origin, at: new Date().toISOString(), failures: [] };
  const fail = (why) => out.failures.push(why);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    const stopped = [];
    await context.route((u) => new URL(u).origin === origin, (route) => {
      const request = route.request();
      if (request.method() !== 'GET' && request.method() !== 'HEAD') {
        let from = '';
        try { from = new URL(request.frame().url()).pathname; } catch (_) { from = ''; }
        stopped.push(`${request.method()} ${clean(request.url())} (from ${from})`);
        return route.abort();
      }
      return route.continue({ headers: { ...request.headers(), 'x-oshal-session': token } });
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const cardReads = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${m.text().slice(0, 200)} @ ${clean((m.location() || {}).url || '')}`); });
    page.on('pageerror', (e) => consoleErrors.push(`page error: ${String(e.message).slice(0, 200)}`));
    page.on('response', (r) => { if (/\/api\/education\/flashcards\/sets\/[^/]+\/cards/.test(r.url())) cardReads.push(`${r.status()} ${clean(r.url())}`); });
    const shot = (name) => page.screenshot({ path: path.join(outDir, name) });

    await page.goto(`${origin}/cockpit/?app=little-monsters&screen=lm-flashcards`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const hub = await findFrame(page, () => Boolean(document.getElementById('newSetBtn') && document.querySelector('.set-card, #app .lm-empty')), 120);
    if (!hub) throw new Error('no frame showed My flashcards');
    out.sets = await hub.$$eval('.set-card h3', (hs) => hs.length);
    const card = wantedTitle ? hub.locator('.set-card', { hasText: wantedTitle }).first() : hub.locator('.set-card').first();
    if (!(await card.count())) throw new Error(wantedTitle ? 'no set has that title' : 'the learner has no set to study');
    await card.scrollIntoViewIfNeeded();
    await shot('01-my-flashcards.png');
    out.pressed = await card.locator('[data-act="study"]').getAttribute('data-set');
    await card.locator('[data-act="study"]').tap();

    const study = await findFrame(page, () => Boolean(document.getElementById('cardContainer') && document.getElementById('emptyState')
      && (document.getElementById('cardFront').textContent !== 'Loading…' || !document.getElementById('emptyState').classList.contains('hide'))));
    if (!study) throw new Error('no frame showed the study page');
    await page.waitForTimeout(1500);
    out.opened = await readStudy(study);
    await shot('02-study.png');
    if (out.opened.setId !== out.pressed) fail(`the study page received set ${out.opened.setId}, not the pressed ${out.pressed}`);
    if (out.opened.empty) fail(`Study showed "${out.opened.empty}" instead of the set's first card`);

    if (!out.opened.empty) {
      await study.locator('#cardContainer').tap();
      await study.waitForFunction(() => document.getElementById('cardInner').classList.contains('flipped'), null, { timeout: 10000 }).catch(() => fail('the card did not flip'));
      await page.waitForTimeout(700);
      out.flipped = await readStudy(study);
      await shot('03-flipped.png');
      if (out.flipped.backHidden !== 'false' || !out.flipped.back) fail('the flipped card does not show its back');
      const first = out.opened.front;
      await study.locator('#answerBtns .lm-btn-success').tap();
      await study.waitForFunction((f) => document.getElementById('cardFront').textContent !== f, first, { timeout: 10000 }).catch(() => fail('Got it! did not move to the next card'));
      await page.waitForTimeout(700);
      out.next = await readStudy(study);
      await shot('04-next-card.png');
      if (out.next.flipped) fail('the next card did not start face up');
    }

    await study.locator('main a.lm-btn-quiet', { hasText: 'My flashcards' }).tap();
    const back = await findFrame(page, () => Boolean(document.getElementById('newSetBtn') && document.querySelector('.set-card')), 40);
    out.backToList = Boolean(back);
    if (!back) fail('← My flashcards did not return to the list');
    else await shot('05-back-to-list.png');

    out.cardReads = cardReads;
    out.consoleErrors = consoleErrors;
    out.stopped = stopped;
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(outDir, 'flashcard-study-live.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.failures.length ? 1 : 0);
})().catch((error) => {
  console.error(`flashcard-study-live: ${String((error && error.message) || error).slice(0, 300)}`);
  process.exit(1);
});
