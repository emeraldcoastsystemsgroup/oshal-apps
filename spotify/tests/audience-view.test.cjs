/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (config and profile; now playing and playlists only once the connection answers 'ok'; never top tracks, search, the conversation or the concierge), that not connected, the Development Mode allowlist, a Spotify error, playing, paused, nothing playing, an unreadable read, empty playlists, a refusal and a failure each read as what they are with the one action that fits, and that only open.spotify.com links open, in a new tab. The page's module script is run with stubs too: under an audience view it adds no handoff listener and fetches no connected-actions offer, and the full page's boot() is called only behind the gate.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'spotify';
const PAGE = 'tools/spotify-app.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/spotify"];
const GATE_FILE = 'tools/spotify-app.html';

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
 * paints and the reads it makes rather than as substrings of the source.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @returns {{ family: Function, urls: string[], opened: string[] }} The family builder, every URL fetched, every A.open href.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', day: (v) => 'D(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url) => {
    urls.push(url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body || {} : a;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

const TRACK = { title: 'Synthetic Song', artist: 'Synthetic Artist', album: 'Synthetic Album', url: 'https://open.spotify.com/track/1' };
const OK = {
  '/api/spotify/config': { connected: true, status: 'ok', me: { displayName: 'Synthetic Home' } },
  '/api/spotify/profile': { profile: { favorite_genres: ['folk'], favorite_artists: ['A', 'B'] } },
  '/api/spotify/now-playing': { nowPlaying: { track: TRACK, isPlaying: true } },
  '/api/spotify/playlists': { playlists: [{ name: 'Synthetic Mix', trackCount: 9, url: 'https://open.spotify.com/playlist/9', owner: 'Synthetic Home' }, { name: 'Synthetic Odd', trackCount: 3, url: 'https://elsewhere.example/p', owner: '' }] },
};
const CTX = { refresh() {} };
const section = (model, id) => model.sections.find((s) => s && s.id === id);
const stat = (model, id) => model.stats.find((s) => s.id === id).value;

test('with a working connection the view reads config, profile, now playing and playlists, and nothing else', async () => {
  const view = loadFamily(OK);
  const model = await view.family(CTX);
  assert.deepEqual([...view.urls].sort(), ['/api/spotify/config', '/api/spotify/now-playing', '/api/spotify/playlists', '/api/spotify/profile']);
  assert.equal(model.title, 'Now playing: Synthetic Song');
  assert.deepEqual(model.stats.map((s) => [s.id, s.value]), [['playlists', 2], ['playing', 'Playing'], ['genres', 1], ['artists', 2]]);
});

test('the live reads wait for a working connection, and each gate offers the one action that fits', async () => {
  const refreshed = [];
  const gate = async (config) => { const view = loadFamily({ ...OK, '/api/spotify/config': config }); const model = await view.family({ refresh: () => refreshed.push(1) }); return { view, model }; };
  const off = await gate({ connected: false, status: 'not_connected', me: null });
  assert.deepEqual([...off.view.urls].sort(), ['/api/spotify/config', '/api/spotify/profile'], 'no live read before the connection works');
  assert.equal(off.model.title, 'Connect Spotify to see what is playing');
  off.model.actions[0].onClick();
  assert.deepEqual(off.view.opened, ['/api/connect/spotify/start']);
  assert.equal(section(off.model, 'taste').items.length, 2, 'saved taste still shows');
  const allow = await gate({ connected: true, status: 'needs_allowlist', me: null });
  assert.equal(allow.model.title, 'Spotify needs this account added');
  assert.deepEqual([allow.model.actions[0].href, allow.model.actions[0].target], ['https://developer.spotify.com/dashboard', '_blank']);
  for (const config of [{ connected: true, status: 'error', me: null }, { connected: true, status: 'something-new' }]) {
    const failed = await gate(config);
    assert.equal(failed.model.title, 'Spotify could not be reached');
    failed.model.actions[0].onClick();
    assert.deepEqual([...failed.view.urls].sort(), ['/api/spotify/config', '/api/spotify/profile']);
  }
  assert.equal(refreshed.length, 2, 'Try again refreshes the view');
});

test('playing, paused, nothing playing and an unreadable now-playing read are each named', async () => {
  const paused = await loadFamily({ ...OK, '/api/spotify/now-playing': { nowPlaying: { track: TRACK, isPlaying: false } } }).family(CTX);
  assert.deepEqual([paused.title, stat(paused, 'playing')], ['Paused: Synthetic Song', 'Paused']);
  assert.equal(paused.lede, 'Synthetic Artist · Synthetic Album');
  const idle = await loadFamily({ ...OK, '/api/spotify/now-playing': { nowPlaying: null } }).family(CTX);
  assert.deepEqual([idle.title, idle.lede, stat(idle, 'playing')], ['Nothing playing right now', 'Spotify account: Synthetic Home', 'Nothing']);
  assert.deepEqual(idle.actions, [], 'no open action without a track');
  const unknown = await loadFamily({ ...OK, '/api/spotify/now-playing': { http: 500, body: { error: 'spotify 502' } } }).family(CTX);
  assert.deepEqual([unknown.title, unknown.lede, stat(unknown, 'playing')], ['Spotify is connected', 'What is playing could not be read just now.', '—']);
});

test('only open.spotify.com links open, in a new tab; empty and unreadable playlists read differently', async () => {
  const model = await loadFamily(OK).family(CTX);
  const tiles = section(model, 'playlists').items;
  assert.deepEqual([tiles[0].href, tiles[0].target, tiles[0].text], ['https://open.spotify.com/playlist/9', '_blank', '9 tracks']);
  assert.deepEqual([tiles[1].href, tiles[1].target], [null, null], 'a non-Spotify link is never opened');
  assert.deepEqual([model.actions[0].label, model.actions[0].href, model.actions[0].target], ['Open in Spotify', 'https://open.spotify.com/track/1', '_blank']);
  const odd = await loadFamily({ ...OK, '/api/spotify/now-playing': { nowPlaying: { track: { ...TRACK, url: 'javascript:alert(1)' }, isPlaying: true } } }).family(CTX);
  assert.deepEqual(odd.actions, []);
  const none = await loadFamily({ ...OK, '/api/spotify/playlists': { playlists: [] } }).family(CTX);
  assert.deepEqual([stat(none, 'playlists'), section(none, 'playlists').empty], [0, 'No playlists yet. Build one in Music.']);
  const unread = await loadFamily({ ...OK, '/api/spotify/playlists': { http: 500, body: {} } }).family(CTX);
  assert.deepEqual([stat(unread, 'playlists'), section(unread, 'playlists').empty], ['—', 'Playlists could not be read just now.']);
});

test('a refusal is named, and a failed connection check fails with its status', async () => {
  const signedOut = await loadFamily({ ...OK, '/api/spotify/config': { http: 401, body: { error: 'Not authenticated' } } }).family(CTX);
  assert.equal(signedOut.title, 'Sign in to see your music');
  const denied = await loadFamily({ ...OK, '/api/spotify/profile': { http: 403, body: {} } }).family(CTX);
  assert.equal(denied.title, 'This account cannot open Spotify');
  await assert.rejects(loadFamily({ ...OK, '/api/spotify/config': { http: 500, body: { error: 'internal' } } }).family(CTX),
    /^Error: Music could not check the Spotify connection \(HTTP 500\)\.$/);
});

/**
 * @description Run the page's module script (imports stripped) against stub modules and a stub DOM.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {{ handoff: number, actions: number }} How often receiveHandoff and mountConnectedActions ran.
 */
function runModule(activeView) {
  const src = html.slice(html.indexOf('<script type="module">') + 22, html.indexOf('</script>', html.indexOf('<script type="module">')));
  const calls = { handoff: 0, actions: 0 };
  const node = () => ({ hidden: true, value: '', style: {}, focus() {}, scrollIntoView() {}, querySelectorAll: () => [] });
  const body = src.replace(/^import .*$/gm, '');
  new Function('window', 'AppView', 'document', 'receiveHandoff', 'mountConnectedActions', body)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, { getElementById: node, querySelector: node },
    () => { calls.handoff++; }, () => { calls.actions++; return Promise.resolve(); });
  return calls;
}

test('under an audience view the module script adds no handoff listener and fetches no connected-actions offer', () => {
  assert.deepEqual(runModule('family'), { handoff: 0, actions: 0 });
  assert.deepEqual(runModule(null), { handoff: 1, actions: 1 }, 'the full page still mounts both');
  assert.match(html, /\nif \(!window\.AppView \|\| !AppView\.active\(\)\) boot\(\);\n/, 'the full page boot is gated');
  assert.doesNotMatch(html, /^boot\(\);$/m, 'no ungated boot() call is left');
});
