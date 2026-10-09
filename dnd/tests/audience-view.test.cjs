/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (only GET /campaigns, /characters and /home-summary; never a write, never the connected-actions plan, never a table, state, sync, playback or archive read), that the stats, title and lede name the saved games (in progress, finished or archived, saved heroes, last played), that each game reads as the table's own place in plain words with its players and the caller's role, that the story beats are read from the route's own offer notes (a beat ending in a period kept whole, a game with no story and the route's own notes skipped, a long beat clipped), that the join code is never painted, that nothing carries a link and the one action opens the cockpit, that a heroes or story read failing on its own is named as not checked while the games still show, and that a 401, a 403, a 5xx, a failure with its own error and a non-JSON failure each read as what they are. The page's module script (top-level await, so run as an async function body) is proved to mount no connected actions and read nothing under the view while the full page still runs every start step.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The second page: the table (ui/table.html, the games group's first surface, which the Jarvis shell opens with ?audience=family) boots the kit in its head before the tabletop bundle and the served, script-inlined document keeps that order. Its family view is asserted over a stub kit and fetch (only GET /campaigns, /characters and /content; each game named with its adventure and chapter as the route resolves them, where it stands, its players and the caller's role; the heroes; the adventure shelf; a heroes or shelf read failing on its own named as not checked; 401, 403, 5xx, non-JSON and own-error failures each named) and over the package's REAL router with a recording pool (exactly two SELECTs pinned to the caller, the join code never painted, signed out and database unavailable named). The gates are proved by running table-voice.js, table-immersive.js and table-screens.js in a VM: under the view no audio listener, no legacy key removal, no immersive wiring, no animation loop, no narrator status, no glitch banner and no boot read; without the view, or without the kit, every one of them still runs.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createDndRoutes } = require('../routes/dnd-routes');

const APP = 'dnd';
const PAGE = 'tools/review.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/dnd"];
const GATE_FILE = 'tools/review.html';

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
 * @description Run a page's head block against a stub kit and the given fetch. The stub relative-time formatter tags its
 * input (W = AppView.when), so a test names exactly which field was formatted.
 * @param {string} source The head block's script body.
 * @param {Function} fetchImpl The fetch the block sees.
 * @returns {{ family: Function, opened: string[] }} The family builder and every A.open target.
 */
function bootBlock(source, fetchImpl) {
  let config = null;
  const opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', open: (href) => { opened.push(href); } };
  new Function('window', 'fetch', source)({ AppView: kit }, fetchImpl);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, opened };
}

/**
 * @description Run a head block against a stub kit and a stub fetch, so the family view is asserted as the model it
 * paints and the reads it makes.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @param {string} [source] The head block (the review page's by default).
 * @returns {{ family: Function, urls: string[], opened: string[] }} The builder, every request made and every A.open target.
 */
function loadFamily(answers, source) {
  const urls = [];
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  const booted = bootBlock(source || block, fetchStub);
  return { family: booted.family, urls, opened: booted.opened };
}

const C = '/api/dnd/campaigns', H = '/api/dnd/characters', S = '/api/dnd/home-summary';
const JOIN = 'SYNQ7X';
/** @returns {object} A saved game as GET /campaigns projects it (campaignSummaryDto), join code included. */
const game = (id, name, extra) => Object.assign({ campaign_id: id, name, adventure_id: 'goblin-ambush', status: 'active', join_code: JOIN, created_at: '2026-09-01T10:00:00.000Z',
  updated_at: '2026-09-27T10:00:00.000Z', is_owner: false, my_character: null, mode: 'setup', scene_id: null, round: 0, rev: 1, player_count: 1, last_played_at: '2026-09-27T10:00:00.000Z' }, extra || {});
