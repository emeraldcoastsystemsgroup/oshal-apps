/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Marketing Engine's two extra start paths are gated explicitly (the board's refresh() and the connected-actions module, which appended a section to <body> unconditionally, receives no handoff, mounts nothing and appends nothing under a view), and the company view is asserted as behaviour: the head block runs against a stub kit and stub reads, sends only the four GETs, never lists published content as needing action, marks a channel that is on with cap 0, names No data sources, and states each refusal (board 500 keeps the setup probes, signed out rejects with a sign-in message, a failed Home summary or content read degrades to what is known).
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Recent publish outcomes labelled every skipped_cap run "daily cap reached" and every skipped_consent run "no consent", although each outcome covers several causes and the ledger records the exact one in detail.reason. The outcome now shows that recorded reason (and detail.error for a failed send); asserted here for every branch of the package's real publishDecision (not enabled, paused, cap 0, count unknown, cap used up), for the fixture's cap-0 and paused rows, and for the fallback labels that name every cause when no reason was recorded.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | "Latest scorecard week": a source without events read "Not configured, or it failed on ingest", a cause the scorecard week never records (its sources carry only ok / no_data). Asserted here that such a source reads "No events recorded this week" badged No data, that a source with events shows its count, and that no scorecard item names a configuration or ingest cause.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'marketing-engine';
const PAGE = 'tools/marketing-engine.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/marketing","/api/marketing-engine"];
const GATE_FILE = 'tools/marketing-engine.html';

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

const GATE = 'if (!window.AppView || !AppView.active())';

test('the board refresh and the connected-actions module run only without an audience view', () => {
  // The board IIFE ends with its start; refresh() elsewhere runs only from a click handler.
  assert.ok(html.includes('  ' + GATE + ' refresh();\n})();\n</script>'), 'the board start, the last statement of its IIFE, is gated');
  assert.doesNotMatch(html, /\n\s*refresh\(\);\n\}\)\(\);/, 'no ungated start remains at the end of the IIFE');
  const modules = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(modules.length >= 1, 'the connected-actions module is present');
  for (const code of modules) {
    // Static imports stay (the modules only define functions; the handoff is posted on load, which a dynamic
    // import would miss); every statement after them runs inside the gate.
    const body = code.replace(/^\s*import\s[^;]+;\s*/gm, '').trim();
    assert.ok(body.startsWith(GATE + ' {') && body.endsWith('}'), 'the module body runs only inside the gate');
    for (const call of ['receiveHandoff(', 'mountConnectedActions(', 'document.body.append']) {
      if (code.includes(call)) assert.ok(code.indexOf(call) > code.indexOf(GATE), call + ' runs only inside the gate');
    }
  }
});

/**
 * @description Run the head block against a stub kit and stub reads and return the company model with the requests
 * it made, so the view is asserted as what it paints and what it asks for, not as a substring of the source.
 * @param {Record<string, {status?: number, body?: object}|object>} answers Route path -> JSON body, or {status, body}.
 * @returns {Promise<{model: object, requests: Array<{url: string, method: string}>}>} The model and the requests.
 */
async function companyModel(answers) {
  let config = null;
  const requests = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'when ' + v, day: (v) => 'day ' + v, num: (n) => String(n), money: (v) => '$' + v };
  const reply = (url) => { const a = answers[url]; if (a === undefined) return { status: 404, body: {} }; return a && a.status ? a : { status: 200, body: a }; };
  const fetchStub = (url, opts) => {
    requests.push({ url, method: (opts && opts.method) || 'GET' });
    const a = reply(url);
    return Promise.resolve({ ok: a.status < 400, status: a.status, json: () => Promise.resolve(a.body || {}) });
  };
  new Function('window', 'fetch', block)({ AppView: kit, location: { pathname: '/api/marketing', assign() {} } }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { model: await config.audiences.company({ refresh() {} }), requests };
}

const fixture = () => require('./audience-view.fixture.cjs')({ iso: (h) => new Date(Date.now() + h * 36e5).toISOString() }).reads;
const section = (model, id) => model.sections.find((s) => s.id === id);
const stat = (model, id) => model.stats.find((s) => s.id === id);

