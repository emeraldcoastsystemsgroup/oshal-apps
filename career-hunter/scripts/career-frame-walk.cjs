/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Walk Career as its own application through career-frame-preview.cjs: every screen of the Intelligent Career front door at 1440x900 and 412x915, saved as a picture, with what the frame drew (its sections, the section row, whether anything is wider than the screen); then the menus, another application's screen under Career's bar, and a search typed on Home. The browser holds no credential.
 *
 *   node scripts/career-frame-preview.cjs &        # the preview must be running
 *   node scripts/career-frame-walk.cjs <folder for pictures>
 */
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = createRequire(path.resolve(__dirname, '../../scripts/toolchain/package.json'))('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:38951';
const OUT = process.argv[2];
if (!OUT) throw new Error('usage: career-frame-walk.cjs <folder for pictures>');
fs.mkdirSync(OUT, { recursive: true });
const APP = '/cockpit/?app=intelligent-career';
const SCREENS = ['home', 'search', 'board', 'recruiters', 'insights', 'resume-studio', 'experience-library', 'master-record', 'strengthen', 'profile-studio',
  'submission-activity', 'settings', 'companies'];
const SIZES = { desktop: { viewport: { width: 1440, height: 900 } }, phone: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } };
const career = (page) => page.frames().find((frame) => /\/api\/career-hunter\//.test(frame.url()));

/** What the frame drew on the Career page the cockpit is showing. */
async function drawn(page) {
  const frame = career(page);
  if (!frame) return { error: 'no Career page in the cockpit' };
  return frame.evaluate(() => ({
    frame: document.documentElement.getAttribute('data-career-frame'), ready: Boolean(document.querySelector('.cf-topbar[data-cf-ready]')),
    sections: [...document.querySelectorAll('.cf-topbar nav a')].map((a) => a.textContent + (a.getAttribute('aria-current') ? '*' : '')),
    row: [...document.querySelectorAll('.cf-subnav a')].map((a) => a.textContent + (a.getAttribute('aria-current') ? '*' : '')),
    wider: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    cockpitHeader: top.getComputedStyle(top.document.querySelector('.header-bar') || top.document.body).display, address: top.location.search,
  })).catch((error) => ({ error: String(error.message).slice(0, 100) }));
}

async function screens(browser) {
  for (const [size, options] of Object.entries(SIZES)) {
    const context = await browser.newContext(options), page = await context.newPage();
    for (const screen of SCREENS) {
      await page.goto(BASE + APP + '&screen=career-hunter--career-' + screen, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(6000);
      await page.screenshot({ path: path.join(OUT, `${screen}-${size}.png`) });
      console.log(screen, size, JSON.stringify(await drawn(page)));
    }
    await context.close();
  }
}

async function menus(browser) {
  const context = await browser.newContext(SIZES.desktop), page = await context.newPage();
  await page.goto(BASE + APP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await career(page).click('.cf-more-desk > summary');
  await page.screenshot({ path: path.join(OUT, 'more-desktop.png') });
  await career(page).click('.cf-topbar nav a:has-text("Presence")');
  await page.waitForTimeout(5000);
  await career(page).click('.cf-subnav a:has-text("Portrait Studio")');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, 'portrait-studio-desktop.png') });
  console.log('another application under the bar', JSON.stringify(await drawn(page)), await career(page).getAttribute('#host', 'src'));
  await career(page).click('.cf-brand');
  await page.waitForTimeout(4000);
  await career(page).fill('#q', 'program manager');
  await career(page).click('#find button');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, 'searched-desktop.png') });
  console.log('search from Home', JSON.stringify(await drawn(page)), await career(page).evaluate(() => location.search));
  await context.close();
  const phone = await browser.newContext(SIZES.phone), small = await phone.newPage();
  await small.goto(BASE + APP, { waitUntil: 'domcontentloaded' });
  await small.waitForTimeout(6000);
  await career(small).tap('.cf-bottom-more > summary');
  await small.screenshot({ path: path.join(OUT, 'more-phone.png') });
  await phone.close();
}

(async () => {
  const browser = await chromium.launch();
  try { await screens(browser); await menus(browser); } finally { await browser.close(); }
})().catch((error) => { console.error(String(error.message).split('\n')[0]); process.exit(1); });
