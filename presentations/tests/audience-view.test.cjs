/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The classroom audience beside company. Its model is asserted as behaviour (the head block runs against a stub kit and the fixture's reads): the five class starters in order from the studio's own catalog, the learner's work newest first with store files that have no date last, outside links as new-tab items and anything else refused, only /list and /starters read, and the named states (no catalog, nothing saved, signed out, unreadable). The full studio's other start paths are asserted off under a view: the brand-kit read (run against an active kit), the starters and brand boot, the surface-bridge attach and the hand-off / connected-actions module.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The family audience beside company and classroom. The stub-kit runner now takes the audience, and the family model is asserted as behaviour: only /list is read (no starters, no home summary, no brand kit), the household's documents newest first with undated store files last, plain kind words instead of the classroom's, "Saved <when>" and an Open badge on exactly the items that open (same-origin or https, in a new tab; javascript: and protocol-relative links refused), one action that opens the full studio in this frame, and the named states (nothing saved, signed out, refused, unreadable through the reused error mapping).
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const APP = 'presentations';
const PAGE = 'tools/presentations.html';
const AUDIENCES = ["company","classroom","family"];
const ALLOWED_PREFIXES = ["/api/presentations"];
const GATE_FILE = 'tools/presentations.html';

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

const SECTIONS = '/api/presentations/sections';
const fixtureReads = () => require('./audience-view.fixture.cjs')({ iso: (h) => new Date(Date.now() + h * 36e5).toISOString() }).reads;

/**
 * @description Run the head block against a stub kit, a stub window and a stub fetch, and return one audience's
 * model, so a view is asserted as what it paints and does rather than as a substring of the source.
 * @param {string} audience The audience to build: classroom or family (company is proven in the browser harness).
 * @param {Record<string, object|number>} reads Route path -> JSON body, or an HTTP status to fail with.
 * @returns {Promise<{model: object, fetched: string[], assigned: string[]}>} The model, every URL read, every navigation.
 */
async function viewModel(audience, reads) {
  let config = null;
  const fetched = [], assigned = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => (v ? 'WHEN' : '—'), date: () => 'DATE' };
  const win = { AppView: kit, location: { pathname: SECTIONS + '/ui', assign: (u) => assigned.push(u) } };
  const fetchStub = (url) => {
    fetched.push(url);
    const body = reads[url], status = typeof body === 'number' ? body : body ? 200 : 404;
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(status === 200 ? body : { error: 'synthetic_' + status }) });
  };
  new Function('window', 'fetch', block)(win, fetchStub);
  assert.ok(config && typeof config.audiences[audience] === 'function', 'the block boots the ' + audience + ' audience');
  const model = await config.audiences[audience]({ audience, refresh() {} });
  return { model, fetched, assigned };
}
const classroomModel = (reads) => viewModel('classroom', reads);
const familyModel = (reads) => viewModel('family', reads);

const section = (model, id) => model.sections.find((s) => s && s.id === id);

test('the classroom view offers the class starters in order and opens each one as a studio deep link', async () => {
  const { model, fetched, assigned } = await classroomModel(fixtureReads());
  assert.deepEqual(fetched.sort(), [SECTIONS + '/list', SECTIONS + '/starters'], 'only the list and the starter catalog are read');
  const tiles = section(model, 'starters').items;
  assert.deepEqual(tiles.map((t) => t.title), ['Teach a topic', 'Class newsletter', 'Poster or flyer', 'Weekly schedule', 'To-do tracker'], 'the allowlist, in its order; the pitch starter is not offered');
  assert.deepEqual(tiles.map((t) => t.meta), ['Slide show', 'Paper', 'Paper', 'Sheet', 'Sheet']);
  assert.equal(tiles[0].icon, '🎓', 'the icon is the catalog\x27s own');
  tiles[0].onClick(); tiles[3].onClick();
  model.actions[0].onClick(); model.actions[1].onClick();
  assert.deepEqual(assigned, [SECTIONS + '/ui?kind=pptx&starter=teach', SECTIONS + '/ui?kind=xlsx&starter=schedule', SECTIONS + '/ui?kind=pptx&starter=teach', SECTIONS + '/ui?kind=docx']);
  assert.equal(model.actions.filter((a) => a.primary).length, 1, 'one primary action');
});