test('the company view reads four owner-scoped GETs and paints what needs a decision', async () => {
  const { model, requests } = await companyModel(fixture());
  assert.deepEqual(requests.map((r) => r.method + ' ' + r.url).sort(), ['GET /api/marketing-engine/home-summary', 'GET /api/marketing-engine/readiness', 'GET /api/marketing/content', 'GET /api/marketing/overview']);
  assert.equal(model.lede, '2 campaigns, 1 active.');
  assert.deepEqual(model.stats.map((s) => [s.id, String(s.value)]), [['active-campaigns', '1'], ['drafts', '1'], ['published-24h', '1'], ['approvals', '1'], ['armed-channels', '1/4'], ['experiments', '1']]);
  assert.equal(stat(model, 'armed-channels').tone, 'warn', 'a channel on with cap 0 is flagged');
  const attention = section(model, 'attention').items;
  assert.deepEqual(attention.map((i) => i.title), ['budget_monthly_usd: 150 → 200', 'Synthetic launch post', 'Synthetic welcome email']);
  assert.equal(attention[0].text, 'Synthetic launch · LinkedIn');
  assert.ok(attention.every((i) => typeof i.onClick === 'function' && !i.href), 'every row opens the full board; none writes');
  const channels = Object.fromEntries(section(model, 'channels').rows.map((r) => [r.cells[0], r.cells[1]]));
  assert.deepEqual(channels, { LinkedIn: { text: 'Armed', tone: 'ok' }, Mastodon: { text: 'On, cap 0: never sends', tone: 'warn' }, Bluesky: { text: 'Off' }, Email: { text: 'Off' } });
  const score = Object.fromEntries(section(model, 'scorecard').items.map((i) => [i.title, i.badge || i.text]));
  assert.equal(score['Week of day 2026-09-21T00:00:00.000Z'], '42 events · value 7.5', 'week_start goes through the date-only formatter');
  assert.deepEqual([score['Search Console'], score.PostHog, score['GitHub traffic']], ['No data', 'Data', 'Data']);
  assert.deepEqual(section(model, 'setup').items.map((i) => i.badge), ['Ready', 'Ready', 'Not ready']);
  assert.deepEqual(section(model, 'outcomes').rows.map((r) => r[3]), [{ text: 'Published', tone: 'ok' },
    { text: 'Skipped: daily cap is 0 — publishing is never authorized on this channel', tone: 'warn' },
    { text: 'Skipped: channel is paused: Synthetic token revoked', tone: 'warn' }], 'the cap-0 and paused refusals are named for their recorded cause');
  assert.equal(section(model, 'campaigns').rows[0].cells[2], '1 · organic');
});

test('a scorecard source without events says no events were recorded, not a cause the week does not store', async () => {
  const { model } = await companyModel(fixture());
  const items = Object.fromEntries(section(model, 'scorecard').items.map((i) => [i.title, i]));
  assert.deepEqual([items['Search Console'].text, items['Search Console'].badge, items['Search Console'].tone], ['No events recorded this week', 'No data', 'warn']);
  assert.deepEqual([items.PostHog.text, items['GitHub traffic'].text], ['40 events', '2 events'], 'a source with events shows its count');
  for (const i of Object.values(items)) assert.doesNotMatch(String(i.text), /configured|ingest|failed/i, 'no unrecorded cause: ' + i.title);
});

