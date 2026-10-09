/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'create';
const PAGE = 'tools/create-new.html';
const AUDIENCES = ["family","company"];
const ALLOWED_PREFIXES = ["/api/create"];
const GATE_FILE = 'tools/create-new.html';

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
 * @description Run the head block against a stub kit and a stub fetch, so the family view is asserted as the model it
 * paints and the reads it makes. The stub formatter tags its input: W = AppView.when.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead
 * (a body of undefined is not JSON); `{ reject: true }` fails the request itself (a network error).
 * @returns {{ config: object, family: Function, urls: string[], assigned: string[] }} The boot config, the builder, every request and every navigation.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], assigned = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')' };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url];
    if (a && a.reject) return Promise.reject(new TypeError('Failed to fetch'));
    const status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit, location: { pathname: '/api/create/new', assign: (u) => assigned.push(u) } }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { config, family: config.audiences.family, urls, assigned };
}

/**
 * @description A strict read-only pool double for the real compiled Create router (served by tests/project-api.fixture.mjs):
 * owner-qualified project reads answer the given rows and count; any SQL other than the transaction frame is refused.
 * @param {object[]} rows create_projects metadata rows (project_id, title, current_revision, created_at, updated_at).
 * @returns {object} The pool.
 */
function projectPool(rows) {
  const pool = { queries: [], releases: [] };
  pool.connect = async () => ({
    query: async (sql, values = []) => {
      pool.queries.push({ sql, values });
      if (/^(BEGIN|COMMIT|ROLLBACK|SET|SELECT set_config)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^SELECT/.test(sql) && /FROM create_projects/.test(sql) && /owner_issuer=\$1/.test(sql) && /owner_sub=\$2/.test(sql)) {
        return /COUNT/.test(sql) ? { rows: [{ count: rows.length }], rowCount: 1 } : { rows: rows.slice(0, 6), rowCount: Math.min(rows.length, 6) };
      }
      throw new Error('Fixture refused unexpected SQL');
    },
    release: (discard) => pool.releases.push(discard),
  });
  return pool;
}

/**
 * @description Answer GET /api/create/home-summary from the real compiled router over the pool double, as the view reads it.
 * @param {object} t The node:test context (the fixture closes its server after the test).
 * @param {object[]} rows The project rows.
 * @param {object} [options] Fixture options (denied permissions).
 * @returns {Promise<object>} The JSON body when the route answered 200, else `{ http, body }`.
 */
async function fromRoute(t, rows, options = {}) {
  const { startApi } = await import('./project-api.fixture.mjs');
  const api = await startApi(t, projectPool(rows), options);
  const result = await api.call('/home-summary');
  return result.status === 200 ? result.body : { http: result.status, body: result.body };
}

const H = '/api/create/home-summary';
const ID1 = '00000000-0000-4000-8000-00000000000a', ID2 = '00000000-0000-4000-8000-00000000000b';
const row = (id, title, updated) => ({ project_id: id, title, current_revision: 2, created_at: new Date('2026-09-01T10:00:00.000Z'), updated_at: new Date(updated) });
const ROWS = [row(ID1, 'Synthetic autumn poster', '2026-09-28T09:00:00.000Z'), row(ID2, 'Synthetic bake sale flyer', '2026-09-27T08:00:00.000Z')];
const section = (model, id) => model.sections.find((x) => x && x.id === id);

test('the company audience is the same account-scoped builder as the family one', () => {
  const { config } = loadFamily({});
  assert.equal(config.app, 'create'); assert.equal(config.audiences.company, config.audiences.family);
});

test('on open the view reads only the home summary: no studio access checks, no AI Office starters, no write', async (t) => {
  const loaded = loadFamily({ [H]: await fromRoute(t, ROWS) });
  await loaded.family({});
  assert.deepEqual(loaded.urls, ['GET ' + H]);
});

