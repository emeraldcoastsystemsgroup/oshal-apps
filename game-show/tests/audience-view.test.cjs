/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (GET /home-summary, /leaderboard and /shows only: never /rooms, whose listing runs the ended-room retention DELETE, never a room's state, sync, cost, QR or camera stills, never a POST), that the stats are the route's three counts in plain words plus the top score, that the title names the table's state (marked live, waiting to start, ended in 5 days, nothing open, no game nights, sources that could not be checked), that each room tile carries its plain status and its update through AppView.when, that an unnamed room and a hall-of-fame score are named from the show catalog, that a data key such as 'constructor' stays a word, and that failed scores or names, a partly unreadable record, a 401, a 403 and a failed read each read as what they are. The page's module script (top-level await, so run as an async function body) is proved to mount no connected actions and read nothing under the view while the full page still mounts them and reads its saved evidence.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'game-show';
const PAGE = 'tools/review.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/game-show"];
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

const H = '/api/game-show/home-summary', L = '/api/game-show/leaderboard', S = '/api/game-show/shows';
const NOW = '2026-09-28T21:30:00.000Z', U1 = '2026-09-28T19:30:00.000Z', U2 = '2026-09-27T20:00:00.000Z', U3 = '2026-09-25T18:00:00.000Z';
/** The route's closing note (routes/home-summary.js): the last item, carrying no actions. */
const BOUNDS = { text: 'Counts caller-hosted rooms by persisted lobby/live/ended state; live does not mean a connected player. Ended rooms updated within five days is not a completion timestamp. Plan refreshments or a host brief without starting a game, changing scores or exposing join codes or camera frames.', tone: 'neutral', fix: 'game-show-stage' };
const EMPTY_NOTE = { text: 'No saved work yet. Open the app to begin.', tone: 'neutral', fix: 'game-show-stage' };
const PARTIAL_NOTE = { text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'game-show-stage' };
/** @returns {object[]} The route's three counts in its order, as digit strings or 'Unavailable'; mirrored as tiles. */
const counts = (lobby, live, ended) => [
  { id: 'hosted-lobbies', label: 'Hosted lobbies', value: lobby },
  { id: 'hosted-live', label: 'Hosted live sessions', value: live },
  { id: 'ended-updated-5d', label: 'Ended rooms updated/5d', value: ended },
];
/** @returns {object} A room item as the route writes it: the room name (or its show id), '<status> / updated <iso>' and the two planning offers. */
const room = (text, status, updated) => {
  const detail = status + ' / updated ' + updated, notes = detail + ' Game format: family-feud. This is your hosted room state; it does not establish current player presence. Review plans for the next gathering.';
  return { text, detail, tone: 'neutral', fix: 'game-show-stage', actions: ['plan-meal', 'prepare-document'].map((integration) => ({ integration, context: { title: text, notes } })) };
};
/** @returns {object} A home summary: tiles mirror metrics, rooms newest first, then the notes, as the route orders them. */
const summary = (m, items, partial) => ({ metrics: m, tiles: m, items, asOf: NOW, partial: !!partial });
const SHOWS = { ok: true, shows: [
  { id: 'family-feud', title: 'Family Feud', tagline: '', teams: true, minPlayers: 2, maxPlayers: 10 },
  { id: 'jeopardy', title: 'Jeopardy', tagline: '', teams: false, minPlayers: 2, maxPlayers: 10 },
  { id: 'wheel', title: 'Wheel of Fortune', tagline: '', teams: false, minPlayers: 2, maxPlayers: 10 },
  { id: 'whammy', title: 'Whammy!', tagline: '', teams: false, minPlayers: 2, maxPlayers: 10 },
] };
const BOARD = { ok: true, entries: [
  { name: 'Synthetic Ana', team: 'A', score: 12400, showId: 'family-feud', endedAt: U3 },
  { name: 'Synthetic Ben', team: null, score: 900, showId: 'whammy', endedAt: U3 },
] };
const ROOMS = [room('Synthetic Friday Feud', 'lobby', U1), room('Synthetic Wheel Night', 'live', U2), room('jeopardy', 'ended', 'date unavailable')];
const OK = { [H]: summary(counts('1', '1', '2'), ROOMS.concat([BOUNDS])), [L]: BOARD, [S]: SHOWS };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);

