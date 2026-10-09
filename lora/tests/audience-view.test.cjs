/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove that on open it makes exactly one read, GET /api/lora/home-summary (never /characters, whose read saves the starter character for a new account, never a version, scorecard, cell-image or dataset read, never a write), that the stats are the route's three counts plus the newest character's recorded score, that the title and lede name the account's state in plain words, that each character tile reads its latest version and status from the route's own detail and its score from the route's own evaluation sentence, and that no character, an unscored, failed or oddly named version, a partial answer, a 401, a 403, a failed read, a non-JSON answer and an unreachable server each read as what they are. The studio script is proved gated by running it against recording stubs: under the view it wires no control and reads nothing; with the kit idle or absent it wires the four controls and reads /characters as before.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'lora';
const PAGE = 'tools/lora.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/lora"];
const GATE_FILE = 'tools/lora.html';

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
 * (body undefined = not JSON); `{ offline: true }` rejects as a network failure does.
 * @returns {{ family: Function, urls: string[], opened: string[] }} The builder, every request made, every A.open href.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url];
    if (a && a.offline) return Promise.reject(new TypeError('Failed to fetch'));
    const status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

const S = '/api/lora/home-summary';
const T1 = '2026-09-28T21:30:00.000Z', T2 = '2026-09-27T20:00:00.000Z', T3 = '2026-09-20T12:00:00.000Z', NOW = '2026-09-28T22:00:00.000Z';

/**
 * @description The route's three counts as routes/home-summary.js writes them: digit strings, or 'Unavailable' for a
 * source that failed.
 * @param {string} characters Saved characters.
 * @param {string} active Versions queued or training.
 * @param {string} failed Failed versions.
 * @returns {object[]} Metrics, which the route mirrors as tiles.
 */
function metrics(characters, active, failed) {
  return [
    { id: 'characters', label: 'Saved characters', value: characters },
    { id: 'training-active', label: 'Queued / training', value: active },
    { id: 'training-failed', label: 'Failed versions', value: failed },
  ];
}

/**
 * @description One character item as routes/home-summary.js writes it: the display name as text, the latest-version
 * detail, and the prepare-document offer whose notes are the detail and the route's evaluation sentence, whitespace
 * collapsed by its clip().
 * @param {string} name The display name.
 * @param {{ version: number, status: string, at: string, active?: number, overall?: string, evaluated?: string }|null} latest
 * The latest saved version, or null for a character with none.
 * @returns {object} The item.
 */
function character(name, latest) {
  const detail = latest ? 'Latest version ' + latest.version + ' · ' + latest.status + ' · registered ' + latest.at : 'No saved model version';
  const evaluation = latest && latest.overall != null ? latest.overall + ' on a 0–1 scale at ' + latest.evaluated : 'not recorded';
  const body = 'Active version: ' + (latest && latest.active != null ? latest.active : 'none') + '. Latest-version evaluation: ' + evaluation + '. Registration is not a training completion timestamp.';
  return { text: name, detail, tone: 'neutral', fix: 'lora-studio', actions: [{ integration: 'prepare-document', context: { title: name, notes: detail + ' ' + body } }] };
}

const NO_WORK = { text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: 'lora-studio' };
const PARTIAL = { text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'lora-studio' };
const BOUNDS = { text: 'Character ownership also scopes model and score rows. The latest registered model and its matching evaluation remain separate from the active version. No GPU dispatch or model promotion runs on Home; prepare a model card from recorded evidence.', tone: 'neutral', fix: 'lora-studio' };
/** @returns {object} A home-summary answer: the counts, the items followed by the route's bounds note, and the partial flag. */
const summary = (m, items, partial) => ({ metrics: m, tiles: m, items: items.concat([BOUNDS]), asOf: NOW, partial: !!partial });
const CHARS = [
  character('Synthetic Cyclops', { version: 3, status: 'scored', at: T1, active: 2, overall: '0.8312', evaluated: T1 }),
  character('Synthetic Tin Drummer', { version: 1, status: 'training', at: T2 }),
  character('Synthetic Fox', null),
];
const OK = { [S]: summary(metrics('3', '1', '1'), CHARS) };
const tiles = (model) => model.sections[0].items.map((i) => [i.icon, i.title, i.text, i.meta, i.badge]);
const values = (model) => model.stats.map((x) => [x.id, x.value, x.tone || null, x.hint || null]);

test('on open the family view makes one plain GET read, the home summary: never the character list, a version, scorecard, image or dataset read, or a write', async () => {
  const view = loadFamily(OK);
  await view.family({});
  assert.deepEqual(view.urls, ['GET ' + S]);
  assert.doesNotMatch(block, /method\s*:/, 'the head block never sets a request method');
  assert.doesNotMatch(block, /\/(characters|models|scorecard|cell-image|dataset|train|validate|improve|ingest|schedule)\b/, 'the head block names no studio read or action route');
  assert.deepEqual(view.opened, [], 'nothing opens on its own');
});

