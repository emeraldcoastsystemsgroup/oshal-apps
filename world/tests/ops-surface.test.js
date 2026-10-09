/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: the operator Sources & schedules page, both copies (source template and compiled route). Its one inline script parses as a classic script and is safe inside String.raw; run in a vm against synthetic answers it renders every schedule and source (escaping names and URLs), sends the documented PATCH for a schedule toggle, a preset, a custom cron, a reset and a source switch, and names the operator requirement on a 403.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A refused change keeps its error in the banner after the refresh; presets under the server's minimum interval are offered disabled; a source both switched off and off in .env says both, and every source names its governing flags.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A firehose feed blocked by the switched-off pass says so.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const COPIES = ['src-routes/world-ops-html.ts', 'routes/world-ops-html.js'];

/** The page's one inline script (the theme script is a src= tag and does not match). */
function inlineScript(text, rel) {
  const blocks = [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(blocks.length, 1, rel + ': exactly one inline script');
  return blocks[0];
}

const SCHEDULES = {
  app: 'world', timezone: 'UTC', minIntervalMinutes: 5, schedulerEnabled: true,
  schedules: [
    { id: 'ticker-pulse', description: 'pulse', controllable: true, registered: true, enabled: true, cron: '*/5 8-23 * * 1-5', manifestCron: '*/5 8-23 * * 1-5', override: null, nextRunAt: '2026-10-05T08:00:00.000Z', lastRunAt: null, executionCount: 12, scope: 'framework' },
    { id: 'world-refresh', description: 'depth', controllable: true, registered: true, enabled: false, cron: '0 */12 * * *', manifestCron: '0 */6 * * *', override: { enabled: false, cron: '0 */12 * * *' }, nextRunAt: null, lastRunAt: '2026-10-02T18:00:00.000Z', executionCount: 3, scope: 'framework' },
  ],
};
const SOURCES = {
  switchTtlMs: 30000, firehoseEveryNPulses: 8,
  sources: [
    { id: 'google-news', kind: 'feed', name: '<b>Google</b> News', urls: ['https://news.google.com/rss/search?q={query}&a=<x>'], usedBy: ['world-refresh (topics)'], gates: [], switchedOn: true, configuredOn: true, pulling: true, last24h: { pulls: 4, fetched: 40, newItems: 9, lastPull: '2026-10-02T21:00:00.000Z' }, lastRun: null, note: null },
    { id: 'firehose', kind: 'firehose', name: 'Publisher firehose (whole pass)', urls: [], usedBy: ['ticker-pulse (every 8th pulse)'], gates: [{ name: 'WORLD_FIREHOSE_ENABLED', on: false }], switchedOn: false, configuredOn: false, pulling: false, last24h: null, lastRun: null, note: null },
    { id: 'fh-cnbc-top', kind: 'firehose', name: 'CNBC', urls: ['https://www.cnbc.com/id/100003114/device/rss/rss.html'], usedBy: ['ticker-pulse (every 8th pulse)'], gates: [{ name: 'WORLD_FIREHOSE_ENABLED', on: true }], switchedOn: true, configuredOn: true, pulling: false, blockedBy: 'the firehose pass is switched off', last24h: null, lastRun: null, note: null },
    { id: 'congress-trades', kind: 'collector', name: 'Congressional trades', urls: ['https://example.test/trades.json'], usedBy: ['world-refresh'], gates: [{ name: 'WORLD_FLOW_ENABLED', on: true }], switchedOn: false, configuredOn: true, pulling: false, last24h: null, lastRun: { ranAt: '2026-10-02T18:46:00.000Z', outcome: 'skipped', detail: { reason: 'switched off' } }, note: null },
  ],
};

/** A DOM just big enough for the page: elements by id, delegated listeners, and a custom-cron input. */
function runPage(script, answers) {
  const els = {};
  const listeners = {};
  const calls = [];
  const custom = { value: '' };
  const document = {
    getElementById: (id) => (els[id] ??= { innerHTML: '' }),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelector: () => custom,
  };
  const fetch = async (url, opts) => {
    calls.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body ? JSON.parse(opts.body) : undefined });
    const a = answers(url, opts);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  vm.runInNewContext(script, { document, fetch, console, Date, JSON, Math, Object, String, encodeURIComponent });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const fire = async (type, target) => { listeners[type]({ target }); await settle(); };
  return { els, calls, custom, settle, fire };
}

const okAnswers = (url) => (url.startsWith('/api/swarm/apps/world/schedules')
  ? { status: 200, body: url === '/api/swarm/apps/world/schedules' ? SCHEDULES : { schedule: {} } }
  : { status: 200, body: url === '/api/world/operations/sources' ? SOURCES : { source: {} } });

