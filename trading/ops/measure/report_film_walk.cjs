/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The browser half of report_film_sandbox.py: signs in at /login with the throwaway installation's token, opens Trading, presses Film today's report and plays what comes back. Uses installed Chrome because the bundled Chromium has no H.264.
 */
'use strict';
const path = require('node:path'), fs = require('node:fs');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve(__dirname, '../../../scripts/toolchain/package.json'))('playwright');

(async () => {
  const [base, token, out] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await context.newPage(), problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(base + '/login');
    await page.getByText('Sign in with an access token').click();
    await page.locator('#loginTokenValue').fill(token);
    await page.getByRole('button', { name: 'Sign in with the token', exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
    await page.goto(base + '/cockpit/?app=intelligent-trades');
    const frame = page.frameLocator('iframe').first();
    await frame.getByText('Positions across all accounts').waitFor({ timeout: 60000 });
    await frame.getByRole('button', { name: 'Reports', exact: true }).click();
    const film = frame.getByRole('button', { name: "Film today's report", exact: true });
    await film.waitFor({ timeout: 30000 });
    const inner = await (await frame.locator('body').elementHandle()).ownerFrame();
    await inner.evaluate(() => {
      window.__said = [];
      new MutationObserver(() => {
        const line = document.getElementById('orVideoMsg')?.textContent || '';
        if (line && window.__said.at(-1) !== line) window.__said.push(line);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const started = Date.now();
    await film.click();
    await inner.waitForFunction(() => /ready below|could not be filmed|No saved|no connected/.test(document.getElementById('orVideoMsg')?.textContent || ''), null, { timeout: 120000 });
    const seconds = (Date.now() - started) / 1000;
    const said = await inner.evaluate(() => window.__said);
    const videos = await inner.evaluate(async () => {
      const found = [...document.querySelectorAll('#orVideoList video')];
      const out = [];
      for (const video of found) {
        video.muted = true;
        await new Promise((resolve) => { if (video.readyState >= 1) resolve(); else { video.onloadedmetadata = resolve; video.onerror = resolve; } });
        let played = 0, error = video.error ? video.error.message || String(video.error.code) : null;
        try { await video.play(); await new Promise((r) => setTimeout(r, 1500)); played = video.currentTime; video.pause(); } catch (e) { error = e.message; }
        const range = await fetch(video.currentSrc, { headers: { range: 'bytes=0-1023' } });
        out.push({ account: video.closest('figure')?.querySelector('b')?.textContent, duration: video.duration, played, error, range: range.status });
      }
      return out;
    });
    await frame.locator('#orVideos').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'report-films-panel.png') });
    console.log(JSON.stringify({ seconds, said, videos, problems }));
    if (!videos.length || videos.some((v) => !(v.played > 0) || v.range !== 206)) process.exitCode = 1;
  } catch (error) {
    await browser.contexts()[0]?.pages()[0]?.screenshot({ path: path.join(out, 'walk-failed.png') }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