test('the classroom view lists the learner\x27s work newest first, undated store files last, links in a new tab', async () => {
  const reads = fixtureReads();
  reads[SECTIONS + '/list'].decks.push({ title: 'Synthetic unsafe link', fileName: 'x.pptx', format: 'pptx', url: 'javascript:alert(1)', downloadUrl: '//elsewhere.example.com/x', createdAt: new Date(Date.now() - 400 * 36e5).toISOString() });
  const { model } = await classroomModel(reads);
  const items = section(model, 'work').items;
  assert.deepEqual(items.map((i) => i.title), ['Synthetic pitch deck', 'Synthetic board update', 'Synthetic report', 'Synthetic unsafe link', 'Synthetic class schedule']);
  assert.deepEqual(items.map((i) => i.meta), ['WHEN', 'WHEN', 'WHEN', 'WHEN', ''], 'an undated store file shows no date, never a guess');
  assert.equal(items[0].text, 'Slide show · 8 slides');
  assert.deepEqual([items[0].href, items[0].target], [SECTIONS + '/file?name=synthetic-pitch.pptx', '_blank']);
  assert.deepEqual([items[2].href, items[2].target], ['https://example.com/synthetic-report', '_blank'], 'an outside file opens in a new tab');
  assert.equal(items[1].href, undefined, 'a deck with no link is not clickable');
  assert.equal(items[3].href, undefined, 'a javascript: or protocol-relative link is refused');
  assert.equal(model.title, 'Your slides and papers');
  assert.equal(model.lede, '5 things saved · last one WHEN');
  assert.deepEqual(model.stats.map((s) => [s.id, s.value]), [['made-7d', 2], ['slides', 3], ['papers', 1], ['sheets', 1]]);
});

test('the classroom view names its states: no catalog, nothing saved, signed out, unreadable', async () => {
  const reads = fixtureReads();
  const noCatalog = await classroomModel({ ...reads, [SECTIONS + '/starters']: 500 });
  assert.equal(section(noCatalog.model, 'starters'), undefined, 'without the catalog the starters section is left out');
  assert.ok(section(noCatalog.model, 'work').items.length, 'the list still paints');
  const empty = await classroomModel({ ...reads, [SECTIONS + '/list']: { decks: [] } });
  assert.equal(empty.model.title, 'Make something to share');
  assert.equal(empty.model.lede, 'Pick a starter and make your first slides.');
  assert.deepEqual([section(empty.model, 'work').items, section(empty.model, 'work').empty], [[], 'Nothing saved yet — your slides will show up here.']);
  await assert.rejects(classroomModel({ ...reads, [SECTIONS + '/list']: 401 }), /You are signed out\. Sign in again to see your work\./);
  await assert.rejects(classroomModel({ ...reads, [SECTIONS + '/list']: 502 }), /Your saved work could not be read just now\./);
});

test('the family view lists the household\x27s documents newest first in plain words, each opening in a new tab', async () => {
  const reads = fixtureReads();
  reads[SECTIONS + '/list'].decks.push({ title: 'Synthetic unsafe link', fileName: 'x.pptx', format: 'pptx', url: 'javascript:alert(1)', downloadUrl: '//elsewhere.example.com/x', createdAt: new Date(Date.now() - 400 * 36e5).toISOString() });
  const { model, fetched, assigned } = await familyModel(reads);
  assert.deepEqual(fetched, [SECTIONS + '/list'], 'only the list is read: no starters, no home summary, no brand kit');
  const items = section(model, 'documents').items;
  assert.deepEqual(items.map((i) => i.title), ['Synthetic pitch deck', 'Synthetic board update', 'Synthetic report', 'Synthetic unsafe link', 'Synthetic class schedule']);
  assert.deepEqual(items.map((i) => i.text), ['Slide deck · 8 slides', 'Slide deck · 12 slides', 'Document', 'Slide deck', 'Spreadsheet'], 'plain kind words, not the classroom\x27s');
  assert.deepEqual(items.map((i) => i.meta), ['Saved WHEN', 'Saved WHEN', 'Saved WHEN', 'Saved WHEN', ''], 'an undated store file shows no date, never a guess');
  assert.deepEqual(items.map((i) => i.badge), ['Open', undefined, 'Open', undefined, 'Open'], 'Open marks exactly the items that open');
  assert.deepEqual([items[0].href, items[0].target], [SECTIONS + '/file?name=synthetic-pitch.pptx', '_blank']);
  assert.deepEqual([items[2].href, items[2].target], ['https://example.com/synthetic-report', '_blank'], 'an outside file opens in a new tab');
  assert.equal(items[1].href, undefined, 'a deck with no link is not clickable');
  assert.equal(items[3].href, undefined, 'a javascript: or protocol-relative link is refused');
  assert.deepEqual([model.kicker, model.title, model.lede], ['Our documents', 'Recent documents', '5 documents saved · last one saved WHEN']);
  assert.deepEqual(model.stats.map((s) => [s.id, s.value]), [['saved-7d', 2], ['decks', 3], ['documents', 1], ['sheets', 1]]);
  assert.equal(section(model, 'documents').note, 'Tap Open to see a document in a new tab.');
  assert.deepEqual(model.actions.map((a) => [a.label, !!a.primary]), [['Make something new', true]], 'one action, and it only opens the studio');
  model.actions[0].onClick();
  assert.deepEqual(assigned, [SECTIONS + '/ui'], 'the action opens the full studio in this frame, without the audience');
});

