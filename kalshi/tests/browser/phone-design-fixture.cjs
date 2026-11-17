/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.10.0 phone design: the synthetic market list (built by the package's own explainer, routes/kalshi-market-explainer.js, so every verdict, headline and walkthrough is the route's), the read answers and a stand-in for Today's shell around the page, shared by tests/kalshi-phone-design-browser.test.js and the screenshot tool phone-design-shots.cjs. Reads only.
 */
'use strict';
const path = require('node:path');
const Module = require('node:module');
const { openPage } = require('./phone-fixture.cjs');

const PAGE = path.resolve(__dirname, '../../tools/kalshi.html');
const PHONES = [{ width: 412, height: 915 }, { width: 390, height: 844 }, { width: 360, height: 780 }];
const DESKTOP = { width: 1440, height: 900 };
const JARGON = /\b(monster|folds?|playable|verdicts?)\b/i;
const NOW = Date.now();
const iso = (hours) => new Date(NOW + hours * 3600000).toISOString();

// The package's own explainer gives each synthetic market the verdict, side, headline and walkthrough the route gives.
const load = Module._load;
Module._load = function stubbed(request, ...rest) { return request.startsWith('@/') ? {} : load.call(this, request, ...rest); };
let explainer;
try { explainer = require(path.resolve(__dirname, '../../routes/kalshi-market-explainer.js')); } finally { Module._load = load; }

const CATEGORIES = ['Climate and Weather', 'Economics', 'Financials', 'Politics', 'Sports', 'Entertainment', 'Crypto', 'Science and Technology'];
const STRENGTHS = ['monster', 'strong', 'playable', 'fold', null];

/** @description A synthetic market row in the shape GET /markets answers, with long titles like the live feed's. */
function row(i) {
  const strength = STRENGTHS[i % STRENGTHS.length], side = i % 3 === 0 ? 'no' : 'yes', yesAsk = 0.3 + (i % 40) / 100, noAsk = Math.round((1.03 - yesAsk) * 100) / 100;
  const ticker = `KXFIXTURE-26NOV${17 + (i % 3)}-T${i}`, closeTime = strength ? iso(1 + (i % 40)) : iso(30 * 24 + i);
  const price = side === 'yes' ? yesAsk : noAsk, edge = strength === 'fold' ? -0.012 : 0.138 - (i % 5) * 0.03;
  const hand = strength ? { ticker, title: `t${i}`, category: CATEGORIES[i % 8], closeTime, side, price, marketProb: price, trueProb: Math.min(0.97, price + edge + 0.017),
    calibrationN: 140 + i, feePerContract: 0.017, edgeNet: edge, evPerContract: edge, kellyFraction: 0.08, stakeFraction: 0, confidence: 0.8, riskFlags: i % 4 ? [] : ['thin-book'],
    strength, spread: 0.02, liquidity: 900, volume: 1200 } : null;
  const m = { ticker, eventTicker: ticker.split('-').slice(0, 2).join('-'), seriesTicker: 'KXFIXTURE', category: CATEGORIES[i % 8], closeTime,
    title: `Will the synthetic fixture high temperature in Coastal Test City ${i} be above ${60 + i}.99 degrees on Nov 17, 2026? — ${61 + i} degrees or above`,
    yesBid: yesAsk - 0.01, yesAsk, noBid: noAsk - 0.01, noAsk, lastPrice: yesAsk, volume: 1000 + i * 37, openInterest: 300, liquidity: 900, hand,
    notEvaluable: strength ? null : 'it closes in 30.0 days, beyond the 48-hour horizon the calibration table was measured on' };
  const why = explainer.explainMarket(m, { mayStake: false, gateReason: 'No strategy has 30 settled predictions yet.', calibrationGeneratedAt: '2026-07-13T05:39:26.578Z', nowMs: NOW });
  return { ...m, verdict: why.verdict, side: why.side, headline: why.headline };
}
const ROWS = Array.from({ length: 64 }, (_, i) => row(i));
const COUNTS = { playable: ROWS.filter((m) => m.hand && m.hand.strength !== 'fold').length, fold: ROWS.filter((m) => m.verdict === 'fold').length, notEvaluable: ROWS.filter((m) => !m.hand).length };