test('the stats, title, lede and tiles name the saved characters in plain words', async () => {
  const view = loadFamily(OK), model = await view.family({});
  assert.deepEqual([model.kicker, model.title, model.lede, model.actions.map((a) => a.label)],
    ['Character studio', '1 version waiting or training', 'Newest: Synthetic Cyclops, version 3 trained and scored, score 0.83 of 1.', ['Open LoRA Studio']]);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=lora'], 'the one action opens LoRA Studio in the cockpit');
  assert.deepEqual(model.stats.map((x) => x.label), ['Saved characters', 'Versions waiting or training', 'Versions that did not finish', 'Newest score']);
  assert.deepEqual(values(model), [['characters', 3, null, null], ['training', 1, null, null], ['failed', 1, 'warn', null], ['score', '0.83', null, 'Synthetic Cyclops']]);
  assert.deepEqual([model.sections.length, model.sections[0].kind, model.sections[0].id, model.sections[0].title], [1, 'tiles', 'characters', 'Your newest characters']);
  assert.deepEqual(tiles(model), [
    ['🧿', 'Synthetic Cyclops', 'Version 3 · Trained and scored', 'version recorded W(' + T1 + ')', 'Score 0.83'],
    ['🧿', 'Synthetic Tin Drummer', 'Version 1 · Training now', 'version recorded W(' + T2 + ')', null],
    ['🧿', 'Synthetic Fox', 'No trained version yet', null, null],
  ], 'the notes and the bounds text are not characters');
  assert.ok(model.sections[0].items.every((i) => !i.href && !i.onClick), 'a tile opens nothing: training, scorecards and images stay in the studio');
  assert.equal(model.sections[0].note, 'A score runs from 0 to 1: closer to 1 means the pictures look more like the character. Recorded is when a version was added, not when its training finished. Training starts only in LoRA Studio.');
});

test('no characters, saved but untrained, a failed newest version and odd route values each read as what they are', async () => {
  const none = await loadFamily({ [S]: summary(metrics('0', '0', '0'), [NO_WORK]) }).family({});
  assert.deepEqual([none.title, none.lede, none.sections[0].items, none.sections[0].empty, none.sections[0].note],
    ['No characters saved yet', 'LoRA Studio teaches the computer to draw one character the same way every time. Characters you save there show up here.', [], 'No characters yet. Characters you save in LoRA Studio show up here.', null]);
  assert.deepEqual(values(none), [['characters', 0, null, null], ['training', 0, null, null], ['failed', 0, null, null], ['score', '—', null, null]]);
  const saved = await loadFamily({ [S]: summary(metrics('2', '0', '0'), [character('Synthetic Owl', { version: 2, status: 'trained', at: T2 }), character('Synthetic Fox', null)]) }).family({});
  assert.deepEqual([saved.title, saved.lede, values(saved)[3]], ['2 characters saved', 'Newest: Synthetic Owl, version 2 trained, not scored yet.', ['score', '—', null, 'Not scored yet']]);
  const failed = await loadFamily({ [S]: summary(metrics('1', '0', '1'), [character('Synthetic Owl', { version: 4, status: 'failed', at: T3 })]) }).family({});
  assert.deepEqual([failed.title, failed.lede, tiles(failed)[0][2], values(failed)[2]], ['1 character saved', 'Newest: Synthetic Owl, version 4 did not finish.', 'Version 4 · Did not finish', ['failed', 1, 'warn', null]]);
  const odd = character('   ', { version: 5, status: 'constructor', at: 'date unavailable' });
  const other = Object.assign(character('Synthetic Newt', null), { detail: 'Some other detail' });
  const strange = await loadFamily({ [S]: summary(metrics('2', '0', '0'), [odd, other]) }).family({});
  assert.deepEqual([strange.lede, tiles(strange)], ['Newest: Saved character, version 5 saved.', [['🧿', 'Saved character', 'Version 5 · Saved', null, null], ['🧿', 'Synthetic Newt', null, null, null]]],
    'a stored constructor status stays a word, an unreadable date shows no time and a detail in neither shape claims no version state');
});