/** @returns {object} A saved hero as GET /characters projects it (characterDto). */
const hero = (name, race, cls, level) => ({ character_id: '00000000-0000-4000-8000-00000000000' + level, slug: name.toLowerCase().replace(/\s+/g, '-'), name,
  sheet: { id: name, name, race, class: cls, level }, xp: 0, level, created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-26T10:00:00.000Z' });
/** @returns {object} One saved-game item exactly as routes/home-summary.js builds it, its offers' notes carrying the latest archive entry. */
const saved = (name, content) => {
  const detail = 'active / saved 2026-09-27T10:00:00.000Z';
  const notes = detail + ' Latest recorded story beat: ' + content + '. Prepare a session recap or discuss refreshments for the next session; no session date is implied.';
  return { text: name, detail, tone: 'neutral', fix: 'dnd-table', actions: ['prepare-document', 'plan-meal'].map((integration) => ({ integration, context: { title: name, notes } })) };
};
const MEMBER_NOTE = { text: 'Shows campaigns the caller owns or currently belongs to using the same campaign member ACL as the game.', tone: 'neutral', fix: 'dnd-table' };
const NOT_CHECKED = { text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'dnd-table' };
/** @returns {object} A home summary as the route answers it. */
const summary = (items, partial) => ({ metrics: [], tiles: [], items: items.concat([MEMBER_NOTE]), asOf: '2026-09-28T12:00:00.000Z', partial: !!partial });
const GAMES = [
  game('c1', 'Synthetic Blackwater', { is_owner: true, my_character: 'synthetic-aria', mode: 'combat', round: 3, player_count: 3, last_played_at: '2026-09-28T08:00:00.000Z' }),
  game('c2', 'Synthetic Goblin Ambush', { my_character: 'synthetic-bram', mode: 'exploration', player_count: 2 }),
  game('c3', 'Synthetic Lantern Road', { status: 'archived', is_owner: true, mode: 'complete', last_played_at: '2026-08-30T10:00:00.000Z' }),
];
const HEROES = [hero('Synthetic Aria', 'Elf', 'Wizard', 3), hero('Synthetic Bram', 'Dwarf', 'Fighter', 1)];
const STORY = summary([saved('Synthetic Blackwater', 'The bell tolls twice.'), saved('Synthetic Goblin Ambush', 'none'), saved('Synthetic Lantern Road', 'The road home is safe')]);
const OK = { [C]: { ok: true, campaigns: GAMES }, [H]: { ok: true, characters: HEROES }, [S]: STORY };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const build = (answers) => loadFamily(Object.assign({}, OK, answers)).family({});

test('on open the view reads only the saved games, the saved heroes and the home summary: never a write, never the connected-actions plan', async () => {
  const view = loadFamily(OK);
  await view.family({});
  assert.deepEqual(view.urls, ['GET ' + C, 'GET ' + H, 'GET ' + S]);
  const paths = [...new Set([...block.matchAll(/(?:call|soft)\('([^']+)'\)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(paths, ['/campaigns', '/characters', '/home-summary'], 'no board, sync, playback, archive, model or media read is even named');
  assert.doesNotMatch(block, /method:|home-plan|join_code/, 'no write, no connected-actions plan, no join code field');
});

test('the stats, title and lede name the saved games; each game reads as its place in plain words with its players and the caller\x27s role', async () => {
  const view = loadFamily(OK), model = await view.family({});
  assert.deepEqual([model.kicker, model.title, model.lede], ['Game night', '2 games in progress', 'Last played: Synthetic Blackwater, W(2026-09-28T08:00:00.000Z). In a battle · round 3.']);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.hint || null]), [
    ['playing', 'Games in progress', 2, null], ['finished', 'Finished or archived', 1, null], ['heroes', 'Saved heroes', 2, null], ['last', 'Last played', 'W(2026-09-28T08:00:00.000Z)', null],
  ]);
  assert.deepEqual(section(model, 'games').items.map((i) => [i.icon, i.title, i.text, i.meta, i.badge]), [
    ['🐉', 'Synthetic Blackwater', 'In a battle · round 3 · 3 players', 'played W(2026-09-28T08:00:00.000Z)', 'You host'],
    ['🐉', 'Synthetic Goblin Ambush', 'Following leads · 2 players', 'played W(2026-09-27T10:00:00.000Z)', 'Playing synthetic-bram'],
    ['📜', 'Synthetic Lantern Road', 'Adventure finished · 1 player', 'played W(2026-08-30T10:00:00.000Z)', 'You host'],
  ]);
  assert.deepEqual(section(model, 'heroes').items.map((i) => [i.title, i.text, i.meta]), [
    ['Synthetic Aria', 'Level 3 Elf Wizard', 'saved W(2026-09-26T10:00:00.000Z)'], ['Synthetic Bram', 'Level 1 Dwarf Fighter', 'saved W(2026-09-26T10:00:00.000Z)'],
  ]);
  assert.equal(JSON.stringify(model).includes(JOIN), false, 'the join code is never painted');
  assert.equal(model.sections.filter(Boolean).some((s) => s.items.some((i) => i.href || i.onClick)), false, 'no item links anywhere');
  assert.deepEqual(model.actions.map((a) => a.label), ['Open the game table']);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=dnd'], 'the one action opens the cockpit through the kit');
});

test('the story beats come from the route\x27s own offer notes: a trailing period kept, a game with no story and the route notes skipped, a long beat clipped', async () => {
  const model = await build({});
  assert.deepEqual(section(model, 'story').items.map((i) => [i.title, i.text]), [['Synthetic Blackwater', 'The bell tolls twice.'], ['Synthetic Lantern Road', 'The road home is safe']]);
  assert.equal(section(model, 'story').note, null);
  const long = 'The long road winds on. '.repeat(20).trim();
  const clipped = section(await build({ [S]: summary([saved('Synthetic Blackwater', long)], true) }), 'story');
  assert.ok(clipped.items[0].text.length <= 280 && clipped.items[0].text.endsWith('…') && long.startsWith(clipped.items[0].text.slice(0, -1)), 'clipped at 280 characters');
  assert.equal(clipped.note, 'Some saved story could not be checked.');
  const quiet = section(await build({ [S]: summary([saved('Synthetic Goblin Ambush', 'none'), NOT_CHECKED]) }), 'story');
  assert.deepEqual([quiet.items, quiet.empty], [[], 'No story has been recorded yet.']);
});

test('each saved board reads as the table reads it, and the title names the household state', async () => {
  const places = await build({ [C]: { campaigns: [
    game('a', 'Synthetic Lobby'), game('b', 'Synthetic Won', { mode: 'resolved' }), game('c', 'Synthetic Fell', { mode: 'defeat' }),
    game('d', 'Synthetic Shelved', { status: 'archived', mode: 'combat', round: 2 }), game('e', 'Synthetic Skirmish', { mode: 'combat', player_count: 0 }), game('f', 'Synthetic Odd', { mode: 'scene' }),
  ] } });
  assert.deepEqual(section(places, 'games').items.map((i) => i.text), ['Choosing heroes · 1 player', 'Battle won · the next scene is waiting · 1 player', 'The party fell · the story can be watched again · 1 player',
    'Archived · the story can be watched again · 1 player', 'In a battle', 'In the adventure · 1 player']);
  assert.deepEqual([places.title, places.stats[0].value, places.stats[1].value], ['4 games in progress', 4, 2]);
  const done = await build({ [C]: { campaigns: [GAMES[2]] } });
  assert.deepEqual([done.title, done.lede], ['No game in progress', 'Last played: Synthetic Lantern Road, W(2026-08-30T10:00:00.000Z). Adventure finished.']);
  const none = await build({ [C]: { campaigns: [] }, [H]: { characters: [] } });
  assert.deepEqual([none.title, none.lede, section(none, 'games').items, section(none, 'games').empty, none.sections.filter(Boolean).length, none.stats[3].value],
    ['No games yet', 'Open Dungeon Master to start a campaign, or to join a friend at their table with the code they share.', [], 'No saved games yet.', 1, '—']);
  const many = await build({ [C]: { campaigns: Array.from({ length: 14 }, (_, i) => game('m' + i, 'Synthetic Game ' + i)) } });
  assert.deepEqual([section(many, 'games').items.length, section(many, 'games').note], [12, 'The 12 most recently played of 14 saved games.']);
});

test('a heroes or story read failing on its own is named as not checked while the saved games still show', async () => {
  const model = await build({ [H]: { http: 500, body: { error: 'server error' } }, [S]: { http: 503, body: summary([NOT_CHECKED], true) } });
  const heroes = model.stats.find((x) => x.id === 'heroes');
  assert.deepEqual([heroes.value, heroes.hint, section(model, 'heroes'), section(model, 'games').items.length], ['—', 'Could not check', undefined, 3]);
  assert.deepEqual([section(model, 'story').items, section(model, 'story').empty], [[], 'Where the story left off could not be read just now.']);
});

test('a refusal and a failure each read as what they are', async () => {
  const signedOut = await build({ [C]: { http: 401, body: { error: 'not signed in' } }, [H]: { http: 401, body: {} }, [S]: { http: 401, body: {} } });
  assert.deepEqual([signedOut.kicker, signedOut.title, signedOut.stats, signedOut.sections], ['Game night', 'Sign in to see your games', undefined, undefined]);
  const denied = await build({ [C]: { http: 403, body: {} } });
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Dungeon Master', 'The Dungeon Master routes refused this account (HTTP 403).']);
  const heroesDenied = await build({ [H]: { http: 403, body: {} } });
  assert.equal(heroesDenied.title, 'This account cannot open Dungeon Master', 'a refusal on any read is a refusal, not a missing count');
  await assert.rejects(build({ [C]: { http: 503, body: { error: 'database unavailable' } } }), /^Error: Dungeon Master could not read the saved games \(HTTP 503\)\.$/);
  await assert.rejects(build({ [C]: { http: 500, body: undefined } }), /^Error: Dungeon Master could not read the saved games \(HTTP 500\)\.$/, 'a non-JSON failure keeps its status');
  await assert.rejects(build({ [C]: { http: 404, body: { error: 'Synthetic route missing' } } }), /^Error: Synthetic route missing$/, 'a failure with its own error keeps it');
});

/** @returns {object} A stub element with the members the page's module script touches on start. */
function node() { return { value: '', textContent: '', className: '', disabled: false, append() {}, replaceChildren() {}, addEventListener() {} }; }

/**
 * @description Run the page's module script (imports stripped) against stub modules, a stub DOM and a stub fetch. The
 * script awaits at top level, so it runs as an async function body.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ mounted: number, reads: string[] }>} Connected-actions mounts and every URL fetched.
 */
async function runModule(activeView) {
  const open = html.indexOf('<script type="module">'), src = html.slice(open + 22, html.indexOf('</script>', open)).replace(/^import .*$/gm, '');
  const calls = { mounted: 0, reads: [] };
  const AsyncFunction = (async () => {}).constructor;
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ metrics: [], items: [] }) }); };
  await new AsyncFunction('window', 'AppView', 'document', 'fetch', 'receiveHandoff', 'mountConnectedActions', src)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, { querySelector: node, createElement: node }, fetchStub, () => {}, () => { calls.mounted++; return Promise.resolve(); });
  return calls;
}