/** @description GET /markets as the route answers it, filtered by the query the page sent. */
function markets(url) {
  const q = (url.searchParams.get('q') || '').toLowerCase(), category = url.searchParams.get('category') || '', verdict = url.searchParams.get('verdict') || 'all';
  const kept = ROWS.filter((m) => (!q || `${m.title} ${m.ticker} ${m.category}`.toLowerCase().includes(q)) && (!category || m.category === category)
    && (verdict === 'all' || (verdict === 'playable' ? m.hand && m.hand.strength !== 'fold' : verdict === 'fold' ? m.verdict === 'fold' : !m.hand)));
  return { generatedAt: iso(-0.2), awaitingFirstScan: false, needsRescan: false, total: ROWS.length, shown: kept.length, matched: kept.length, closedSinceScan: 0,
    mayStake: false, counts: COUNTS, categories: CATEGORIES.slice().sort(), markets: kept };
}
/** @description GET /markets/:ticker: the stored row with its walkthrough, as the route answers it. */
function walkthrough(url) {
  const ticker = decodeURIComponent(url.pathname.split('/').pop()).toUpperCase(), m = ROWS.find((r) => r.ticker === ticker);
  if (!m) return { __status: 404, body: { error: `Kalshi has no market ${ticker}` } };
  return { source: 'snapshot', generatedAt: iso(-0.2), market: m, why: explainer.explainMarket(m, { mayStake: false, calibrationGeneratedAt: '2026-07-13T05:39:26.578Z', nowMs: NOW }) };
}
const READS = {
  '/api/kalshi/scan': { generatedAt: iso(-0.2), hands: ROWS.filter((m) => m.hand && m.hand.strength !== 'fold').map((m) => ({ ...m.hand, title: m.title })), evaluable: ROWS.length,
    scorecard: [{ strategy: 'calibration', status: 'failing', graded: 40, pending: 12, brier: 0.2432, marketBrier: 0.2276, hitRate: 0.47, pnlPerContract: -0.15 }],
    gateReason: 'No strategy has beaten the market yet.', mayStake: false, exchangeActive: true, calibrationGeneratedAt: '2026-07-13T05:39:26.578Z',
    scan: { ageSeconds: 720, lastMs: 35600, enabled: true, intervalMinutes: 15 } },
  '/api/kalshi/markets': markets,
  '/api/kalshi/markets/*': walkthrough,
  '/api/kalshi/status': { exchangeActive: true, liveOrdersEnabled: false },
  '/api/kalshi/portfolio': { __status: 409, body: { error: 'no Kalshi connection', connected: false } },
  '/api/kalshi/alerts': { alerts: [], record: null },
  '/api/kalshi/grade': { due: 0, open: 12, graded: 40 },
  '/api/kalshi/settings': { schema: {}, config: {}, editable: { user: [], deployment: [] }, isOperator: false },
  '/api/kalshi/trends': { generatedAt: iso(0), strategies: [], books: {}, minGraded: 30 },
};

const BOX = 'background:none;border:1px solid currentColor;color:inherit;border-radius:6px;padding:2px 10px;font:inherit;font-size:12px;cursor:pointer;';
/**
 * A stand-in for Today's shell around an application (platform/src/pages/cockpit: index.html, cockpit-view-controller.js,
 * tool-view-actions.js, viewport-guard.js, css/layout.css, jarvis-orb.js): the header (menu, Apps, help, profile), the
 * application's bar laid into its middle and re-measured on every change, Reload and Open tab in the shell's inline box
 * style, the frame below, and the floating Jarvis button: 48 px, 12 px from the corner, above a bar inset of 57 px unless
 * the application names its own on a phone; 56 px at 22 px on a desktop.
 */
