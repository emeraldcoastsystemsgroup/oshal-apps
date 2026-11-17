/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.10.0 phone design guard (Roger, 2026-11-16, his phone at 412 px: "designed terrible"; the first market sat 51-59% down the screen). The real tools/kalshi.html in Chromium, inside a stand-in for Today's shell (the parts the page touches: the header with menu, Apps, help and profile, the application's own bar laid into its middle with Reload in the shell's inline box style, the frame, the floating Jarvis button where jarvis-orb.js puts it), with synthetic markets built by the package's own explainer (routes/kalshi-market-explainer.js). At 412x915, 390x844, 360x780 and 1440x900: the first card's top edge within the top 30% of the screen, one app bar (the shell's, carrying this page's search and help icons, Reload a small icon with no box), the categories one chip row, no sideways page scroll, plain words (no monster, fold, playable or verdict), Why from a tap on a card (Back closes it and stays in Kalshi), the floating Jarvis button over nothing at the end of the list, equal bottom tabs and every view reachable; the merged search and the Filter sheet; standalone, the page's own bar. Reads only; every write is refused and counted.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { playwright, overflow } = require('./browser/phone-fixture.cjs');

const { PHONES, DESKTOP, JARGON, FIRST_MARKET, openKalshi: open, screenRects } = require('./browser/phone-design-fixture.cjs');

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

/** @description Open the page at one size in the shell (default) or by itself, cards loaded. */
function openKalshi(size, opts) { return open(browser, size, opts); }

/** @description The words a person reads on the Markets screen: the top lines and the Markets panel, as rendered. */
function marketWords(frame) {
  return frame.evaluate(() => [document.querySelector('.kx-top') || document.querySelector('.topbar header'), document.querySelector('[data-panel="markets"]'), document.querySelector('.tabnav')]
    .filter(Boolean).map((el) => el.innerText).join('\n'));
}

for (const size of [...PHONES, DESKTOP]) {
  test(`${size.width}x${size.height}: the first card sits in the top 30%, under one slim bar, the categories are one chip row and nothing scrolls sideways`, async () => {
    const { page, top, context, writes } = await openKalshi(size);
    try {
      const [first] = await screenRects(top, page, FIRST_MARKET);
      assert.ok(first.top <= size.height * 0.3, `first market top ${Math.round(first.top)} px (${Math.round((first.top / size.height) * 100)}%) is within ${Math.round(size.height * 0.3)} px (30%)`);
      assert.ok(await page.locator('#mk-list .kx-card').count() > 0, 'the list is cards');
      const chips = await page.evaluate(() => { const row = document.getElementById('kx-chips'), all = row ? [...row.querySelectorAll('.kx-chip')] : [];
        return { count: all.length, tops: [...new Set(all.map((c) => c.offsetTop))], scrolls: row ? getComputedStyle(row).overflowX : 'none', height: row ? row.getBoundingClientRect().height : 0 }; });
      assert.equal(chips.count, 9, 'All plus the eight categories');
      assert.deepEqual([chips.tops.length, chips.scrolls], [1, 'auto'], 'one row that scrolls sideways');
      assert.ok(chips.height <= 48, `the chip row is one 44 px line (${Math.round(chips.height)} px)`);
      for (const doc of [await overflow(page), await overflow(top)]) {
        assert.ok(doc.scrollWidth <= doc.clientWidth, `no sideways scroll (${doc.scrollWidth} > ${doc.clientWidth})`);
        assert.deepEqual(doc.offenders, [], 'nothing sticks out of the screen');
      }
      const lines = await page.evaluate(() => ['kx-status', 'kx-fresh'].map((id) => { const el = document.getElementById(id); return el ? { h: el.getBoundingClientRect().height, text: el.innerText, cut: el.scrollWidth > el.clientWidth + 1 } : { h: 0, text: `(no #${id})`, cut: false }; }));
      for (const line of lines) assert.ok(line.h <= 22 && !line.cut, `one whole line: "${line.text}" (${Math.round(line.h)} px${line.cut ? ', cut off' : ''})`);
      assert.match(lines[0].text, /^Paper trading · Connect your Kalshi account/);
      assert.match(lines[1].text, /^Scanned \d+ min ago · model from .+, \d+ days old$/);
      const bar = await top.evaluate(() => { const r = (el) => el && el.getClientRects().length ? true : false, reload = document.querySelector('[data-tool-view-reload]'), cs = getComputedStyle(reload);
        return { name: document.querySelector('.tool-view-header > span').textContent, search: r(document.querySelector('.kalshi-host-actions [data-kalshi-host="search"]')),
          help: r(document.querySelector('.kalshi-host-actions [data-kalshi-host="help"]')), shellHelp: r(document.getElementById('surfaceHelpBtn')), profile: r(document.getElementById('profileBtn')),
          reloadBorder: cs.borderTopColor, reloadGlyph: parseFloat(cs.fontSize) }; });
      assert.deepEqual([bar.name, bar.search, bar.help, bar.shellHelp, bar.profile], ['Kalshi', size.width <= 640, true, false, true], 'title, search (phone), this page\x27s help and profile; the shell\x27s general help steps aside');
      if (size.width <= 640) assert.ok(bar.reloadBorder === 'rgba(0, 0, 0, 0)' && bar.reloadGlyph >= 18, `Reload is a small icon with no box (${bar.reloadBorder}, ${bar.reloadGlyph}px)`);
      const own = await page.evaluate(() => { const bar = document.getElementById('kx-appbar'); return { bar: bar ? Boolean(bar.getClientRects().length) : false, host: document.documentElement.getAttribute('data-kx-host') }; });
      assert.deepEqual(own, { bar: false, host: 'cockpit' }, 'the page draws no second bar under the shell\x27s');
      assert.doesNotMatch(await marketWords(page), /predictive edge scan|trading active/, 'no second title line, no "trading active"');
      assert.deepEqual(writes, [], 'reads only');
    } finally { await context.close(); }
  });
}