test('on open the family view makes three plain GET reads: never /rooms (its listing deletes ended rooms), a room read or a write', async () => {
  const view = loadFamily(OK);
  await view.family({});
  assert.deepEqual([...view.urls].sort(), ['GET ' + H, 'GET ' + L, 'GET ' + S]);
  for (const url of view.urls) assert.doesNotMatch(url, /\/(rooms|state|sync|cost|qr|presence|stage|host|answer|action|tts|react|speaker|join|create)\b/, 'no room, host, voice or write route: ' + url);
  assert.doesNotMatch(block, /method\s*:/, 'the head block never sets a request method');
  assert.deepEqual(view.opened, [], 'nothing opens on its own');
});

test('the stats, title and lede name the table in plain words, rooms carry their status and update, the hall of fame is named from the show catalog', async () => {
  const view = loadFamily(OK), model = await view.family({});
  assert.deepEqual([model.kicker, model.title, model.lede, model.actions.map((a) => a.label)],
    ['Game night', '1 game marked live', 'Newest: Synthetic Friday Feud, waiting in the lobby, updated W(' + U1 + ').', ['Open Game Show']]);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=game-show'], 'the one action opens Game Show in the cockpit');
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['lobby', 'Waiting in the lobby', 1, null, null],
    ['live', 'Marked live', 1, null, null],
    ['ended', 'Ended, last 5 days', 2, null, null],
    ['top', 'Top score', '12400', null, 'Synthetic Ana'],
  ]);
  const rooms = section(model, 'rooms');
  assert.deepEqual(rooms.items.map((i) => [i.icon, i.title, i.text, i.meta]), [
    ['🚪', 'Synthetic Friday Feud', 'Waiting in the lobby', 'updated W(' + U1 + ')'],
    ['🎤', 'Synthetic Wheel Night', 'Marked live', 'updated W(' + U2 + ')'],
    ['🏁', 'Jeopardy', 'Ended', null],
  ], 'an unnamed room is named from the catalog; the route\x27s date unavailable carries no time');
  assert.ok(rooms.items.every((i) => !i.href && !i.onClick), 'a room is never opened, joined or started from the view');
  assert.match(rooms.note, /it does not mean anyone is playing right now\.$/);
  const fame = section(model, 'fame');
  assert.deepEqual(fame.items.map((i) => [i.icon, i.title, i.text, i.badge]), [['🏆', 'Synthetic Ana', 'Family Feud · Team A', '12400'], ['⭐', 'Synthetic Ben', 'Whammy!', '900']]);
  assert.equal(fame.note, 'The best scores from ended games you hosted or played in.');
});

test('waiting to start, ended lately, nothing open and no game nights each read as what they are', async () => {
  const lobby = await loadFamily({ ...OK, [H]: summary(counts('2', '0', '0'), [room('Synthetic A', 'lobby', U1), room('Synthetic B', 'lobby', U2), BOUNDS]) }).family({});
  assert.equal(lobby.title, '2 rooms waiting to start');
  const ended = await loadFamily({ ...OK, [H]: summary(counts('0', '0', '1'), [room('Synthetic A', 'ended', U3), BOUNDS]) }).family({});
  assert.deepEqual([ended.title, ended.lede], ['1 game ended in the last 5 days', 'Newest: Synthetic A, ended, updated W(' + U3 + ').']);
  const quiet = await loadFamily({ ...OK, [H]: summary(counts('0', '0', '0'), [room('Synthetic Old', 'ended', U3), BOUNDS]) }).family({});
  assert.equal(quiet.title, 'No game open right now');
  const none = await loadFamily({ [H]: summary(counts('0', '0', '0'), [EMPTY_NOTE, BOUNDS]), [L]: { ok: true, entries: [] }, [S]: SHOWS }).family({});
  assert.deepEqual([none.title, none.lede, section(none, 'rooms').items, section(none, 'rooms').empty],
    ['No game nights yet', 'Host a room in Game Show and everyone joins from their phone. Rooms you host show up here.', [], 'No rooms yet. Rooms you host show up here.']);
  assert.deepEqual([stat(none, 'top').value, stat(none, 'top').hint, section(none, 'fame').items, section(none, 'fame').empty, section(none, 'fame').note],
    ['—', 'No scores yet', [], 'No scores yet. Best scores from ended games show up here.', null]);
});