for (const rel of COPIES) {
  const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const script = inlineScript(text, rel);

  test('the page script parses as a classic script and is safe inside String.raw (' + rel + ')', () => {
    assert.doesNotThrow(() => new vm.Script(script, { filename: rel }));
    assert.doesNotMatch(script, /`|\$\{/, 'no backtick or dollar-brace inside the template');
  });

  test('it renders every schedule and source, escaped (' + rel + ')', async () => {
    const page = runPage(script, okAnswers);
    await page.settle();
    const sched = page.els.schedules.innerHTML;
    assert.match(sched, /ticker-pulse/);
    assert.match(sched, /manifest: <code>0 \*\/6 \* \* \*<\/code>/, 'an overridden cadence names the manifest default');
    assert.match(sched, /Reset to manifest/);
    const src = page.els.sources.innerHTML;
    assert.match(src, /&lt;b&gt;Google&lt;\/b&gt; News/);
    assert.match(src, /q=\{query\}&amp;a=&lt;x&gt;/);
    assert.match(src, /off in \.env \(WORLD_FIREHOSE_ENABLED\)/);
    assert.match(src, /switched off/);
    assert.match(src, /4 pulls &middot; 40 items &middot; 9 new/);
    assert.doesNotMatch(src, /<b>Google<\/b>/);
  });

  test('each control sends the documented change (' + rel + ')', async () => {
    const page = runPage(script, okAnswers);
    await page.settle();
    const patches = () => page.calls.filter((c) => c.method === 'PATCH').map((c) => [c.url, c.body]);
    await page.fire('change', { dataset: { sched: 'ticker-pulse' }, checked: false });
    await page.fire('change', { dataset: { preset: 'ticker-pulse' }, value: '*/15 8-23 * * 1-5' });
    page.custom.value = ' 0 */4 * * * ';
    await page.fire('click', { dataset: { apply: 'world-refresh' } });
    await page.fire('click', { dataset: { reset: 'world-refresh' } });
    await page.fire('change', { dataset: { src: 'congress-trades' }, checked: true });
    assert.deepEqual(patches(), [
      ['/api/swarm/apps/world/schedules/ticker-pulse', { enabled: false }],
      ['/api/swarm/apps/world/schedules/ticker-pulse', { cron: '*/15 8-23 * * 1-5' }],
      ['/api/swarm/apps/world/schedules/world-refresh', { cron: '0 */4 * * *' }],
      ['/api/swarm/apps/world/schedules/world-refresh', { cron: null, enabled: true }],
      ['/api/world/operations/sources/congress-trades', { enabled: true }],
    ]);
  });

  test('a refused change keeps its error on screen after the refresh (' + rel + ')', async () => {
    const page = runPage(script, (url, opts) => ((opts && opts.method) === 'PATCH'
      ? { status: 400, body: { error: 'fires 60 s apart; the shortest interval allowed is 5 minutes' } }
      : okAnswers(url)));
    await page.settle();
    page.custom.value = '* * * * *';
    await page.fire('click', { dataset: { apply: 'ticker-pulse' } });
    await page.settle();
    assert.match(page.els.banner.innerHTML, /Schedule ticker-pulse: fires 60 s apart; the shortest interval allowed is 5 minutes/);
    assert.match(page.els.schedules.innerHTML, /ticker-pulse/, 'the cards were re-read');
  });

  test('presets under the minimum interval are disabled; governing flags and both off-states are named (' + rel + ')', async () => {
    const page = runPage(script, (url) => (url === '/api/swarm/apps/world/schedules'
      ? { status: 200, body: { ...SCHEDULES, minIntervalMinutes: 15 } }
      : okAnswers(url)));
    await page.settle();
    const sched = page.els.schedules.innerHTML;
    assert.match(sched, /<option value="\*\/10 8-23 \* \* 1-5" disabled>every 10 minutes \(under the 15-minute minimum\)/);
    assert.match(sched, /<option value="\*\/30 8-23 \* \* 1-5">every 30 minutes<\/option>/);
    const src = page.els.sources.innerHTML;
    assert.match(src, /switched off<\/span><br><span class="warn">off in \.env \(WORLD_FIREHOSE_ENABLED\)/);
    assert.match(src, /\.env: WORLD_FLOW_ENABLED/);
    assert.match(src, /not pulling: the firehose pass is switched off/);
  });

  test('a non-operator is told the page is operator-only (' + rel + ')', async () => {
    const page = runPage(script, () => ({ status: 403, body: { error: 'forbidden' } }));
    await page.settle();
    assert.match(page.els['sched-note'].innerHTML, /Only a swarm operator can see and change World schedules and sources\./);
    assert.match(page.els['src-note'].innerHTML, /Only a swarm operator/);
  });
}
