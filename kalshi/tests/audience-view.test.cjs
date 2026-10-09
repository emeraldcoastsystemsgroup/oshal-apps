/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The company view asserted as behaviour over a stub kit and a stub fetch, with the browser fixture's synthetic answers as the one source of truth: on open it reads exactly GET /scan, GET /alerts and GET /home-summary and never /status, /portfolio or /alerts/pops (each asks Kalshi live), /trends, /settings or a write; the stats are the playable-hand count, the snapshot age with its freshness, the paper alert record and the five-day alert count; the hands table carries strength, side, market, ask, net edge, stake, close and flags as the snapshot ranks them (a past close reads Closed); the alerts list carries strength, side, edge, delivery and the settlement outcome (Open, Win, Loss, Settled), newest first, capped at eight, under the record line; waiting for the first scan, a running first scan, the scan switched off, a folded scan, a stale or failed snapshot, an open staking gate, 401, 403, a failed snapshot read (the route's own error, or the HTTP status when not JSON), a failed or refused alerts read (which never hides the hands), a failed, unavailable or partial home summary and no alerts at all each read as what they are. The page's main script and its connected-actions script run against a stub DOM to prove that under a view nothing starts (no read, no poller, no mount) while without a view, and without the kit, every start step runs as before.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'kalshi';
const PAGE = 'tools/kalshi.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/kalshi"];
const GATE_FILE = 'tools/kalshi.html';

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
const start = html.indexOf('<script src="/shared/ui/js/app-view.js"></script>');
const block = (() => { const s = html.indexOf('<script>', start); const e = html.indexOf('</script>', s); return html.slice(s + 8, e); })();

test('the shared kit is loaded right after the theme bootstrap, stylesheet first', () => {
  const bootstrap = html.indexOf('<script src="/shared/ui/js/surface-theme.js"></script>');
  assert.ok(bootstrap >= 0, 'theme bootstrap present');
  const css = html.indexOf('<link rel="stylesheet" href="/shared/ui/css/app-view.css" />');
  assert.ok(css > bootstrap && start > css, 'app-view.css then app-view.js follow the bootstrap');
  assert.equal(html.split('/shared/ui/js/app-view.js').length - 1, 1, 'the kit is included once');
});

test('the page boots the kit with its own application name and exactly the audiences it provides', () => {
  const boot = block.match(/A\.boot\(\{([\s\S]*?)\}\);/);
  assert.ok(boot, 'A.boot({...}) present');
  assert.match(boot[1], new RegExp("app: '" + APP + "'"));
  const declared = boot[1].match(/audiences: \{([^}]*)\}/);
  assert.ok(declared, 'audiences map present');
  const names = declared[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean).sort();
  assert.deepEqual(names, [...AUDIENCES].sort());
  assert.match(boot[1], /escapeLabel: '[^']+'/, 'the escape names the full application');
});

test('the full page start is gated on the kit decision and survives a missing kit', () => {
  const gated = GATE_FILE === PAGE ? html : fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
  assert.match(gated, /if \(!window\.AppView \|\| !AppView\.active\(\)\)/);
});