test('the family view names its states: nothing saved, signed out, refused, unreadable', async () => {
  const reads = fixtureReads();
  const empty = await familyModel({ ...reads, [SECTIONS + '/list']: { decks: [] } });
  assert.deepEqual([empty.model.title, empty.model.lede], ['Nothing saved yet', 'Open AI Office to make a slide deck, a document or a spreadsheet. What you save shows up here.']);
  const docs = section(empty.model, 'documents');
  assert.deepEqual([docs.items, docs.empty, docs.note], [[], 'Nothing saved yet — documents you make show up here.', null]);
  assert.deepEqual(empty.model.stats.map((s) => s.value), [0, 0, 0, 0]);
  const signedOut = await familyModel({ ...reads, [SECTIONS + '/list']: 401 });
  assert.deepEqual([signedOut.model.kicker, signedOut.model.title, signedOut.model.sections], ['Our documents', 'Sign in to see your documents', undefined], 'a hero only: nothing is guessed');
  const refused = await familyModel({ ...reads, [SECTIONS + '/list']: 403 });
  assert.deepEqual([refused.model.title, refused.model.lede], ['This account cannot open AI Office', 'The AI Office routes refused this account (HTTP 403).']);
  await assert.rejects(familyModel({ ...reads, [SECTIONS + '/list']: 502 }), /Your saved work could not be read just now\./, 'the shared error mapping is reused');
});

test('under an audience view the brand kit is never read; the full studio still reads it', () => {
  const s = html.indexOf("// ── Your brand: Create's brand kit");
  const e = html.indexOf('.catch(() => {', html.indexOf('const brandReady'));
  const brandBlock = html.slice(s, html.indexOf('\n', e) + 1);
  const run = (AppView) => {
    const calls = [];
    const context = { fetch: (url) => { calls.push(url); return Promise.resolve({ ok: false }); }, AbortSignal: { timeout: (ms) => ({ ms }) } };
    if (AppView) context.AppView = AppView;
    vm.createContext(context); vm.runInContext(brandBlock, context);
    return calls;
  };
  assert.deepEqual(run({ active: () => 'classroom' }), [], 'an active view does not ask for the brand kit');
  assert.deepEqual(run({ active: () => null }), ['/api/create/brand-kit'], 'the full studio asks once');
  assert.deepEqual(run(null), ['/api/create/brand-kit'], 'a core without the kit runs the full studio');
});

test('under an audience view the starters boot, the relay and the connected actions stay off', () => {
  const gate = /if \(!window\.AppView \|\| !AppView\.active\(\)\) \{\n  renderKinds\(\);[^\n]*\n[\s\S]*?\n\}\n/.exec(html);
  assert.ok(gate, 'the full studio start is one gated block');
  assert.match(gate[0], /Promise\.all\(\[themesReady, loadStarters\(\)\]\)\.then\(applyDeepLink\);/);
  assert.match(gate[0], /Promise\.all\(\[themesReady, brandReady\]\)\.then\(applyBrand\);/);
  assert.equal([...html.matchAll(/loadStarters\(\)(?!\s*\{)/g)].length, 1, 'the starters are loaded only from the gated block');
  const modules = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(modules.length, 2, 'the relay module and the hand-off module');
  for (const call of ['.attach()', 'receiveHandoff(', 'mountConnectedActions(', 'document.body.append(']) {
    const owner = modules.find((m) => m.includes(call));
    assert.ok(owner, call + ' is made in a module');
    const at = owner.lastIndexOf(call);
    const gateAt = owner.indexOf('if (!window.AppView || !AppView.active()) {');
    assert.ok(gateAt >= 0 && gateAt < at, call + ' runs only inside the full-studio gate');
  }
});