test('412x915: the words are plain: a card says Buy Yes and No, when it closes, our estimate and the edge; no monster, fold, playable or verdict', async () => {
  const { page, context } = await openKalshi(PHONES[0]);
  try {
    const words = await marketWords(page);
    assert.doesNotMatch(words, JARGON, 'the Markets screen');
    const card = await page.locator(FIRST_MARKET).first().innerText();
    assert.match(card, /Buy\s*Yes \d+(\.\d)?¢\s*No \d+(\.\d)?¢\s*Big edge/, 'the price to buy each side, then the rating');
    assert.match(card, /Our estimate \d+% (Yes|No) · [+−]\d+\.\d¢ on (Yes|No)/, 'our estimate and the edge in words');
    assert.match(card, /Closes in \d+ (min|h) · [\d,]+ traded/, 'when it closes');
    const ratings = await page.locator('#mk-list .kx-rate').allTextContents();
    for (const r of ['Big edge', 'Good edge', 'Small edge', 'No edge', 'No estimate']) assert.ok(ratings.includes(r), `${r} is a rating on the list`);
    const lines = await page.locator('#mk-list .kx-card .kx-q').evaluateAll((all) => all.map((q) => Math.round(q.getBoundingClientRect().height / parseFloat(getComputedStyle(q).lineHeight))));
    assert.ok(Math.max(...lines) <= 2, 'the question takes two lines at most');
    await page.locator('#kx-filter-open').tap();
    const sheet = await page.locator('#kx-filter').innerText();
    assert.doesNotMatch(sheet, JARGON, 'the Filter sheet');
    assert.match(sheet, /Show[\s\S]*All markets\s*64[\s\S]*With an edge\s*39[\s\S]*No edge\s*13[\s\S]*No estimate\s*12[\s\S]*Sort by[\s\S]*Best rating first[\s\S]*Closing soonest[\s\S]*Biggest edge[\s\S]*Most traded/i);
  } finally { await context.close(); }
});