test('each refused or failed run shows the cause the ledger recorded, from the real publish gate', async () => {
  const { publishDecision } = require(path.join(ROOT, 'routes', 'marketing-model.js'));
  const gates = [
    ['not enabled', { enabled: false, daily_cap: 3 }, 0], ['paused', { enabled: true, daily_cap: 3, paused_reason: 'Synthetic pause' }, 0],
    ['cap 0', { enabled: true, daily_cap: 0 }, 0], ['count unknown', { enabled: true, daily_cap: 3 }, Number.NaN], ['cap used up', { enabled: true, daily_cap: 3 }, 3],
  ].map(([name, row, count]) => ({ name, decision: publishDecision(row, count) }));
  assert.deepEqual(gates.map((g) => g.decision.reason), ['skipped_consent', 'skipped_consent', 'skipped_cap', 'skipped_cap', 'skipped_cap'], 'one outcome covers several causes');
  const recentRuns = gates.map((g) => ({ channel: 'linkedin', action: 'publish', outcome: g.decision.reason, detail: { itemId: 'i-1', campaignId: 'c-1', reason: g.decision.detail }, ts: '2026-09-27T12:00:00.000Z' }))
    .concat([{ channel: 'linkedin', action: 'publish', outcome: 'error', detail: { itemId: 'i-1', error: 'Synthetic rail failure' }, ts: '2026-09-27T12:00:00.000Z' },
      { channel: 'email', action: 'publish', outcome: 'skipped_consent', detail: {}, ts: '2026-09-27T12:00:00.000Z' },
      { channel: 'email', action: 'publish', outcome: 'skipped_cap', detail: {}, ts: '2026-09-27T12:00:00.000Z' },
      { channel: 'email', action: 'publish', outcome: 'skipped_confirm', detail: { reason: 'confirmation_required' }, ts: '2026-09-27T12:00:00.000Z' }]);
  const reads = fixture();
  const { model } = await companyModel({ ...reads, '/api/marketing/overview': { ...reads['/api/marketing/overview'], recentRuns } });
  const cells = section(model, 'outcomes').rows.map((r) => r[3]);
  gates.forEach((g, i) => assert.deepEqual(cells[i], { text: 'Skipped: ' + g.decision.detail, tone: 'warn' }, g.name + ' names its own cause'));
  assert.deepEqual(cells.slice(gates.length), [{ text: 'Error: Synthetic rail failure', tone: 'bad' },
    { text: 'Skipped: not enabled or paused', tone: 'warn' }, { text: 'Skipped: cap 0, cap used up or count unknown', tone: 'warn' }, { text: 'Skipped: not confirmed', tone: 'warn' }],
  'without a recorded reason the label names every cause, never one guessed cause');
});

test('an unreadable board keeps the setup probes and names the failure', async () => {
  const { model } = await companyModel({ ...fixture(), '/api/marketing/overview': { status: 500, body: { error: 'internal_error' } } });
  assert.equal(model.title, 'The campaign board could not load');
  assert.match(model.lede, /HTTP 500/);
  assert.deepEqual(model.sections.map((s) => s.id), ['setup']);
  assert.equal(model.stats, undefined, 'no stat is guessed without the board');
});

test('a signed-out caller gets a sign-in message, not an empty board', async () => {
  const denied = { status: 401, body: { error: 'not_authenticated' } };
  const answers = Object.fromEntries(Object.keys(fixture()).map((k) => [k, denied]));
  await assert.rejects(companyModel(answers), /Sign in to see your campaigns\./);
});

test('a failed Home summary or content read degrades to what is known', async () => {
  const noSummary = await companyModel({ ...fixture(), '/api/marketing-engine/home-summary': { status: 503, body: {} } });
  assert.equal(stat(noSummary.model, 'drafts').value, 1, 'drafts fall back to the saved content count');
  assert.equal(stat(noSummary.model, 'published-24h').value, null, 'the publish count is unknown, not zero');
  const noContent = await companyModel({ ...fixture(), '/api/marketing/content': { status: 500, body: {} } });
  const attention = section(noContent.model, 'attention');
  assert.equal(attention.note, 'Saved drafts could not be read right now.');
  assert.deepEqual(attention.items.map((i) => i.title), ['budget_monthly_usd: 150 → 200']);
});

test('an empty account shows every channel off and the readiness reason', async () => {
  const off = ['linkedin', 'mastodon', 'bluesky', 'email'].map((channel) => ({ channel, enabled: false, standing_authorization: false, daily_cap: 0, paused_reason: null }));
  const { model } = await companyModel({
    '/api/marketing/overview': { campaigns: [], channels: off, scorecard: [], pendingProposals: [], experiments: [], recentRuns: [] },
    '/api/marketing/content': { items: [] },
    '/api/marketing-engine/readiness': { campaign: { ready: false, detail: 'No campaign yet — the board is where a campaign starts.' }, channels: { ready: false, detail: 'Every channel is off. Turning one on takes a channel and a daily cap.' }, sender: { ready: false, detail: 'No sender address set and Resend is not connected.' } },
    '/api/marketing-engine/home-summary': { metrics: [{ id: 'content-drafts', value: '0' }, { id: 'published-24h', value: '0' }] },
  });
  assert.equal(model.lede, 'No campaign yet — the board is where a campaign starts.');
  assert.equal(stat(model, 'armed-channels').value, '0/4');
  assert.equal(stat(model, 'armed-channels').tone, null);
  for (const id of ['attention', 'scorecard', 'outcomes']) assert.equal((section(model, id).items || section(model, id).rows).length, 0, id + ' is empty');
  assert.equal(section(model, 'campaigns').rows.length, 0);
  assert.ok(section(model, 'channels').rows.every((r) => r.cells[1].text === 'Off'));
});
