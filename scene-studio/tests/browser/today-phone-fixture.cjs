/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Lane mobilesweep1 (2026-11-16): the package's real page inside a stand-in for Today, in headless Chromium, on a synthetic origin with synthetic read-only answers (every write refused and listed, nothing leaves the browser). On a phone (412x915, 390x844, 360x780, touch) Today draws one 46 px bar and the floating Jarvis button (48 px) 12 px from the right and 69 px from the bottom, as Today's shell places it over an application with no bottom bar of its own; at 1440x900 a 56 px bar and a 56 px button 22 px in. Helpers measure what a person sees: where an element starts on the screen, rows of controls that wrap, sideways scroll, and the controls under the floating button.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Lane mobilesweep2 (Vids 1.6.7, Scene Studio 0.4.5): the synthetic origin is a *.localhost name, so the page runs in a secure context as it does on the kernel's origin; the shared editor's source-brief module calls crypto.randomUUID, which a plain http origin does not have.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// A *.localhost origin is a secure context, as the kernel's own origin is (the shared editor calls crypto.randomUUID).
const ORIGIN = 'http://today-fixture.localhost';
const SIZES = [{ width: 412, height: 915 }, { width: 390, height: 844 }, { width: 360, height: 780 }, { width: 1440, height: 900 }];

/** @description Playwright from the store toolchain (STORE_CI_TOOLCHAIN or scripts/toolchain beside this package). @returns {object} The module. */
function playwright() {
  const roots = [process.env.STORE_CI_TOOLCHAIN && path.join(process.env.STORE_CI_TOOLCHAIN, 'node_modules'), process.env.STORE_CI_TOOLCHAIN,
    path.resolve(__dirname, '../../../scripts/toolchain/node_modules'), path.resolve(__dirname, '../../scripts/toolchain/node_modules')].filter(Boolean);
  for (const root of roots) if (fs.existsSync(path.join(root, 'playwright'))) return require(path.join(root, 'playwright'));
  throw new Error(`BLOCKED: playwright not found (npm ci --prefix scripts/toolchain). Tried ${roots.join(', ')}`);
}

/**
 * @description The geometry of Today's bar and floating button at one size. On a phone the button rests 12 px above the
 * application's bottom inset (--oshal-app-bottom-inset on Today's page; 57 px by default under Today's one bar, 0 for an
 * application that draws its own whole frame instead of Today's bar).
 * @param {{width:number}} size The viewport. @param {boolean} [ownFrame] The application hides Today's bar.
 * @returns {object} Bar height, button size and offsets.
 */
function shellGeometry(size, ownFrame = false) {
  const phone = size.width <= 640;
  return phone ? { bar: ownFrame ? 0 : 46, orb: 48, right: 12, inset: ownFrame ? 0 : 57 } : { bar: ownFrame ? 0 : 56, orb: 56, right: 22, inset: 10 };
}