test('under an audience view the page\x27s module script mounts nothing and reads nothing; the full page still runs every start step', async () => {
  assert.deepEqual(await runModule('family'), { mounted: 0, reads: [] });
  assert.deepEqual(await runModule(null), { mounted: 1, reads: ['GET /api/dnd/home-summary'] });
});

// ── The table (ui/table.html): the games group's first surface, which the Jarvis shell frames with ?audience=family ──

const TABLE_PAGE = 'ui/table.html';
const TABLE_GATES = ['ui/table-voice.js', 'ui/table-immersive.js', 'ui/table-screens.js'];
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const tableHtml = read(TABLE_PAGE);
const tableKit = tableHtml.indexOf('<script src="/shared/ui/js/app-view.js"></script>');
const tableBlock = (() => { const s = tableHtml.indexOf('<script>', tableKit); return tableHtml.slice(s + 8, tableHtml.indexOf('</script>', s)); })();

/**
 * @description Ask the package's real /api/dnd router for one GET, as the platform mounts it (the caller on req.oidc).
 * @param {Function} router A createDndRoutes(...) handler.
 * @param {string} url The path below /api/dnd, query included.
 * @param {string|null} sub The caller's subject, or null for a request with no session.
 * @returns {Promise<{ status: number, body: string }>} The answer as sent.
 */
