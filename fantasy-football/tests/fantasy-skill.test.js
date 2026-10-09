/**
 * Guards that Fantasy Football reads ESPN fantasy data ONLY through the fantasy-leagues kernel skill.
 *
 * ADR-146 D2, taken by the operator on 2026-09-27: the ESPN fantasy client is ONE kernel skill, and a
 * package declares `uses: [fantasy-leagues]` and calls it. What this forbids is exactly what makes the
 * rule decay quietly — a private copy of the client coming back beside the import, or a module that
 * builds its own request to the fantasy host with the account cookies on it. Either would still pass
 * every behaviour suite in this package, because the copy would behave the same on the day it came
 * back; it drifts later, on a host that has already moved once inside a season.
 *
 * So these read the package itself — the source, the compiled modules the framework mounts, and the
 * manifest — and need no framework checkout.
 *
 * Run from the package root: node --test "tests/*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the private client is gone (source and compiled), no package module names the fantasy host, builds the cookie header or sends the feed filter, the compiled fantasy route requires the kernel skill, and the manifest declares it under uses:.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Moved from sports-edge (sports-fantasy-skill.test.js) with the routes it guards (ADR-146 D1): the same four guards now hold for the fantasy-football package and its compiled fantasy-routes.js.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | 0.2.0 spreads the ESPN reads over three compiled modules (the router, the league seam fantasy-context.js and the feed cache fantasy-feed.js): each must require the skill, and every read — now including the raw readLeague the FAAB and season shape come from — must be taken from it.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const SKILL = '@/features/fantasy-leagues';

/**
 * @description Every package module the framework can execute or compile: TypeScript sources and
 * their compiled routes.
 * @returns {Array<{file: string, text: string}>} Relative path and contents.
 */
function packageModules() {
  const out = [];
  for (const [dir, ext] of [['src-routes', '.ts'], ['routes', '.js']]) {
    for (const name of fs.readdirSync(path.join(PKG, dir)).filter((n) => n.endsWith(ext)).sort()) {
      out.push({ file: `${dir}/${name}`, text: fs.readFileSync(path.join(PKG, dir, name), 'utf8') });
    }
  }
  return out;
}

test('THE PRIVATE ESPN FANTASY CLIENT IS GONE — source and compiled', () => {
  for (const rel of ['src-routes/sports-fantasy-espn.ts', 'routes/sports-fantasy-espn.js']) {
    assert.equal(fs.existsSync(path.join(PKG, rel)), false, `${rel} is back: the client is the fantasy-leagues kernel skill`);
  }
  const importers = packageModules()
    .filter(({ text }) => /(?:from\s+|require\()\s*['"]\.\/sports-fantasy-espn['"]/.test(text))
    .map(({ file }) => file);
  assert.deepEqual(importers, [], 'a module still imports the private client');
});

test('no package module talks to the fantasy host, builds the cookie header, or sends the feed filter', () => {
  // Each of these is what a copy of the client would need; the skill owns all three.
  const markers = [/fantasy\.espn\.com/, /espn_s2=/, /x-fantasy-filter/i];
  const hits = [];
  for (const { file, text } of packageModules()) {
    for (const marker of markers) if (marker.test(text)) hits.push(`${file} matches ${marker}`);
  }
  assert.deepEqual(hits, [], 'ESPN fantasy reads belong to the fantasy-leagues kernel skill');
});

test('the compiled fantasy routes read ESPN through the kernel skill', () => {
  // The reads are spread over the router, the league seam and the feed cache; each module that makes
  // one must take it from the skill.
  const modules = ['fantasy-routes.js', 'fantasy-context.js', 'fantasy-feed.js']
    .map((name) => fs.readFileSync(path.join(PKG, 'routes', name), 'utf8'));
  for (const text of modules) assert.match(text, /require\("@\/features\/fantasy-leagues"\)/);
  const all = modules.join('\n');
  for (const read of ['readLeagueSettingsOutcome', 'readTeams', 'readMatchupsOutcome', 'fetchProjections', 'readCurrentScoringPeriod', 'readLeague']) {
    assert.match(all, new RegExp(`fantasy_leagues_1\\.${read}\\b`), `${read} must come from the skill`);
  }
});

test('the manifest declares fantasy-leagues, so an older core refuses the package instead of mounting it broken', () => {
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const uses = /^uses:\s*\[([^\]]*)\]/m.exec(manifest);
  assert.ok(uses, 'uses: must be a flow list on one line');
  const declared = uses[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.ok(declared.includes('fantasy-leagues'), `uses: ${JSON.stringify(declared)} is missing fantasy-leagues`);
  const importers = packageModules().filter(({ text }) => text.includes(SKILL)).map(({ file }) => file);
  assert.ok(importers.length > 0, 'the declaration is there because a module imports the skill');
});