test('fed the JSON the real route builds, the view counts the projects and lists each with its update time and editor link', async (t) => {
  const model = await loadFamily({ [H]: await fromRoute(t, ROWS) }).family({});
  assert.equal(model.kicker, 'Creative · Create'); assert.equal(model.title, '2 image projects'); assert.match(model.lede, /looking starts nothing\.$/);
  assert.deepEqual(model.stats.map((s) => [s.id, s.label, s.value, s.tone, s.hint]), [['image-projects', 'Image projects', '2', 'ok', null]]);
  const projects = section(model, 'projects');
  assert.deepEqual([projects.kind, projects.title, projects.wide, projects.note], ['list', 'Your image projects', true, 'Newest first. Each opens in the image editor.']);
  assert.deepEqual(projects.items, [
    { title: 'Synthetic autumn poster', text: 'Layered image', meta: 'Updated W(2026-09-28T09:00:00.000Z)', href: '/api/create/editor?project=' + ID1 },
    { title: 'Synthetic bake sale flyer', text: 'Layered image', meta: 'Updated W(2026-09-27T08:00:00.000Z)', href: '/api/create/editor?project=' + ID2 }]);
  assert.deepEqual(section(model, 'studios').items.map((i) => i.title), ['AI Office', 'Portrait Studio', 'Video Studio', 'Vids Studio', 'Stories', '3D Scan-to-Print', 'Image editor']);
  assert.deepEqual(model.actions.map((a) => [a.label, !!a.primary]), [['Open Create', true]]);
});

test('one project reads singular, none reads as nothing saved, and an item the view cannot trust links nowhere', async (t) => {
  assert.equal((await loadFamily({ [H]: await fromRoute(t, ROWS.slice(0, 1)) }).family({})).title, '1 image project');
  const empty = await loadFamily({ [H]: await fromRoute(t, []) }).family({});
  assert.equal(empty.title, 'No image projects yet'); assert.equal(empty.stats[0].value, '0'); assert.equal(empty.stats[0].tone, null);
  assert.equal(section(empty, 'projects').items.length, 0); assert.equal(section(empty, 'projects').note, 'Nothing saved yet. Open Create to start one.');
  const odd = await loadFamily({ [H]: { items: [{ text: 'Synthetic odd', detail: 'Layered image · updated soon', actions: [{ tool: 'create-editor', query: 'project=../x' }] }], metrics: [{ label: 'Image projects', value: 'many' }] } }).family({});
  assert.equal(odd.title, 'Your image projects'); assert.equal(odd.stats[0].hint, 'Could not be checked');
  assert.deepEqual(section(odd, 'projects').items[0], { title: 'Synthetic odd', text: 'Layered image', meta: '', href: undefined });
});

test('every refusal is said in the card with no figure in its place, and the action leaves the view for the full page', async (t) => {
  const cases = [[{ http: 401, body: { error: 'project_identity_required' } }, 'Sign in to see your projects.'],
    [await fromRoute(t, ROWS, { denied: ['project.read'] }), 'Create is not available to this account.'],
    [{ http: 503, body: { error: 'project_store_unavailable' } }, 'Your projects cannot be checked right now (HTTP 503).'],
    [{ http: 500, body: undefined }, 'Your projects cannot be checked right now (HTTP 500).'], [{ reject: true }, 'Create could not be reached.']];
  for (const [answer, sentence] of cases) {
    const loaded = loadFamily({ [H]: answer });
    const model = await loaded.family({});
    assert.equal(model.title, 'Your projects are not available right now', sentence);
    assert.equal(model.lede, sentence + ' No figure is shown in its place.');
    assert.equal(model.stats, undefined); assert.equal(model.sections, undefined);
    model.actions[0].onClick(); assert.deepEqual(loaded.assigned, ['/api/create/new']);
  }
});

test('under an audience view the page starts nothing; without one it still runs every start step', () => {
  const tail = html.slice(html.lastIndexOf('<script>'), html.lastIndexOf('</script>'));
  const gate = tail.indexOf('if (!window.AppView || !AppView.active()) {');
  assert.ok(gate > 0, 'the page start is gated');
  for (const step of ['  render();\n  Object.keys(STUDIO)', 'accessFor(app).then', "fetchJson('/api/presentations/sections/starters')", "new URLSearchParams(location.search).get('cat')"]) {
    assert.ok(tail.indexOf(step) > gate, step + ' is inside the gate');
  }
  assert.match(tail, /catch \(_\) \{\}\r?\n  \}\r?\n\}\)\(\);\s*$/, 'the gate closes after the last start step');
});