const HOST = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;height:100%;overflow:hidden;font:14px/1.4 system-ui,sans-serif;background:#eaf4ff;color:#10233f}
.header-bar{position:fixed;top:0;left:0;right:0;height:46px;display:flex;align-items:center;justify-content:space-between;padding:0 8px;box-sizing:border-box;background:#f5f9ff;border-bottom:1px solid #cfe0f5;z-index:100}
.header-left,.header-right{display:flex;align-items:center;gap:4px}
.header-btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:0;background:none;color:inherit;font-size:18px;padding:0}
#workspaceNavigationMore summary{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;list-style:none}
.cockpit-body{position:absolute;top:46px;left:0;right:0;bottom:0}.main-content{height:100%}
.tool-view-header{position:fixed;top:0;left:var(--app-bar-left,94px);right:var(--app-bar-right,88px);height:46px;display:flex;align-items:center;gap:6px;z-index:101}
.tool-view-header>span:first-of-type{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tool-view-action-label{display:none}[data-tool-view-open]{display:none!important}.tool-view-action{flex:none;min-width:40px;min-height:40px}
#jarvisOrbFab{position:fixed;right:12px;bottom:calc(12px + var(--oshal-app-bottom-inset,57px));width:48px;height:48px;border-radius:50%;border:1px solid #cfe0f5;background:#fff;z-index:2147483000;padding:0}
@media (min-width:641px){.header-bar{height:56px}.cockpit-body{top:56px;left:73px;right:25px;bottom:45px}.tool-view-header{height:56px}.tool-view-action-label{display:inline}
[data-tool-view-open]{display:inline-flex!important}.tool-view-action{min-height:32px;min-width:0}#jarvisOrbFab{right:22px;bottom:22px;width:56px;height:56px}}
</style></head><body>
<header class="header-bar"><div class="header-left"><button class="header-btn" id="mobileMenuBtn" aria-label="Open menu">≡</button><details id="workspaceNavigationMore"><summary aria-label="Apps">⌄</summary></details></div>
<div class="header-right"><a class="header-btn" id="surfaceHelpBtn" href="/api/help" aria-label="User guides">?</a><button class="header-btn" id="profileBtn" aria-label="Profile &amp; Access">P</button></div></header>
<main class="cockpit-body"><section class="main-content" id="mainContent"><div class="tool-view-container" style="display:flex;flex-direction:column;height:100%;width:100%;">
<div class="tool-view-header"><i></i><span style="font-weight:600;">Kalshi</span><span style="flex:1"></span>
<button type="button" class="tool-view-action" data-tool-view-reload title="Reload this screen" aria-label="Reload" style="${BOX}">↻<span class="tool-view-action-label"> Reload</span></button>
<button type="button" class="tool-view-action" data-tool-view-open title="Open this screen in its own tab" aria-label="Open tab" style="${BOX}">↗<span class="tool-view-action-label"> Open tab</span></button></div>
<iframe src="/api/kalshi/" style="flex:1;border:none;width:100%;height:100%"></iframe></div></section></main>
<button id="jarvisOrbFab" type="button" aria-label="Jarvis">*</button>
<script>(function(){var html=document.documentElement;function lay(){var l=document.querySelector('.header-left').getBoundingClientRect().right,r=document.querySelector('.header-right').getBoundingClientRect().left;
html.style.setProperty('--app-bar-left',Math.round(l+6)+'px');html.style.setProperty('--app-bar-right',Math.round(innerWidth-r+6)+'px');html.toggleAttribute('data-phone-app-bar',innerWidth<=640);}
lay();addEventListener('resize',lay);new MutationObserver(function(){setTimeout(lay,0);}).observe(document.documentElement,{childList:true,subtree:true});})();</script></body></html>`;

/** The first market on the list: a card (1.10.0), or a row of the table it replaced (1.9.1), so a run against the older
 *  page measures where its first market sat instead of waiting for a card that never comes. */
const FIRST_MARKET = '#mk-list .kx-card, #mk-rows tr[data-ticker]';

/** @description Open the page at one size, in the shell (default) or by itself, and wait for its markets and its account line. */
async function openKalshi(browser, size, { standalone = false, page = PAGE } = {}) {
  const touch = size.width <= 640;
  const opened = await openPage(browser, size, { url: '/api/kalshi/', files: { '/api/kalshi/': page }, reads: READS, framed: !standalone, host: HOST, touch });
  await opened.page.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, FIRST_MARKET, { timeout: 15000 });
  await opened.page.waitForFunction(() => /\S/.test(((document.getElementById('kx-status') || document.getElementById('acct-label') || {}).textContent || '').replace('Checking your Kalshi account…', '')), null, { timeout: 15000 });
  return opened;
}

/** @description A rectangle of an element inside the frame, in the screen's coordinates (the frame's offset added). */
async function screenRects(top, frame, selector) {
  const offset = await top.evaluate(() => { const f = document.querySelector('iframe'); return f ? f.getBoundingClientRect().top : 0; });
  const left = await top.evaluate(() => { const f = document.querySelector('iframe'); return f ? f.getBoundingClientRect().left : 0; });
  const rects = await frame.evaluate((sel) => [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length)
    .map((el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) }; }), selector);
  return rects.map((r) => ({ ...r, top: r.top + offset, bottom: r.bottom + offset, left: r.left + left, right: r.right + left }));
}

module.exports = { PAGE, PHONES, DESKTOP, JARGON, ROWS, COUNTS, READS, HOST, FIRST_MARKET, openKalshi, screenRects };