test('the head block parses and reads only this package\x27s own routes', () => {
  assert.doesNotThrow(() => new Function(block));
  const reads = [...block.matchAll(/fetch\(\s*'([^']+)'/g)].map(m => m[1]).concat([...block.matchAll(/fetch\(\s*(BASE|API)\s*\+/g)].map(() => ALLOWED_PREFIXES[0]));
  assert.ok(reads.length >= 1, 'the block reads through fetch');
  for (const r of reads) assert.ok(ALLOWED_PREFIXES.some(p => r === p || r.startsWith(p + '/')), 'read stays on an allowed prefix: ' + r);
  assert.doesNotMatch(block, /innerHTML\s*=/, 'the block builds no HTML from data');
});

/**
 * @description Run the head block against a stub kit and a stub fetch, so the company view is asserted as the model it
 * paints and the reads it makes. The stub formatter tags its input (W = AppView.when); AppView.num answers the number as text.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead (body undefined = not JSON).
 * @returns {{ company: Function, urls: string[] }} The builder and every request made.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', num: (v) => String(v) };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls };
}

// The browser fixture's synthetic answers are the one source of truth for what the routes return.
const iso = (h) => new Date(Date.now() + h * 36e5).toISOString();
const FIXTURE = require('./audience-view.fixture.cjs')({ iso });
const S = '/api/kalshi/scan', L = '/api/kalshi/alerts', H = '/api/kalshi/home-summary';
const OK = FIXTURE.reads;
const SCAN = OK[S], GEN = SCAN.generatedAt;
/** @returns {object} The snapshot answer with overrides on the top level and, when given, on its scan block. */
const scan = (top, block) => ({ ...SCAN, ...top, scan: { ...SCAN.scan, ...(block || {}) } });
const AWAITING = scan({ generatedAt: null, hands: [], evaluable: 0, openPaged: 0, scorecard: [], awaitingFirstScan: true, mayStake: false, gateReason: 'the background scan has not produced its first snapshot yet' }, { ageSeconds: null, stale: true, nextRunAt: null });
const NO_ALERTS = { alerts: [], record: { alerted: 0, settled: 0, wins: 0, losses: 0, open: 0, hitRate: null, pnlPerContract: null, pnlTotal: null } };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const brief = (x) => [x.id, x.label, x.value, x.hint || null, x.tone || null];

test('on open the view reads only the saved snapshot, the alert ledger and the home summary: never the exchange, the account, candles or a write', async () => {
  const view = loadCompany(OK);
  await view.company({});
  assert.deepEqual([...view.urls].sort(), ['GET ' + L, 'GET ' + H, 'GET ' + S]);
  assert.ok(!view.urls.some((u) => /^(POST|PUT|DELETE) |\/status|\/portfolio|\/pops|\/scan\/run|\/orders|\/trends|\/settings/.test(u)), 'no live Kalshi read, no write');
});

test('the hero and stats name the scan state: hands, snapshot age and freshness, the paper record and the five-day alert count', async () => {
  const model = await loadCompany(OK).company({});
  assert.deepEqual([model.kicker, model.title, model.actions.map((a) => a.label)], ['Finance · Kalshi', '2 playable hands', ['Open the scan']]);
  assert.equal(model.lede, 'Snapshot W(' + GEN + ') over 1387 evaluable markets · scans every 60 min · paper only: strategy calibration is unproven (12 graded, 30 needed).');
  assert.deepEqual(model.stats.map(brief), [
    ['hands', 'Playable hands', 2, 'of 1387 evaluable markets', 'ok'],
    ['snapshot', 'Last scan', 'W(' + GEN + ')', 'Scans every 60 min', 'ok'],
    ['record', 'Alert record (paper)', '2–1', '67% hit over 3 settled alerts', 'ok'],
    ['alerts5d', 'Alerts / 5 days', '4', '3 delivered', null],
  ]);
});

test('the hands table carries strength, side, market, ask, net edge, stake, close and flags as the snapshot ranks them, capped at ten', async () => {
  const hands = section(await loadCompany(OK).company({}), 'hands');
  assert.deepEqual(hands.columns.map((c) => (typeof c === 'string' ? c : c.label)), ['Strength', 'Side', 'Market', 'Ask', 'Net edge', 'Stake', 'Closes', 'Flags']);
  assert.deepEqual(hands.rows, [
    [{ text: 'strong', tone: 'ok' }, 'YES', 'Synthetic Fed holds in November', { text: '42.0¢' }, { text: '+7.3¢', tone: 'ok' }, { text: '0.00%' }, 'W(' + SCAN.hands[0].closeTime + ')', '—'],
    [{ text: 'playable', tone: 'warn' }, 'NO', 'Synthetic rain in Miami on Friday', { text: '61.0¢' }, { text: '+3.1¢', tone: 'ok' }, { text: '0.00%' }, 'W(' + SCAN.hands[1].closeTime + ')', 'thin-book'],
  ]);
  assert.equal(hands.note, 'A stake is a quarter-Kelly paper size of the bankroll; nothing here places an order.');
  const many = Array.from({ length: 14 }, (_, i) => ({ ...SCAN.hands[0], ticker: 'SYN-' + i, title: 'Synthetic ' + i, stakeFraction: 0.0125, closeTime: i === 0 ? iso(-1) : i === 1 ? null : iso(48), strength: 'monster' }));
  const capped = await loadCompany({ ...OK, [S]: scan({ hands: many, mayStake: true }) }).company({});
  assert.deepEqual([capped.title, section(capped, 'hands').rows.length, section(capped, 'hands').rows[0][5], section(capped, 'hands').rows[0][6], section(capped, 'hands').rows[1][6], section(capped, 'hands').rows[0][0].tone], ['14 playable hands', 10, { text: '1.25%' }, 'Closed', '—', 'ok']);
  assert.match(section(capped, 'hands').note, /^The top 10 of 14 hands, as the scan ranks them\. /);
  assert.match(capped.lede, / · staking gate open for calibration\.$/);
});

test('the alerts list carries strength, side, edge, delivery and the settlement outcome, newest first, capped at eight, under the record line', async () => {
  const alerts = section(await loadCompany(OK).company({}), 'alerts');
  assert.deepEqual(alerts.items.map((i) => [i.title, i.text, i.meta, i.badge, i.tone]), [
    ['Synthetic rain in Miami on Friday', 'playable · NO · +3.1¢ net edge when announced · delivered via jarvis', 'W(' + OK[L].alerts[0].created_at + ')', 'Open', null],
    ['Synthetic CPI above 3% in September', 'strong · YES · +5.8¢ net edge when announced · +$0.55 per contract · delivered via jarvis', 'W(' + OK[L].alerts[1].created_at + ')', 'Win', 'ok'],
    ['Synthetic quarterback throws for 300 yards', 'playable · YES · +3.4¢ net edge when announced · −$0.47 per contract · delivery not confirmed', 'W(' + OK[L].alerts[2].created_at + ')', 'Loss', 'bad'],
    ['Synthetic snow in Denver by Sunday', 'monster · YES · +9.1¢ net edge when announced · +$0.28 per contract · delivered via jarvis', 'W(' + OK[L].alerts[3].created_at + ')', 'Win', 'ok'],
  ]);
  assert.equal(alerts.note, 'Record: 2 wins, 1 loss (67% hit rate over 3 settled alerts) · avg +$0.12 per contract, +$0.36 had you bought one contract on each · 1 alert still open · 4 alerts announced. Paper: alerts never place orders.');
  const twelve = Array.from({ length: 12 }, (_, i) => ({ ...OK[L].alerts[0], ticker: 'SYN-' + i, detail: {}, settled: i === 0 ? true : null, won: null }));
  const capped = section(await loadCompany({ ...OK, [L]: { alerts: twelve, record: OK[L].record } }).company({}), 'alerts');
  assert.deepEqual([capped.items.length, capped.items[0].title, capped.items[0].badge, capped.items[1].badge], [8, 'SYN-0', 'Settled', 'Open']);
});

test('waiting for the first scan, a running first scan, the scan switched off and a folded scan each read as what they are', async () => {
  const waiting = await loadCompany({ ...OK, [S]: AWAITING }).company({});
  assert.deepEqual([waiting.title, waiting.lede, brief(stat(waiting, 'hands')), brief(stat(waiting, 'snapshot')), section(waiting, 'hands').rows.length, section(waiting, 'hands').empty],
    ['Waiting for the first scan', 'scans every 60 min · paper only: the background scan has not produced its first snapshot yet.', ['hands', 'Playable hands', 0, null, null], ['snapshot', 'Last scan', 'None yet', 'Scans every 60 min', 'warn'], 0, 'The background scan has not produced its first snapshot yet.']);
  const running = await loadCompany({ ...OK, [S]: scan(AWAITING, { running: true }) }).company({});
  assert.deepEqual([running.title, stat(running, 'snapshot').value], ['The first scan is running', 'Running']);
  const off = await loadCompany({ ...OK, [S]: scan(AWAITING, { enabled: false }) }).company({});
  assert.deepEqual([off.title, stat(off, 'snapshot').hint], ['Background scan is off and no snapshot is saved', 'Background scan is off']);
  const folded = await loadCompany({ ...OK, [S]: scan({ hands: [] }) }).company({});
  assert.deepEqual([folded.title, stat(folded, 'hands').value, stat(folded, 'hands').tone || null, section(folded, 'hands').empty], ['The last scan folded every market', 0, null, 'No playable hands: the evaluator folded every market whose history does not support an edge net of fees.']);
});

test('a stale snapshot, a failed last scan and a switched-off scan with a saved snapshot are each named on the snapshot stat', async () => {
  const stale = await loadCompany({ ...OK, [S]: scan({}, { stale: true }) }).company({});
  assert.deepEqual([stat(stale, 'snapshot').hint, stat(stale, 'snapshot').tone], ['Stale: older than the configured window', 'warn']);
  const failed = await loadCompany({ ...OK, [S]: scan({}, { lastError: 'Synthetic feed walk timed out' }) }).company({});
  assert.deepEqual([stat(failed, 'snapshot').hint, stat(failed, 'snapshot').tone], ['Last scan failed: Synthetic feed walk timed out', 'bad']);
  const off = await loadCompany({ ...OK, [S]: scan({}, { enabled: false }) }).company({});
  assert.deepEqual([stat(off, 'snapshot').hint, stat(off, 'snapshot').tone, / · the background scan is off · /.test(off.lede)], ['Background scan is off', 'warn', true]);
});

test('a refusal and a failed snapshot read each read as what they are', async () => {
  const signedOut = await loadCompany({ [S]: { http: 401, body: { error: 'authentication required' } }, [L]: { http: 401, body: {} }, [H]: { http: 401, body: { error: 'not_authenticated' } } }).company({});
  assert.deepEqual([signedOut.title, signedOut.sections, signedOut.stats], ['Sign in to see the Kalshi scan', undefined, undefined]);
  const denied = await loadCompany({ ...OK, [S]: { http: 403, body: {} } }).company({});
  assert.equal(denied.title, 'This account cannot open Kalshi Edge');
  await assert.rejects(loadCompany({ ...OK, [S]: { http: 503, body: { error: 'Synthetic snapshot read failed' } } }).company({}), /^Error: Synthetic snapshot read failed$/, 'the route\x27s own error');
  await assert.rejects(loadCompany({ ...OK, [S]: { http: 500, body: undefined } }).company({}), /^Error: Kalshi Edge could not read the saved scan \(HTTP 500\)\.$/);
});

test('a failed or refused alerts read never hides the hands; a failed, unavailable or partial home summary and no alerts at all are each named', async () => {
  const noAlerts = await loadCompany({ ...OK, [L]: { http: 503, body: { error: 'Synthetic ledger unavailable' } } }).company({});
  assert.deepEqual([noAlerts.title, section(noAlerts, 'hands').rows.length, section(noAlerts, 'alerts').items.length, section(noAlerts, 'alerts').empty, section(noAlerts, 'alerts').note, brief(stat(noAlerts, 'record'))],
    ['2 playable hands', 2, 0, 'Alerts could not be read (HTTP 503).', null, ['record', 'Alert record (paper)', '—', 'Could not check', null]]);
  const refusedAlerts = await loadCompany({ ...OK, [L]: { http: 401, body: {} } }).company({});
  assert.deepEqual([section(refusedAlerts, 'alerts').empty, stat(refusedAlerts, 'record').hint], ['Sign in to see alerts.', 'Sign in to see it']);
  const quiet = await loadCompany({ ...OK, [L]: NO_ALERTS }).company({});
  assert.deepEqual([brief(stat(quiet, 'record')), section(quiet, 'alerts').empty, section(quiet, 'alerts').note],
    [['record', 'Alert record (paper)', '—', 'No alerts announced yet', null], 'No alerts announced yet. New playable hands are posted to your Jarvis feed by the background scan.', 'An alert is a research signal the background scan posted to your feed, never an order.']);
  const openOnly = await loadCompany({ ...OK, [L]: { alerts: OK[L].alerts.slice(0, 1), record: { alerted: 2, settled: 0, wins: 0, losses: 0, open: 2, hitRate: null, pnlPerContract: null, pnlTotal: null } } }).company({});
  assert.deepEqual(brief(stat(openOnly, 'record')), ['record', 'Alert record (paper)', '0–0', '2 open alerts, none settled yet', null]);
  const noSummary = await loadCompany({ ...OK, [H]: { http: 503, body: { error: 'x' } } }).company({});
  assert.deepEqual(brief(stat(noSummary, 'alerts5d')), ['alerts5d', 'Alerts / 5 days', '—', 'Could not check', null]);
  const unavailable = await loadCompany({ ...OK, [H]: { ...OK[H], metrics: OK[H].metrics.map((m) => ({ ...m, value: 'Unavailable' })), partial: true } }).company({});
  assert.deepEqual(brief(stat(unavailable, 'alerts5d')), ['alerts5d', 'Alerts / 5 days', '—', 'Could not check', null]);
  const partial = await loadCompany({ ...OK, [H]: { ...OK[H], partial: true } }).company({});
  assert.equal(stat(partial, 'alerts5d').hint, '3 delivered · some records could not be checked');
});

/** @returns {object} A stub element with the members the page's scripts touch on start: bindings, panels, badges, tables. */
function node() { return { style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, removeChild() {}, setAttribute() {}, getAttribute() { return ''; }, querySelector() { return null; }, querySelectorAll() { return []; }, value: '', textContent: '', innerHTML: '', className: '', hidden: false, disabled: false }; }

/**
 * @description Run the page's main script against a stub DOM, a stub fetch (every route answers 404) and a stub setInterval,
 * with a kit whose active() answers as given; undefined leaves window.AppView absent, a core without the kit.
 * @param {string|null|undefined} activeView What AppView.active() answers.
 * @returns {Promise<{ reads: string[], pollers: number }>} Every URL fetched once the promise chains settle, and the pollers started.
 */
async function runMain(activeView) {
  const s = html.indexOf('<script>', html.indexOf('</main>')), src = html.slice(s + 8, html.indexOf('</script>', s));
  assert.match(src, /var state = \{ hands: \[\]/, 'the main script was found');
  const reads = []; let pollers = 0;
  const kit = activeView === undefined ? undefined : { active: () => activeView };
  const fetchStub = (url, opt) => { reads.push(((opt && opt.method) || 'GET') + ' ' + url.split('?')[0]); return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'synthetic' }) }); };
  const documentStub = { getElementById: () => node(), querySelector: () => null, querySelectorAll: () => [], createElement: () => node(), body: node() };
  new Function('window', 'document', 'fetch', 'setInterval', 'AppView', src)({ AppView: kit, addEventListener() {}, location: { pathname: '/api/kalshi/' } }, documentStub, fetchStub, () => { pollers++; }, kit);
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
  return { reads: reads.sort(), pollers };
}