function ask(router, url, sub) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 0, setHeader() {}, end(value) { resolve({ status: this.statusCode, body: String(value || '') }); } };
    const req = { method: 'GET', url, oidc: sub ? { user: { sub, name: sub } } : undefined };
    Promise.resolve(router(req, res, () => reject(new Error('route fell through: ' + url)))).catch(reject);
  });
}

test('the table loads the shared kit after the theme bootstrap and decides its view in the head, before any tabletop script', () => {
  const at = (s) => tableHtml.indexOf(s);
  const order = [at('<script src="/shared/ui/js/surface-theme.js"></script>'), at('<link rel="stylesheet" href="/shared/ui/css/app-view.css" />'), tableKit,
    at(tableBlock), at('<link rel="stylesheet" href="/api/dnd/dnd.css" />'), at('<script src="/api/dnd/engine.js"></script>'), at('</head>'), at('<script src="/api/dnd/leads.js"></script>')];
  assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), 'bootstrap, kit stylesheet, kit, head block, table stylesheet, engine, end of head, tabletop bundle: ' + order.join(','));
  assert.equal(tableHtml.split('/shared/ui/js/app-view.js').length - 1, 1, 'the kit is included once');
  assert.match(tableHtml, /html\[data-audience\], html\[data-audience\] body \{ height: auto; overflow: auto; user-select: text; \}/, 'the view scrolls although dnd.css locks the table to one screen');
});

test('the table boots the kit with its own application name and the family audience and its company alias (ADR-164 D6)', () => {
  const boot = tableBlock.match(/A\.boot\(\{([\s\S]*?)\}\);/);
  assert.ok(boot, 'A.boot({...}) present');
  assert.match(boot[1], /app: 'dnd'/);
  const declared = boot[1].match(/audiences: \{([^}]*)\}/);
  assert.deepEqual(declared[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean), ['family', 'company']);
  assert.match(boot[1], /escapeLabel: 'Open Dungeon Master in the cockpit'/);
});

test('every start path of the table is gated on the kit decision', () => {
  for (const file of TABLE_GATES) assert.match(read(file), /if \(!window\.AppView \|\| !AppView\.active\(\)\)/, file);
});