test('412x915: a tap on a card opens Why as a sheet with the walkthrough; Back closes it and stays in Kalshi', async () => {
  const { page, top, context } = await openKalshi(PHONES[0]);
  try {
    assert.ok(await page.locator('#mk-list .kx-card').count() > 0, 'the list is cards to tap');
    const ticker = await page.locator('#mk-list .kx-card').first().getAttribute('data-ticker');
    await page.locator('#mk-list .kx-card').first().tap();
    await page.waitForFunction(() => document.getElementById('kx-why').open && /Price vs chance/.test(document.getElementById('kx-why-body').textContent));
    const why = await page.locator('#kx-why').innerText();
    assert.match(why, new RegExp(ticker));
    assert.match(why, /scan: (YES|NO) at \d+\.\d¢ against a \d+(\.\d)?% calibrated chance/, 'the walkthrough headline, without its rating word');
    assert.doesNotMatch(why.split('Price vs chance')[0], JARGON, 'the sheet\x27s top reads in plain words');
    assert.match(why, /Ask the quant/);
    assert.equal(await top.locator('#jarvisOrbFab').isVisible(), false, 'the floating Jarvis button steps aside while a sheet is open');
    await top.evaluate(() => history.back());
    await page.waitForFunction(() => !document.getElementById('kx-why').open);
    assert.match(page.url(), /\/api\/kalshi\/$/, 'still on Kalshi');
    await top.waitForFunction(() => getComputedStyle(document.getElementById('jarvisOrbFab')).display !== 'none', null, { timeout: 5000 });
    await page.locator('#mk-list .kx-card').nth(1).tap();
    await page.waitForFunction(() => document.getElementById('kx-why').open);
    await page.locator('#kx-why [data-sheet-close]').tap();
    await page.waitForFunction(() => !document.getElementById('kx-why').open && !(history.state && history.state.kxSheet));
  } finally { await context.close(); }
});

for (const size of [...PHONES, DESKTOP]) {
  test(`${size.width}x${size.height}: at the end of the list the floating Jarvis button covers nothing`, async () => {
    const { page, top, context } = await openKalshi(size);
    try {
      await page.evaluate(() => { document.getElementById('mk-more').click(); });
      await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 64, FIRST_MARKET);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(150);
      const orb = await top.evaluate(() => { const b = document.getElementById('jarvisOrbFab').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; });
      assert.ok(size.height - orb.top >= 78, `the stand-in button rests where the shell puts it (${Math.round(size.height - orb.top)} px up)`);
      const under = (await screenRects(top, page, FIRST_MARKET + ', [data-panel="markets"] button, [data-panel="markets"] a'))
        .filter((r) => r.bottom > orb.top && r.top < orb.bottom && r.right > orb.left && r.left < orb.right);
      assert.deepEqual(under.map((r) => r.text), [], 'nothing of the list under the button');
      if (size.width <= 640) {
        const [bar] = await screenRects(top, page, '.tabnav');
        assert.ok(orb.bottom <= bar.top, `the button rests above the bottom bar (${Math.round(orb.bottom)} <= ${Math.round(bar.top)})`);
      }
    } finally { await context.close(); }
  });
}

test('phones: five equal bottom tabs edge to edge, no unexplained dot, and every view opens', async () => {
  for (const size of PHONES) {
    const { page, context } = await openKalshi(size);
    try {
      const tabs = await page.evaluate(() => [...document.querySelectorAll('.tabnav > .tab, .tabnav > .more-tab')].filter((t) => t.getClientRects().length)
        .map((t) => { const b = t.getBoundingClientRect(); return { label: t.innerText.trim(), left: b.left, right: b.right, width: b.width }; }));
      assert.deepEqual(tabs.map((t) => t.label), ['Markets', 'Scan', 'Account', 'Scorecard', 'More']);
      const widths = tabs.map((t) => t.width);
      assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, `equal tabs at ${size.width}: ${widths.map(Math.round).join(', ')}`);
      assert.ok(tabs[0].left <= 1 && tabs[4].right >= size.width - 1, 'edge to edge');
      assert.equal(await page.locator('.tab-dot').count(), 0, 'no dot on a tab');
      for (const tab of ['scan', 'account', 'scorecard', 'markets']) {
        await page.locator(`.tab[data-tab="${tab}"]`).tap();
        assert.equal(await page.locator(`[data-panel="${tab}"]`).isVisible(), true, `${tab} opens`);
      }
      for (const view of ['trends', 'alerts', 'settings']) {
        await page.locator('#tab-more').tap();
        await page.locator(`#more-menu [data-more="${view}"]`).tap();
        assert.equal(await page.locator(`[data-panel="${view}"]`).isVisible(), true, `${view} opens from More`);
      }
    } finally { await context.close(); }
  }
});