/**
 * @description Run the page's connected-actions script (its dynamic import replaced by a stub module) with a kit whose active() answers as given.
 * @param {string|null|undefined} activeView What AppView.active() answers; undefined leaves the kit absent.
 * @returns {Promise<number>} How often the connected actions mounted.
 */
async function runModule(activeView) {
  const s = html.lastIndexOf('<script>'), src = html.slice(s + 8, html.indexOf('</script>', s)).replace("await import('/cockpit/js/app-workflows.js')", 'workflows');
  assert.match(src, /mountConnectedActions\(\{app:'kalshi'/, 'the connected-actions script was found');
  let mounted = 0;
  const kit = activeView === undefined ? undefined : { active: () => activeView };
  new Function('window', 'AppView', 'document', 'workflows', src)({ AppView: kit }, kit, { querySelector: () => node() }, { mountConnectedActions: () => { mounted++; return Promise.resolve(); } });
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  return mounted;
}

test('under an audience view neither the page\x27s start nor its connected-actions mount runs; without a view, and without the kit, both run as before', async () => {
  assert.deepEqual(await runMain('company'), { reads: [], pollers: 0 });
  const full = { reads: ['GET /api/kalshi/alerts', 'GET /api/kalshi/portfolio', 'GET /api/kalshi/scan', 'GET /api/kalshi/settings', 'GET /api/kalshi/status', 'GET /api/kalshi/trends'], pollers: 3 };
  assert.deepEqual(await runMain(null), full);
  assert.deepEqual(await runMain(undefined), full, 'a core without the kit runs the page as before');
  assert.deepEqual([await runModule('company'), await runModule(null), await runModule(undefined)], [0, 1, 1]);
  assert.equal(html.split('if (!window.AppView || !AppView.active())').length - 1, 3, 'the account read, the load/poll start and the connected-actions mount are each gated');
  assert.doesNotMatch(html, /^\s*loadStatus\(\)\.then\(loadPortfolio\);/m, 'no ungated account read is left');
  assert.doesNotMatch(html, /^  (load|loadAlerts|loadSettings|loadTrends)\(\);/m, 'no ungated load is left');
});