test('a partly unreadable record, failed scores and failed show names each read as what they are; a data key stays a word', async () => {
  const partial = await loadFamily({ ...OK, [H]: summary(counts('Unavailable', 'Unavailable', 'Unavailable'), [PARTIAL_NOTE, BOUNDS], true) }).family({});
  assert.deepEqual([partial.title, partial.lede, section(partial, 'rooms').empty], ['Some saved games cannot be checked', 'Your saved rooms could not be checked right now.', 'Some saved rooms could not be checked.']);
  assert.deepEqual([stat(partial, 'lobby').value, stat(partial, 'lobby').tone, stat(partial, 'lobby').hint], ['—', 'warn', 'Could not check']);
  const noScores = await loadFamily({ ...OK, [L]: { http: 503, body: { error: 'database unavailable' } } }).family({});
  assert.deepEqual([noScores.title, stat(noScores, 'top').value, stat(noScores, 'top').hint, section(noScores, 'fame').items, section(noScores, 'fame').empty],
    ['1 game marked live', '—', 'Could not check', [], 'The scores could not be checked right now.'], 'the rooms still show when the scores fail');
  const noNames = await loadFamily({ ...OK, [S]: { http: 500, body: undefined } }).family({});
  assert.deepEqual([section(noNames, 'rooms').items[2].title, section(noNames, 'fame').items[0].text], ['jeopardy', 'family-feud · Team A'], 'without the catalog a show keeps its id');
  const odd = await loadFamily({ ...OK, [H]: summary(counts('0', '0', '0'), [room('constructor', 'constructor', U1), BOUNDS]), [L]: { ok: true, entries: [{ name: 'Synthetic Cy', team: null, score: 5, showId: 'toString' }] } }).family({});
  assert.deepEqual([section(odd, 'rooms').items[0].title, section(odd, 'rooms').items[0].text, section(odd, 'rooms').items[0].icon, odd.lede, section(odd, 'fame').items[0].text],
    ['constructor', 'Saved room', '🎲', 'Newest: constructor, updated W(' + U1 + ').', 'toString']);
});

test('a refusal and a failure each read as what they are', async () => {
  const signedOut = await loadFamily({ ...OK, [H]: { http: 401, body: { error: 'not_authenticated' } } }).family({});
  assert.deepEqual([signedOut.title, signedOut.sections, signedOut.stats], ['Sign in to see your game nights', undefined, undefined]);
  const denied = await loadFamily({ ...OK, [L]: { http: 403, body: {} } }).family({});
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Game Show', 'The Game Show routes refused this account (HTTP 403).']);
  const down = summary(counts('Unavailable', 'Unavailable', 'Unavailable'), [PARTIAL_NOTE, BOUNDS], true);
  await assert.rejects(loadFamily({ ...OK, [H]: { http: 503, body: down } }).family({}), /^Error: Game Show could not read your saved games \(HTTP 503\)\.$/, 'every source failed: the route answers 503');
  await assert.rejects(loadFamily({ ...OK, [H]: { http: 500, body: undefined } }).family({}), /^Error: Game Show could not read your saved games \(HTTP 500\)\.$/, 'an answer that is not JSON');
  await assert.rejects(loadFamily({ ...OK, [H]: { offline: true } }).family({}), /^Error: Game Show could not read your saved games\.$/, 'a network failure');
});

/** @returns {object} A stub element with the members the page's module script touches on start. */
function node() { return { value: '', textContent: '', className: '', append() {}, replaceChildren() {}, addEventListener() {} }; }

/**
 * @description Run the page's module script (imports stripped) against stub modules, a stub DOM and a stub fetch. The
 * script awaits at top level, so it runs as an async function body.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ handoffs: number, mounted: number, reads: string[] }>} Handoff listeners registered, connected-action mounts and every URL fetched.
 */
async function runModule(activeView) {
  const open = html.indexOf('<script type="module">'), src = html.slice(open + 22, html.indexOf('</script>', open)).replace(/^import .*$/gm, '');
  const calls = { handoffs: 0, mounted: 0, reads: [] };
  const AsyncFunction = (async () => {}).constructor;
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ metrics: [], items: [] }) }); };
  await new AsyncFunction('window', 'AppView', 'document', 'fetch', 'receiveHandoff', 'mountConnectedActions', src)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, { querySelector: node, createElement: node }, fetchStub, () => { calls.handoffs++; }, () => { calls.mounted++; return Promise.resolve(); });
  return calls;
}

test('under an audience view the page\x27s module script mounts nothing and reads nothing; the full page still mounts its actions and reads its evidence', async () => {
  assert.deepEqual(await runModule('family'), { handoffs: 0, mounted: 0, reads: [] });
  assert.deepEqual(await runModule(null), { handoffs: 0, mounted: 1, reads: ['GET ' + H] });
});
