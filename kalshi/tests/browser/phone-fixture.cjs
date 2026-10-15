/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Phone-width fixture for the package's own page in headless Chromium: the real page file from disk on a synthetic origin, synthetic read-only answers for the routes the test names, every write refused and recorded, nothing leaves the browser. Measures what a person sees at 412 x 915 (a phone) and 392 x 641 (the same phone's cockpit application frame).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = 'http://phone.fixture.test';
/** The two widths a phone shows a store page at: the whole screen, and the cockpit's application frame on it. */
const VIEWPORTS = [{ width: 412, height: 915 }, { width: 392, height: 641 }];

/** @description Load Playwright from the store toolchain or a sibling checkout. @returns {object} The playwright module. */
function playwright() {
  const roots = [process.env.STORE_CI_TOOLCHAIN, process.env.KALSHI_BROWSER_DEPS && path.join(process.env.KALSHI_BROWSER_DEPS, 'node_modules'),
    path.resolve(__dirname, '../../../scripts/toolchain/node_modules'), path.resolve(__dirname, '../../../../oshal-apps/scripts/toolchain/node_modules'),
    path.resolve(__dirname, '../../../../oshal/src/node_modules')].filter(Boolean);
  for (const root of roots) if (fs.existsSync(path.join(root, 'playwright'))) return require(path.join(root, 'playwright'));
  throw new Error(`BLOCKED: playwright not found (npm ci --prefix scripts/toolchain). Tried ${roots.join(', ')}`);
}

/**
 * @description Open one page at one viewport with only synthetic answers.
 * @param {object} browser Chromium browser.
 * @param {{width:number,height:number}} viewport Viewport.
 * @param {{url:string, files:Record<string,string>, reads:Record<string,object>, framed?:boolean}} spec Page URL, served files (URL path
 *   to disk path), JSON reads; framed puts the page in a full-size iframe, as the cockpit shows an application (pages add
 *   framed-only controls such as "Open full page").
 * @returns {Promise<{page:object, context:object, writes:string[]}>} The page (the iframe's frame when framed) and the refused writes.
 */
async function openPage(browser, viewport, spec) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const writes = [];
  await context.route('**/*', (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (req.method() !== 'GET') { writes.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 405, contentType: 'application/json', body: '{"error":"read-only fixture"}' }); }
    if (url.pathname === '/__phone_frame__') return route.fulfill({ status: 200, contentType: 'text/html', body: FRAME_HTML(spec.url) });
    const file = spec.files[url.pathname];
    if (file) return route.fulfill({ status: 200, path: file, contentType: contentType(file) });
    if (Object.prototype.hasOwnProperty.call(spec.reads, url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(spec.reads[url.pathname]) });
    if (/\.css$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (/\.m?js$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"synthetic endpoint unavailable"}' });
  });
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.dismiss());
  if (!spec.framed) {
    await page.goto(ORIGIN + spec.url, { waitUntil: 'load' });
    return { page, context, writes };
  }
  await page.goto(`${ORIGIN}/__phone_frame__`, { waitUntil: 'load' });
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForLoadState('load');
  return { page: frame, context, writes };
}

/** A parent page that shows the application in a full-size iframe, like the cockpit's application frame. */
const FRAME_HTML = (url) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}
iframe{display:block;border:0;width:100%;height:100%}</style><iframe title="application" src="${url}"></iframe>`;

/** @description Content type by extension. @param {string} file Disk path. @returns {string} MIME type. */
function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/javascript; charset=utf-8';
}

/**
 * @description What sticks out of the screen: the document's own sideways scroll, and every element whose right edge
 * passes the screen without an ancestor that scrolls or clips it sideways (a table in its own scrolling box is fine).
 * @param {object} page Playwright page or frame.
 * @returns {Promise<{scrollWidth:number, clientWidth:number, offenders:string[]}>} Measurements.
 */
function overflow(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const contained = (el) => {
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    const offenders = [];
    for (const el of document.body.querySelectorAll('*')) {
      const box = el.getBoundingClientRect();
      if (!box.width || box.right <= width + 1 || contained(el)) continue;
      offenders.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).join('.') : ''} right=${Math.round(box.right)}`);
    }
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: width, offenders: offenders.slice(0, 6) };
  });
}

module.exports = { ORIGIN, VIEWPORTS, playwright, openPage, overflow };