test('412x915: the bar\x27s search icon opens one field: words filter the list, a ticker and Enter opens its Why; Filter changes what shows', async () => {
  const { page, top, context, requests } = await openKalshi(PHONES[0]);
  try {
    assert.equal(await top.locator('.kalshi-host-actions [data-kalshi-host="search"]').count(), 1, 'a search icon in the bar');
    assert.equal(await page.locator('#mk-lookup').isVisible(), false, 'search waits behind its icon');
    await top.locator('.kalshi-host-actions [data-kalshi-host="search"]').tap();
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'mk-q');
    await page.locator('#mk-q').fill('coastal test city 7 ');
    await page.waitForFunction(() => /match/.test(document.getElementById('mk-counts').textContent));
    assert.ok(requests.some((r) => /\/api\/kalshi\/markets\?q=coastal\+test\+city\+7/.test(r)), 'the words are the list\x27s query');
    await page.locator('#mk-q').fill('kxfixture-26nov18-t1');
    assert.match(await page.locator('#kx-search-hint').innerText(), /A ticker: Look up reads KXFIXTURE-26NOV18-T1 from Kalshi/);
    await page.locator('#mk-q').press('Enter');
    await page.waitForFunction(() => document.getElementById('kx-why').open && /KXFIXTURE-26NOV18-T1/.test(document.getElementById('kx-why-body').textContent));
    await page.locator('#kx-why [data-sheet-close]').tap();
    await page.locator('#kx-search-close').tap();
    await page.locator('#kx-filter-open').tap();
    await page.locator('#kx-filter input[value="playable"]').check();
    await page.waitForFunction(() => document.querySelectorAll('#mk-list .kx-card').length === 39);
    assert.ok(requests.some((r) => /verdict=playable/.test(r)), 'the filter is the list\x27s query');
    await page.locator('#kx-filter [data-sheet-close]').last().tap();
    assert.equal(await page.locator('#kx-filter-count').innerText(), '1');
    await page.locator('#kx-chips .kx-chip', { hasText: 'Sports' }).tap();
    await page.waitForFunction(() => document.querySelector('#kx-chips [aria-pressed="true"]').textContent === 'Sports');
    assert.ok(requests.some((r) => /category=Sports/.test(r)), 'a chip is the list\x27s category');
  } finally { await context.close(); }
});

test('412x915 by itself: the page draws the same one bar (Kalshi, search, help) and the first card still sits in the top 30%', async () => {
  const { page, context } = await openKalshi(PHONES[0], { standalone: true });
  try {
    const bar = await page.evaluate(() => ({ host: document.documentElement.getAttribute('data-kx-host'), title: document.querySelector('.kx-title') && document.querySelector('.kx-title').getClientRects().length ? document.querySelector('.kx-title').textContent : '',
      buttons: [...document.querySelectorAll('#kx-appbar button')].filter((b) => b.getClientRects().length).map((b) => b.getAttribute('aria-label')) }));
    assert.deepEqual(bar, { host: 'top', title: 'Kalshi', buttons: ['Search markets', 'Help'] });
    const first = await page.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().top, FIRST_MARKET);
    assert.ok(first <= PHONES[0].height * 0.3, `first card top ${Math.round(first)} px`);
    await page.locator('#kx-help-open').tap();
    await page.waitForFunction(() => document.getElementById('kx-help').open);
    const help = await page.locator('#kx-legend').innerText();
    for (const word of ['Big edge', 'Good edge', 'Small edge', 'No edge', 'No estimate', 'Our estimate', 'Paper trading']) assert.match(help, new RegExp(word));
  } finally { await context.close(); }
});
