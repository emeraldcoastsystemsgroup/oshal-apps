/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Sports Edge home, grade C). Dependency-free checks over the shipped tools/sports-edge.html, plus its tab and boot code run against DOM doubles: a person with a followed team lands on Games and a first-run person on My Teams; Following comes before the team picker; the league is chosen by chips that load at once (no Load teams button) with a search field; the Jobs-screen banner is never written, and Games carries the app's own background-refresh toggle (through the schedule endpoint), an Updated line and one Refresh now; on a phone the five sections are a bottom bar.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sports-edge.html'), 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

test('Following comes first, chips choose the league at once, and a search narrows the teams', () => {
  assert.ok(html.indexOf('<h2>Following</h2>') < html.indexOf('<h2>Follow a team</h2>'));
  assert.doesNotMatch(html, /id="loadTeams"/);
  for (const league of ['nfl', 'ncaaf', 'nba']) assert.match(html, new RegExp(`data-league="${league}"`));
  assert.match(html, /<input type="search" id="teamSearch"/);
});

test('no banner sends people to the Jobs screen; Games has the toggle, Updated and one Refresh now', () => {
  assert.doesNotMatch(script, /b\.innerHTML = st\.banner/);
  assert.match(script, /el\('bgToggle'\)\.checked = st\.on === true;/);
  assert.match(script, /'\/api\/v1\/agent\/schedules\/' \+ encodeURIComponent\(row\.id\) \+ '\/' \+ \(want \? 'activate' : 'deactivate'\)/);
  assert.match(html, /Keep refreshing previews in the background<\/label>/);
  assert.equal((html.match(/>Refresh now</g) || []).length, 1);
  assert.match(script, /'Updated ' \+ new Date\(last\)/);
});

test('on a phone the five sections are a bottom bar', () => {
  assert.match(html, /@media \(max-width: 640px\) \{\s*nav\[role="tablist"\] \{ position: fixed; left: 0; right: 0; bottom: 0;[^}]*grid-template-columns: repeat\(5, 1fr\)/);
});

/** Run the page script against DOM doubles; `teams` is what GET /follow answers. */
async function boot(teams) {
  const nodes = new Map();
  const el = (id) => { if (!nodes.has(id)) nodes.set(id, { id, hidden: id.startsWith('tab-') && id !== 'tab-teams', innerHTML: '', textContent: '', value: 'nfl', checked: false, disabled: false, style: {}, classList: { toggle() {}, contains() { return false; } }, addEventListener() {}, querySelectorAll: () => [], setAttribute() {}, getAttribute() { return null; } }); return nodes.get(id); };
  const tabs = ['teams', 'games', 'preview', 'fantasy', 'record'].map((t) => ({ t, selected: t === 'teams', addEventListener() {}, getAttribute: () => t, setAttribute(k, v) { this.selected = v === 'true'; } }));
  const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const context = {
    document: { getElementById: el, querySelectorAll: (sel) => (sel === 'nav button' ? tabs : []) },
    fetch: (url) => json(url.endsWith('/follow') ? { teams } : url.endsWith('/teams?league=nfl') ? { teams: [] } : url.endsWith('/games') ? { games: [] } : url.endsWith('/status') ? { season: { nfl: 2026, nba: 2026 }, refresh: {} } : {}),
    encodeURIComponent, Promise, JSON, Number, String, Array, Object, Math, Date, console, setTimeout, alert() {},
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
  return { selected: tabs.find((t) => t.selected)?.t, gamesHidden: el('tab-games').hidden };
}

test('a followed team opens on Games; a first-run person on My Teams', async () => {
  assert.deepEqual(await boot([{ league: 'nfl', team: 'DAL', displayName: 'Dallas Cowboys' }]), { selected: 'games', gamesHidden: false });
  assert.deepEqual(await boot([]), { selected: 'teams', gamesHidden: true });
});