/** @description A stand-in Today page: its one bar, the application frame under it, and the floating Jarvis button. */
function todayHtml(url, size, ownFrame) {
  const g = shellGeometry(size, ownFrame);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;height:100%;overflow:hidden}header{height:${g.bar}px;background:#e8f2fd;display:flex;align-items:center;padding:0 12px;box-sizing:border-box;font:600 14px sans-serif}
.tool-view-container{position:fixed;top:${g.bar}px;left:0;right:0;bottom:0}.tool-view-container>iframe{display:block;width:100%;height:100%;border:0}
#jarvisOrbFab{position:fixed;right:${g.right}px;bottom:calc(12px + var(--oshal-app-bottom-inset, ${g.inset}px));width:${g.orb}px;height:${g.orb}px;border-radius:50%;border:1px solid #cbd5e1;background:#fff;z-index:2147483000}</style>
</head><body class="cockpit-body">${g.bar ? '<header class="tool-view-header">Application</header>' : ''}
<div class="tool-view-container"><iframe title="application" src="${url}"></iframe></div>
<button id="jarvisOrbFab" type="button" aria-label="Ask Jarvis">✦</button></body></html>`;
}

/** @description Content type by extension. @param {string} file Disk path. @returns {string} MIME type. */
function contentType(file) {
  const ext = path.extname(file);
  return { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }[ext] || 'application/javascript; charset=utf-8';
}

/**
 * @description Open the package's page inside the stand-in Today at one size.
 * @param {object} browser Chromium.
 * @param {{width:number,height:number}} size The viewport.
 * @param {{url:string, files:Record<string,string>, reads:Record<string,object>, scripts?:Record<string,string>, ready?:Function, ownFrame?:boolean}} spec
 *   The page URL, files served (URL path to disk path), JSON answers by path (a function gets the URL), stand-in script
 *   bodies by path (a kernel module the page imports), a wait for the page's own first paint, and whether the
 *   application draws its own whole frame (no Today bar).
 * @returns {Promise<{page:object, frame:object, context:object, writes:string[], errors:string[]}>} Today, the application frame and what was refused.
 */
async function openInToday(browser, size, spec) {
  const phone = size.width <= 640;
  const context = await browser.newContext({ viewport: size, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2.625 : 1 });
  const writes = [], errors = [];
  await context.route('**/*', (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (req.method() !== 'GET' && req.method() !== 'HEAD') { writes.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 405, contentType: 'application/json', body: '{"error":"read-only fixture"}' }); }
    if (url.pathname === '/__today__') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: todayHtml(spec.url, size, spec.ownFrame) });
    if (spec.scripts && Object.prototype.hasOwnProperty.call(spec.scripts, url.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: spec.scripts[url.pathname] });
    const file = spec.files[url.pathname];
    if (file) return route.fulfill({ status: 200, path: file, contentType: contentType(file) });
    if (Object.prototype.hasOwnProperty.call(spec.reads, url.pathname)) {
      const answer = spec.reads[url.pathname];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(typeof answer === 'function' ? answer(url) : answer) });
    }
    if (/\.css$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (/\.m?js$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"synthetic endpoint unavailable"}' });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error.message)));
  page.on('dialog', (dialog) => dialog.dismiss());
  await page.goto(`${ORIGIN}/__today__`, { waitUntil: 'load' });
  const frame = await (await page.waitForSelector('.tool-view-container > iframe')).contentFrame();
  await frame.waitForLoadState('load');
  if (spec.ready) await spec.ready(frame);
  await page.waitForTimeout(300);
  return { page, frame, context, writes, errors };
}

/** @description Where an element starts on the screen (Today's bar included), in px. @returns {Promise<number|null>} Its top, or null when it is not drawn. */
async function screenTop(page, frame, selector) {
  const frameTop = (await page.locator('.tool-view-container > iframe').boundingBox()).y;
  const top = await frame.evaluate((sel) => { const el = document.querySelector(sel); return el && el.getClientRects().length ? el.getBoundingClientRect().top : null; }, selector);
  return top === null ? null : Math.round(frameTop + top);
}

/** @description How many lines the visible children of each matching row take (1 = one row). @returns {Promise<number[]>} One count per row. */
function rowLines(frame, selector) {
  return frame.evaluate((sel) => [...document.querySelectorAll(sel)].filter((row) => row.getClientRects().length).map((row) => {
    const tops = [];
    for (const kid of row.children) {
      if (!kid.getClientRects().length) continue;
      const t = kid.getBoundingClientRect().top;
      if (!tops.some((x) => Math.abs(x - t) < 6)) tops.push(t);
    }
    return tops.length;
  }), selector);
}

/** @description The document's sideways scroll and the elements that run past the screen's right edge without a sideways scroller. @returns {Promise<object>} Measurements. */
function sideways(frame) {
  return frame.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const contained = (el) => { for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true; return false; };
    const offenders = [...document.body.querySelectorAll('*')].filter((el) => { const b = el.getBoundingClientRect(); return b.width && b.right > width + 1 && !contained(el); })
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} right=${Math.round(el.getBoundingClientRect().right)}`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: width, offenders: offenders.slice(0, 6) };
  });
}

/** @description Scroll the page (and its main scroller) to the end, then name the controls under the floating Jarvis button. @returns {Promise<string[]>} Their names. */
async function underOrbAtEnd(page, frame) {
  await frame.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    se.scrollTop = se.scrollHeight;
    for (const el of document.querySelectorAll('body *')) if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(400);
  const orb = await page.locator('#jarvisOrbFab').boundingBox(), box = await page.locator('.tool-view-container > iframe').boundingBox();
  const local = { top: orb.y - box.y, bottom: orb.y + orb.height - box.y, left: orb.x - box.x, right: orb.x + orb.width - box.x };
  return frame.evaluate((o) => [...document.querySelectorAll('button,a[href],input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="tab"]')]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('details:not([open]) > :not(summary)'))
    .filter((el) => { const b = el.getBoundingClientRect(); return b.bottom > o.top && b.top < o.bottom && b.right > o.left && b.left < o.right; })
    .map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30)), local);
}

module.exports = { ORIGIN, SIZES, playwright, openInToday, screenTop, rowLines, sideways, underOrbAtEnd, shellGeometry };