test('a partial answer names what could not be checked', async () => {
  const counts = await loadFamily({ [S]: summary(metrics('2', 'Unavailable', 'Unavailable'), [CHARS[0], PARTIAL], true) }).family({});
  assert.deepEqual([counts.title, counts.lede], ['Some saved characters cannot be checked', 'Newest: Synthetic Cyclops, version 3 trained and scored, score 0.83 of 1.']);
  assert.deepEqual(values(counts).slice(0, 3), [['characters', 2, null, null], ['training', '—', 'warn', 'Could not check'], ['failed', '—', 'warn', 'Could not check']]);
  const rows = await loadFamily({ [S]: summary(metrics('2', '0', '0'), [PARTIAL], true) }).family({});
  assert.deepEqual([rows.title, rows.lede, rows.sections[0].empty], ['Some saved characters cannot be checked', 'Your saved characters could not be checked right now.', 'Some saved characters could not be checked.']);
  const shapeless = await loadFamily({ [S]: {} }).family({});
  assert.deepEqual([shapeless.title, values(shapeless)[0]], ['Some saved characters cannot be checked', ['characters', '—', 'warn', 'Could not check']], 'an answer without counts is never read as zero');
});

test('a refusal and a failure each read as what they are', async () => {
  const signedOut = await loadFamily({ [S]: { http: 401, body: { error: 'not_authenticated' } } }).family({});
  assert.deepEqual([signedOut.title, signedOut.lede, signedOut.sections, signedOut.stats],
    ['Sign in to see your characters', 'LoRA Studio shows the characters of whoever is signed in, and this session is not signed in.', undefined, undefined]);
  const denied = await loadFamily({ [S]: { http: 403, body: { error: 'forbidden' } } }).family({});
  assert.deepEqual([denied.title, denied.lede], ['This account cannot see saved characters', 'The LoRA Studio routes refused this account (HTTP 403): seeing saved characters needs permission to read them.']);
  const allFailed = summary(metrics('Unavailable', 'Unavailable', 'Unavailable'), [PARTIAL], true);
  await assert.rejects(loadFamily({ [S]: { http: 503, body: allFailed } }).family({}), /^Error: LoRA Studio could not read your saved characters \(HTTP 503\)\.$/, 'the route answers 503 when every source failed');
  await assert.rejects(loadFamily({ [S]: { http: 502, body: undefined } }).family({}), /^Error: LoRA Studio could not read your saved characters \(HTTP 502\)\.$/, 'a failure that is not JSON');
  await assert.rejects(loadFamily({ [S]: { http: 200, body: undefined } }).family({}), /^Error: LoRA Studio could not read your saved characters\.$/, 'an answer that is not JSON');
  await assert.rejects(loadFamily({ [S]: { offline: true } }).family({}), /^Error: LoRA Studio could not read your saved characters\.$/, 'a network failure');
});

test('the body carries one inline script, the studio, and its start sits behind the kit gate', () => {
  const body = html.slice(html.indexOf('<body'));
  assert.deepEqual([...body.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1].trim()), [''], 'a new body script must be checked for start work under the view');
  assert.match(body, /\nif \(!window\.AppView \|\| !AppView\.active\(\)\) \{ bindStudio\(\); loadChars\(\); \}\n<\/script>/);
});

/**
 * @description Run the page's studio script against a stub window, document and fetch that record every element
 * lookup, listener and request, so what the start does is observed without a browser. A request never settles.
 * @param {string|null|undefined} activeView What AppView.active() answers; undefined = the kit is not loaded.
 * @returns {string[]} Every lookup, listener and request, in order (empty = the studio never started).
 */
function runStudio(activeView) {
  const body = html.slice(html.indexOf('<body'));
  const open = body.indexOf('<script>') + 8, src = body.slice(open, body.indexOf('</script>', open));
  const touched = [];
  const document = { getElementById: (id) => { touched.push('element ' + id); return { addEventListener: (type) => touched.push('listen ' + id + ' ' + type) }; } };
  const fetchStub = (url, opt) => { touched.push(((opt && opt.method) || 'GET') + ' ' + url); return new Promise(() => {}); };
  const window = { location: { search: '' }, top: null };
  if (activeView !== undefined) window.AppView = { active: () => activeView };
  new Function('window', 'AppView', 'document', 'fetch', src)(window, window.AppView, document, fetchStub);
  return touched;
}

test('under an audience view the studio never starts; with the kit idle or absent it starts as before', () => {
  const started = ['element characterForm', 'listen characterForm submit', 'element cancelCharacter', 'listen cancelCharacter click',
    'element importArtifactBtn', 'listen importArtifactBtn click', 'element refreshDatasetBtn', 'listen refreshDatasetBtn click', 'GET /api/lora/characters'];
  assert.deepEqual(runStudio('family'), [], 'no control is wired and /characters (which saves the starter character) is never read');
  assert.deepEqual(runStudio(null), started, 'the full page wires its controls, then reads the character list');
  assert.deepEqual(runStudio(undefined), started, 'a core without the kit starts the full page');
});