test('the table head block parses and reads only this package\x27s own routes', () => {
  assert.doesNotThrow(() => new Function(tableBlock));
  const reads = [...tableBlock.matchAll(/fetch\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(reads, ['/api/dnd']);
  const paths = [...new Set([...tableBlock.matchAll(/(?:call|soft)\('([^']+)'\)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(paths, ['/campaigns', '/characters', '/content'], 'no state, sync, playback, archive, snapshot, chat, roll, voice or cutaway read is even named');
  assert.doesNotMatch(tableBlock, /innerHTML\s*=|method:|join_code|home-plan/, 'no HTML from data, no write, no join code field, no connected-actions plan');
});

test('the served table (scripts inlined by the route) keeps the kit and the head block ahead of the tabletop bundle', async () => {
  const served = await ask(createDndRoutes({ appPackageDir: ROOT }), '/table', null);
  assert.equal(served.status, 200);
  const blockAt = served.body.indexOf(tableBlock), engineAt = served.body.indexOf('data-dnd-source="engine.js"');
  assert.ok(served.body.indexOf('<script src="/shared/ui/js/app-view.js"></script>') < blockAt && blockAt > 0, 'the kit then the head block are served verbatim');
  assert.ok(engineAt > blockAt && served.body.indexOf('data-dnd-source="table-screens.js"') > engineAt, 'the inlined bundle runs after the view decision');
});

const TC = '/api/dnd/content';
/** @returns {object} One synthetic adventure as GET /content bundles it. */
const adventure = (id, title, scenes, extra) => Object.assign({ id, title, scenes: scenes.map(([sid, stitle, kind]) => ({ id: sid, title: stitle, kind })) }, extra || {});
const DEFAULT_ADVENTURE = adventure('goblin-ambush', 'Synthetic Coast Road', [['s-road', 'The Road'], ['s-ravine', 'The Ravine']]);
const BELLS = adventure('synthetic-bells', 'Synthetic Bells', [['b1', 'A Bell Under the Tide', 'exploration'], ['b2', 'The Road the Sea Remembers', 'exploration'],
  ['b3', 'When the Lower Bell Rings', 'combat'], ['b4', 'Salt at Every Door', 'exploration']], { summary: 'A bell rings from a drowned chapel.', theme: { label: 'Synthetic Harbor Horror' } });
const CONTENT = { heroes: [], defaultParty: [], monsters: {}, adventure: DEFAULT_ADVENTURE, adventures: [DEFAULT_ADVENTURE, BELLS] };
const TABLE_GAMES = [
  game('t1', 'Synthetic Blackwater', { adventure_id: 'synthetic-bells', scene_id: 'b3', is_owner: true, mode: 'combat', round: 3, player_count: 3, last_played_at: '2026-09-28T08:00:00.000Z' }),
  game('t2', 'Synthetic Coast Road', { adventure_id: 'goblin-ambush', scene_id: 's-road', my_character: 'synthetic-bram', mode: 'exploration', player_count: 2 }),
  game('t3', 'Synthetic Lantern', { adventure_id: 'retired-adventure', scene_id: 's-ravine', status: 'archived', is_owner: true, mode: 'complete', last_played_at: '2026-08-30T10:00:00.000Z' }),
];
const TABLE_OK = { [C]: { ok: true, campaigns: TABLE_GAMES }, [H]: { ok: true, characters: HEROES }, [TC]: CONTENT };
const buildTable = (answers) => loadFamily(Object.assign({}, TABLE_OK, answers), tableBlock).family({});

test('on open the table view reads only the saved games, the saved heroes and the adventure catalog', async () => {
  const view = loadFamily(TABLE_OK, tableBlock);
  await view.family({});
  assert.deepEqual(view.urls, ['GET ' + C, 'GET ' + H, 'GET ' + TC]);
});

test('the table view names each game with its adventure and chapter as the route resolves them, where it stands, its players and the caller\x27s role', async () => {
  const view = loadFamily(TABLE_OK, tableBlock), model = await view.family({});
  assert.deepEqual([model.kicker, model.title, model.lede], ['Game table', '2 games to pick up',
    'Last played: Synthetic Blackwater, W(2026-09-28T08:00:00.000Z). Synthetic Bells, chapter 3 of 4: When the Lower Bell Rings · In a battle · round 3.']);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.hint || null]), [
    ['playing', 'Games to pick up', 2, null], ['finished', 'Finished or archived', 1, null], ['heroes', 'Saved heroes', 2, null], ['adventures', 'Adventures to choose from', 2, null],
  ]);
  assert.deepEqual(section(model, 'games').items.map((i) => [i.icon, i.title, i.text, i.meta, i.badge]), [
    ['🐉', 'Synthetic Blackwater', 'Synthetic Bells, chapter 3 of 4: When the Lower Bell Rings · In a battle · round 3 · 3 players', 'played W(2026-09-28T08:00:00.000Z)', 'You host'],
    ['🐉', 'Synthetic Coast Road', 'Chapter 1 of 2: The Road · Following leads · 2 players', 'played W(2026-09-27T10:00:00.000Z)', 'Playing synthetic-bram'],
    ['📜', 'Synthetic Lantern', 'Synthetic Coast Road, chapter 2 of 2: The Ravine · Adventure finished · 1 player', 'played W(2026-08-30T10:00:00.000Z)', 'You host'],
  ], 'a game named after its adventure does not repeat it; an adventure the catalog no longer has resolves to the compatibility default');
  assert.deepEqual(section(model, 'heroes').items.map((i) => [i.title, i.text, i.meta]), [
    ['Synthetic Aria', 'Level 3 Elf Wizard', 'saved W(2026-09-26T10:00:00.000Z)'], ['Synthetic Bram', 'Level 1 Dwarf Fighter', 'saved W(2026-09-26T10:00:00.000Z)'],
  ]);
  assert.deepEqual(section(model, 'adventures').items.map((i) => [i.icon, i.title, i.text, i.meta, i.badge]), [
    ['📖', 'Synthetic Coast Road', null, '2 battles', null], ['📖', 'Synthetic Bells', 'A bell rings from a drowned chapel.', '3 investigations · 1 battle', 'Synthetic Harbor Horror'],
  ]);
  assert.equal(JSON.stringify(model).includes(JOIN), false, 'the join code is never painted');
  assert.equal(model.sections.filter(Boolean).some((s) => s.items.some((i) => i.href || i.onClick)), false, 'no item links anywhere');
  assert.deepEqual(model.actions.map((a) => a.label), ['Open the game table']);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=dnd'], 'the one action opens the cockpit through the kit');
});

test('the table view reads each saved board in plain words and names the household state', async () => {
  const places = await buildTable({ [C]: { campaigns: [
    game('a', 'Synthetic Coast Road', { scene_id: null }), game('b', 'Synthetic Won', { mode: 'resolved', scene_id: 's-ravine' }), game('c', 'Synthetic Shelved', { status: 'archived', mode: 'combat', round: 2 }),
    game('d', 'Synthetic Fell', { mode: 'defeat', player_count: 0 }), game('e', 'Synthetic Odd', { mode: 'scene', adventure_id: 'synthetic-bells', scene_id: 'b9' }),
  ] } });
  assert.deepEqual(section(places, 'games').items.map((i) => i.text), ['Choosing heroes · 1 player', 'Synthetic Coast Road, chapter 2 of 2: The Ravine · Battle won · the next scene is waiting · 1 player',
    'Synthetic Coast Road · Archived · the story can be watched again · 1 player', 'Synthetic Coast Road · The party fell · the story can be watched again', 'Synthetic Bells · In the adventure · 1 player']);
  assert.deepEqual([places.title, places.stats[0].value, places.stats[1].value], ['3 games to pick up', 3, 2]);
  const done = await buildTable({ [C]: { campaigns: [TABLE_GAMES[2]] } });
  assert.deepEqual([done.title, done.lede], ['No game in progress', 'Last played: Synthetic Lantern, W(2026-08-30T10:00:00.000Z). Synthetic Coast Road, chapter 2 of 2: The Ravine · Adventure finished.']);
  const none = await buildTable({ [C]: { campaigns: [] }, [H]: { characters: [] } });
  assert.deepEqual([none.title, none.lede, section(none, 'games').items, section(none, 'games').empty, none.sections.filter(Boolean).map((s) => s.id), none.stats[0].value],
    ['No games yet', 'Open the table to start an adventure, or to join a friend at their table with the code they share.', [], 'No saved games yet.', ['games', 'adventures'], 0]);
  const many = await buildTable({ [C]: { campaigns: Array.from({ length: 14 }, (_, i) => game('m' + i, 'Synthetic Game ' + i)) },
    [H]: { characters: Array.from({ length: 10 }, (_, i) => hero('Synthetic Hero ' + i, 'Human', 'Fighter', 1)) } });
  assert.deepEqual([section(many, 'games').items.length, section(many, 'games').note, section(many, 'heroes').items.length, section(many, 'heroes').note],
    [12, 'The 12 most recently played of 14 saved games.', 8, 'The 8 most recently saved of 10 heroes.']);
  const long = await buildTable({ [TC]: Object.assign({}, CONTENT, { adventures: [adventure('synthetic-long', 'Synthetic Long', [], { summary: 'The road winds on. '.repeat(30) })] }) });
  const tile = section(long, 'adventures').items[0];
  assert.ok(tile.text.length <= 220 && tile.text.endsWith('…') && tile.meta === null, 'a long summary is clipped; an adventure with no chapters has no chapter count');
});

test('a heroes or adventure-shelf read failing on its own is named as not checked while the saved games still show', async () => {
  const model = await buildTable({ [H]: { http: 500, body: { error: 'server error' } }, [TC]: { http: 502, body: undefined } });
  assert.deepEqual(model.stats.slice(2).map((x) => [x.value, x.hint]), [['—', 'Could not check'], ['—', 'Could not check']]);
  assert.deepEqual([section(model, 'heroes'), section(model, 'adventures').items, section(model, 'adventures').empty], [undefined, [], 'The adventure shelf could not be read just now.']);
  assert.deepEqual(section(model, 'games').items.map((i) => i.text), ['In a battle · round 3 · 3 players', 'Following leads · 2 players', 'Adventure finished · 1 player'], 'without the catalog no chapter is guessed');
  assert.equal(model.lede, 'Last played: Synthetic Blackwater, W(2026-09-28T08:00:00.000Z). In a battle · round 3.');
  const bare = await buildTable({ [TC]: { heroes: [] } });
  assert.deepEqual([bare.stats[3].value, section(bare, 'adventures').empty], [0, 'No adventures come with this table.']);
});

test('a refusal and a failure on the table view each read as what they are', async () => {
  const signedOut = await buildTable({ [C]: { http: 401, body: { error: 'not signed in' } }, [H]: { http: 401, body: {} }, [TC]: { http: 401, body: {} } });
  assert.deepEqual([signedOut.kicker, signedOut.title, signedOut.lede, signedOut.stats, signedOut.sections],
    ['Game table', 'Sign in to see your games', 'Dungeon Master shows the games of whoever is signed in, and this session is not signed in.', undefined, undefined]);
  const denied = await buildTable({ [C]: { http: 403, body: {} } });
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Dungeon Master', 'The Dungeon Master routes refused this account (HTTP 403).']);
  assert.equal((await buildTable({ [TC]: { http: 403, body: {} } })).title, 'This account cannot open Dungeon Master', 'a refusal on any read is a refusal, not a missing count');
  await assert.rejects(buildTable({ [C]: { http: 503, body: { error: 'database unavailable' } } }), /^Error: Dungeon Master could not read the saved games \(HTTP 503\)\.$/);
  await assert.rejects(buildTable({ [C]: { http: 500, body: undefined } }), /^Error: Dungeon Master could not read the saved games \(HTTP 500\)\.$/, 'a non-JSON failure keeps its status');
  await assert.rejects(buildTable({ [C]: { http: 404, body: { error: 'Synthetic route missing' } } }), /^Error: Synthetic route missing$/, 'a failure with its own error keeps it');
});

/** A pool that answers the two library reads the view makes and records every statement; anything else fails the test. */
class LibraryReadPool {
  constructor() { this.statements = []; }
  async query(sql, params) {
    this.statements.push({ sql: String(sql).trim(), params });
    if (/LEFT JOIN dnd_players me/.test(sql)) {
      return { rows: [{ campaign_id: 'c1', name: 'Synthetic Blackwater', adventure_id: 'bells-beneath-blackwater', status: 'active', join_code: JOIN, created_at: '2026-09-01T10:00:00.000Z',
        updated_at: '2026-09-28T08:00:00.000Z', is_owner: true, my_character: null, mode: 'combat', scene_id: 'blackwater-drowned-chapel', round: 3, rev: 41, player_count: 3,
        last_played_at: '2026-09-28T08:00:00.000Z', user_sub: 'synthetic-alice' }] };
    }
    if (/FROM dnd_characters WHERE user_sub=\$1 AND campaign_id IS NULL/.test(sql)) {
      return { rows: [{ character_id: '00000000-0000-4000-8000-000000000001', slug: 'synthetic-aria', name: 'Synthetic Aria', sheet: JSON.stringify({ name: 'Synthetic Aria', race: 'Elf', class: 'Wizard', level: 3 }),
        xp: 900, level: 3, created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-26T10:00:00.000Z', user_sub: 'synthetic-alice' }] };
    }
    throw new Error('unexpected statement: ' + sql);
  }
}

/**
 * @description The table view wired to the package's real router: each fetch is answered by createDndRoutes as mounted.
 * @param {object|undefined} pool The database pool the router receives (undefined: none configured).
 * @param {string|null} sub The signed-in caller, or null.
 * @returns {Promise<object>} The model the family builder paints (or the rejection it raises).
 */
function tableOverRealRoutes(pool, sub) {
  const router = createDndRoutes({ pool, appPackageDir: ROOT });
  const fetchReal = (url) => ask(router, url.replace(/^\/api\/dnd/, ''), sub).then((r) => ({ ok: r.status < 400, status: r.status, json: () => Promise.resolve(JSON.parse(r.body)) }));
  return bootBlock(tableBlock, fetchReal).family({});
}

test('over the package\x27s real router the view makes exactly two SELECTs pinned to the caller and paints what the routes return', async () => {
  const pool = new LibraryReadPool(), model = await tableOverRealRoutes(pool, 'synthetic-alice');
  assert.equal(pool.statements.length, 2);
  for (const s of pool.statements) { assert.match(s.sql, /^SELECT\b/); assert.deepEqual(s.params, ['synthetic-alice']); }
  const bundle = JSON.parse((await ask(createDndRoutes({ appPackageDir: ROOT }), '/content', null)).body);
  const bells = bundle.adventures.find((a) => a.id === 'bells-beneath-blackwater'), at = bells.scenes.findIndex((s) => s.id === 'blackwater-drowned-chapel');
  assert.ok(at >= 0, 'the served catalog carries the saved scene');
  assert.equal(section(model, 'games').items[0].text, bells.title + ', chapter ' + (at + 1) + ' of ' + bells.scenes.length + ': ' + bells.scenes[at].title + ' · In a battle · round 3 · 3 players');
  assert.deepEqual(section(model, 'adventures').items.map((i) => i.title), bundle.adventures.map((a) => a.title), 'the shelf is the served catalog');
  assert.deepEqual([model.stats[2].value, model.stats[3].value, section(model, 'heroes').items[0].text], [1, bundle.adventures.length, 'Level 3 Elf Wizard']);
  assert.equal(JSON.stringify(model).includes(JOIN), false, 'the route returns the join code; the view never paints it');
});

test('over the real router a request with no session reads as signed out and a missing database as a failure, never as empty', async () => {
  assert.equal((await tableOverRealRoutes(new LibraryReadPool(), null)).title, 'Sign in to see your games');
  await assert.rejects(tableOverRealRoutes(undefined, 'synthetic-alice'), /^Error: Dungeon Master could not read the saved games \(HTTP 503\)\.$/);
});

/**
 * @description Globals for running one tabletop script in a VM: a kit whose active() answers `view`, or no kit at all.
 * @param {string|null|undefined} view The view the kit decided, null for the full page, undefined for no kit.
 * @returns {{ window: object, AppView?: object }} The context seed.
 */
function kitGlobals(view) {
  if (view === undefined) return { window: {} };
  const kit = { active: () => view };
  return { window: { AppView: kit }, AppView: kit };
}

/** @returns {{ listeners: string[], removed: string[] }} The window listeners and removed storage keys table-voice.js leaves on load. */
function runVoice(view) {
  const g = kitGlobals(view), listeners = [], removed = [];
  g.window.addEventListener = (name) => listeners.push(name);
  g.localStorage = { getItem: () => null, setItem() {}, removeItem: (key) => removed.push(key) };
  vm.runInNewContext(read('ui/table-voice.js'), g, { filename: 'table-voice.js' });
  return { listeners, removed };
}

/** @returns {{ wired: string[], documentListeners: string[] }} The controls and document listeners table-immersive.js wires on load. */
function runImmersive(view) {
  const g = kitGlobals(view), wired = [], documentListeners = [];
  g.$ = (id) => { wired.push(id); return { classList: { contains: () => false } }; };
  g.document = { addEventListener: (name) => documentListeners.push(name), querySelectorAll: () => [] };
  vm.runInNewContext(read('ui/table-immersive.js'), g, { filename: 'table-immersive.js' });
  return { wired, documentListeners };
}

/**
 * @description Run table-screens.js in a VM over stub table globals and let its boot settle.
 * @param {string|null|undefined} view As kitGlobals.
 * @returns {Promise<{ reads: string[], frames: number, narrator: number, listeners: string[] }>} What started on load.
 */
async function runScreens(view) {
  const g = kitGlobals(view), started = { reads: [], frames: 0, narrator: 0, listeners: [] };
  const node = () => ({ classList: { add() {}, remove() {}, contains: () => false }, dataset: {}, style: {}, addEventListener() {} });
  g.window.addEventListener = (name) => started.listeners.push(name);
  Object.assign(g, { $: node, document: { querySelectorAll: () => [] }, now: () => 0, content: null, params: new URLSearchParams(''), TV: false,
    requestAnimationFrame: () => { started.frames++; }, initVoiceStatus: () => { started.narrator++; },
    api: (pathname) => { started.reads.push(pathname); return Promise.resolve({}); } });
  vm.runInNewContext(read('ui/table-screens.js'), g, { filename: 'table-screens.js' });
  await new Promise((resolve) => setImmediate(resolve));
  return started;
}

test('under the family view the tabletop starts nothing; without the view, or without the kit, every start step still runs', async () => {
  assert.deepEqual(runVoice('family'), { listeners: [], removed: [] }, 'no audio unlock and no storage change under the view');
  const voice = { listeners: ['pointerdown', 'touchstart', 'keydown', 'click'], removed: ['dnd-voice', 'dnd-device-voice'] };
  assert.deepEqual([runVoice(null), runVoice(undefined)], [voice, voice]);
  assert.deepEqual(runImmersive('family'), { wired: [], documentListeners: [] });
  const immersive = { wired: ['fullscreenBtn', 'storyBtn'], documentListeners: ['fullscreenchange', 'keydown'] };
  assert.deepEqual([runImmersive(null), runImmersive(undefined)], [immersive, immersive]);
  assert.deepEqual(await runScreens('family'), { reads: [], frames: 0, narrator: 0, listeners: ['resize'] }, 'no boot read, animation loop, narrator status or glitch banner');
  const full = { reads: ['/content'], frames: 1, narrator: 1, listeners: ['resize', 'error'] };
  assert.deepEqual([await runScreens(null), await runScreens(undefined)], [full, full]);
});
